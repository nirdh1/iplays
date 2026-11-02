-- iplays — league table computed from real IFA game results.
--
-- Run after 20261102300000_ifa_agent_games.sql (needs only ifa_games from 20261101900000).
-- Rollback: supabase/rollback/20261102400000_league_table.down.sql (drops the
-- two functions only; no table or row is touched).
--
-- What this adds (functions only — no new tables, no data changes)
--   * league_table(season, league): the standings of one IFA league, built
--     only from ifa_games rows that are status = 'played' with both scores.
--     Postponed, canceled, scheduled or score-less games are not counted.
--     Every team that appears in a game of the league is listed, also with
--     0 games played. Nothing is invented: no game, no row.
--   * team_league_table(team): the same table for the league of the IFA team
--     linked to an app team (ifa_teams.team_id), with that row marked is_us.
--     Returns null when the team is not linked to an IFA team in a league.
--
-- Rules
--   * win 3, draw 1, loss 0.
--   * order: points, goal difference, goals for, then name. The IFA may use
--     other tiebreaks (head-to-head) or deduct points; when it publishes its
--     own table that table is the official one.
--   * live goals reported in the app are not counted: only the result the
--     IFA published (imported into ifa_games) moves the table.
--   * a league with no scored game yet (or a young age group where the IFA
--     publishes no results) returns rows = [] and has_results = false, and
--     the app shows "no table yet" instead of a table of zeros.
--
-- Who can read: any signed-in user. A league table is public information on
-- the IFA site; only team names and results are returned, no players.

begin;

create or replace function public.league_table(p_season int, p_league int)
returns jsonb language sql stable security definer set search_path = public as $$
  with games as (
    select g.*
    from ifa_games g
    where g.ifa_season_id = p_season and g.ifa_league_id = p_league
  ),
  scored as (
    select * from games
    where status = 'played' and home_score is not null and away_score is not null
  ),
  sides as (
    select home_ifa_team_id as team, home_score as gf, away_score as ga, game_date, last_seen_at from scored
    union all
    select away_ifa_team_id, away_score, home_score, game_date, last_seen_at from scored
  ),
  -- the name shown on the most recent game, else the imported team name
  names as (
    select distinct on (team) team, name
    from (
      select home_ifa_team_id as team, home_name as name, game_date from games where home_name <> ''
      union all
      select away_ifa_team_id, away_name, game_date from games where away_name <> ''
    ) n
    order by team, game_date desc nulls last
  ),
  teams as (
    select home_ifa_team_id as team from games
    union
    select away_ifa_team_id from games
  ),
  agg as (
    select t.team,
           coalesce(nm.name, it.name, t.team::text) as name,
           it.team_id as app_team_id,
           count(s.team)::int as played,
           count(*) filter (where s.gf > s.ga)::int as won,
           count(*) filter (where s.gf = s.ga)::int as drawn,
           count(*) filter (where s.gf < s.ga)::int as lost,
           coalesce(sum(s.gf), 0)::int as goals_for,
           coalesce(sum(s.ga), 0)::int as goals_against
    from teams t
    left join sides s on s.team = t.team
    left join names nm on nm.team = t.team
    left join ifa_teams it on it.ifa_season_id = p_season and it.ifa_team_id = t.team
    group by t.team, nm.name, it.name, it.team_id
  ),
  form as (
    select team, string_agg(r, '' order by game_date desc) as last5
    from (
      select team, game_date,
             case when gf > ga then 'W' when gf = ga then 'D' else 'L' end as r,
             row_number() over (partition by team order by game_date desc) as rn
      from sides
    ) x
    where rn <= 5
    group by team
  ),
  ranked as (
    select a.*, a.won * 3 + a.drawn as points, a.goals_for - a.goals_against as goal_diff,
           coalesce(f.last5, '') as form,
           rank() over (order by a.won * 3 + a.drawn desc, a.goals_for - a.goals_against desc, a.goals_for desc) as pos
    from agg a
    left join form f on f.team = a.team
  )
  select jsonb_build_object(
    'ifa_season_id', p_season,
    'ifa_league_id', p_league,
    'league_name', (select name from ifa_leagues l where l.ifa_season_id = p_season and l.ifa_league_id = p_league),
    'games_total', (select count(*) from games),
    'games_counted', (select count(*) from scored),
    'games_awaiting_result', (select count(*) from games where status in ('scheduled', 'played', 'unknown')
                                and game_date < current_date and (home_score is null or away_score is null)),
    'last_result_at', (select max(last_seen_at) from scored),
    'has_results', exists (select 1 from scored),
    'rows', case when exists (select 1 from scored) then coalesce((
      select jsonb_agg(jsonb_build_object(
               'pos', pos, 'ifa_team_id', team, 'name', name, 'app_team_id', app_team_id,
               'played', played, 'won', won, 'drawn', drawn, 'lost', lost,
               'goals_for', goals_for, 'goals_against', goals_against, 'goal_diff', goal_diff,
               'points', points, 'form', form)
             order by pos, name)
      from ranked), '[]'::jsonb) else '[]'::jsonb end
  )
  where auth.uid() is not null;
$$;

create or replace function public.team_league_table(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_link ifa_teams%rowtype;
  v_table jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into v_link from ifa_teams where team_id = p_team order by ifa_season_id desc limit 1;
  if not found then
    return null;
  end if;
  -- league not stored on the team yet: take it from the team's own games
  if v_link.ifa_league_id is null then
    select g.ifa_league_id into v_link.ifa_league_id
    from ifa_games g
    where g.ifa_season_id = v_link.ifa_season_id and g.ifa_league_id is not null
      and v_link.ifa_team_id in (g.home_ifa_team_id, g.away_ifa_team_id)
    group by g.ifa_league_id order by count(*) desc limit 1;
    if v_link.ifa_league_id is null then
      return null;
    end if;
  end if;
  v_table := league_table(v_link.ifa_season_id, v_link.ifa_league_id);
  return v_table
    || jsonb_build_object('our_ifa_team_id', v_link.ifa_team_id)
    || jsonb_build_object('rows', coalesce((
         select jsonb_agg(r || jsonb_build_object('is_us', (r->>'ifa_team_id')::int = v_link.ifa_team_id) order by ord)
         from jsonb_array_elements(v_table->'rows') with ordinality as e(r, ord)), '[]'::jsonb));
end;
$$;

revoke all on function public.league_table(int, int), public.team_league_table(uuid) from public, anon;
grant execute on function public.league_table(int, int), public.team_league_table(uuid) to authenticated;

commit;
