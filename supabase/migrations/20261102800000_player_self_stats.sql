-- iplays — career: goals and assists the family reports itself.
--
-- Run after 20261101985000_player_career.sql (and the 2026-11-02 migrations).
-- Rollback: supabase/rollback/20261102800000_player_self_stats.down.sql
-- Additive only: one new table and RPCs. No existing row is changed.
--
-- A child has no login of their own, so "the player updates it" means the
-- child's parent (player_guardians.relation = 'parent') on the child's
-- behalf. One row per game: either a game of one of the child's teams
-- (team_matches) or a game outside the app (date + opponent typed in).
--
-- These numbers are SELF-REPORTED. They are shown on their own, marked as
-- such, and are never added to the goals reported live in the app
-- (match_events) or to the official IFA numbers.
--
-- Who sees them: the same people who see the child's metrics (parents,
-- staff of a current team with metrics level >= 1, platform admins).
-- Writes go only through the RPCs below.

begin;

create table if not exists public.player_self_stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  match_id uuid references public.team_matches(id) on delete set null,
  played_on date not null,
  opponent text not null check (char_length(opponent) between 1 and 80),
  goals int not null default 0 check (goals between 0 and 30),
  assists int not null default 0 check (assists between 0 and 30),
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- one live report per app game
create unique index if not exists player_self_stats_one_per_match
  on public.player_self_stats (player_id, match_id)
  where match_id is not null and deleted_at is null;
create index if not exists player_self_stats_player on public.player_self_stats (player_id, played_on);

alter table public.player_self_stats enable row level security;
drop policy if exists player_self_stats_read on public.player_self_stats;
create policy player_self_stats_read on public.player_self_stats for select to authenticated
  using (deleted_at is null and can_view_player_metrics(player_id));
grant select on public.player_self_stats to authenticated;

-- Save (insert, or update when p_id is given). Parent only.
create or replace function public.save_self_stat(
  p_player uuid, p_id uuid, p_match uuid, p_date date, p_opponent text,
  p_goals int, p_assists int, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_date date := p_date;
  v_opp text := nullif(btrim(coalesce(p_opponent, '')), '');
  v_match team_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can report goals and assists';
  end if;
  if coalesce(p_goals, 0) < 0 or coalesce(p_goals, 0) > 30 or coalesce(p_assists, 0) < 0 or coalesce(p_assists, 0) > 30 then
    raise exception 'goals and assists must be between 0 and 30';
  end if;

  if p_match is not null then
    -- an app game: must be a past, not-canceled game of a team the child was in on that day
    select tm.* into v_match from team_matches tm
    where tm.id = p_match and tm.status <> 'canceled' and tm.starts_at < now()
      and exists (select 1 from player_assignments a
                  where a.player_id = p_player and a.team_id = tm.team_id
                    and (tm.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
                    and (a.ended_on is null or (tm.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on));
    if not found then raise exception 'this game is not one of the child''s past games'; end if;
    v_date := (v_match.starts_at at time zone 'Asia/Jerusalem')::date;
    v_opp := left(v_match.opponent, 80);
  else
    if v_date is null or v_date > current_date then raise exception 'pick a date that is not in the future'; end if;
    if v_opp is null then raise exception 'opponent is required'; end if;
  end if;

  if v_id is null and p_match is not null then
    -- reporting the same game again edits the existing report
    select id into v_id from player_self_stats
    where player_id = p_player and match_id = p_match and deleted_at is null;
  end if;

  if v_id is null then
    insert into player_self_stats (player_id, match_id, played_on, opponent, goals, assists, note)
    values (p_player, p_match, v_date, left(v_opp, 80), coalesce(p_goals, 0), coalesce(p_assists, 0),
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
    returning id into v_id;
  else
    update player_self_stats set match_id = p_match, played_on = v_date, opponent = left(v_opp, 80),
           goals = coalesce(p_goals, 0), assists = coalesce(p_assists, 0),
           note = nullif(left(btrim(coalesce(p_note, '')), 200), ''), updated_at = now()
    where id = v_id and player_id = p_player and deleted_at is null;
    if not found then raise exception 'report not found'; end if;
  end if;
  return v_id;
end $$;

-- Soft delete (the row stays, hidden). Parent only.
create or replace function public.remove_self_stat(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  select player_id into v_player from player_self_stats where id = p_id and deleted_at is null;
  if v_player is null or not is_player_parent(v_player) then raise exception 'report not found'; end if;
  update player_self_stats set deleted_at = now(), updated_at = now() where id = p_id;
end $$;

-- Everything the career section needs. null when the caller may not see it.
create or replace function public.player_self_stats_view(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_player_metrics(p_player) then return null; end if;
  return jsonb_build_object(
    'can_edit', is_player_parent(p_player),
    'totals', (select jsonb_build_object('games', count(*), 'goals', coalesce(sum(goals), 0), 'assists', coalesce(sum(assists), 0))
               from player_self_stats where player_id = p_player and deleted_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'match_id', s.match_id, 'date', s.played_on,
               'opponent', s.opponent, 'goals', s.goals, 'assists', s.assists, 'note', s.note,
               'team_name', t.name) order by s.played_on desc, s.created_at desc)
      from player_self_stats s
      left join team_matches tm on tm.id = s.match_id
      left join teams t on t.id = tm.team_id
      where s.player_id = p_player and s.deleted_at is null), '[]'::jsonb),
    -- the child's past games of the last 200 days, to pick from (parents only)
    'recent_games', case when is_player_parent(p_player) then coalesce((
      select jsonb_agg(jsonb_build_object('id', tm.id, 'date', (tm.starts_at at time zone 'Asia/Jerusalem')::date,
               'opponent', tm.opponent, 'team_name', t.name,
               'reported', exists (select 1 from player_self_stats s where s.player_id = p_player
                                   and s.match_id = tm.id and s.deleted_at is null))
             order by tm.starts_at desc)
      from team_matches tm join teams t on t.id = tm.team_id
      where tm.status <> 'canceled' and tm.starts_at < now() and tm.starts_at > now() - interval '200 days'
        and exists (select 1 from player_assignments a
                    where a.player_id = p_player and a.team_id = tm.team_id
                      and (tm.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
                      and (a.ended_on is null or (tm.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on))
      ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

revoke all on function public.save_self_stat(uuid, uuid, uuid, date, text, int, int, text) from public, anon;
revoke all on function public.remove_self_stat(uuid) from public, anon;
revoke all on function public.player_self_stats_view(uuid) from public, anon;
grant execute on function public.save_self_stat(uuid, uuid, uuid, date, text, int, int, text) to authenticated;
grant execute on function public.remove_self_stat(uuid) to authenticated;
grant execute on function public.player_self_stats_view(uuid) to authenticated;

commit;
