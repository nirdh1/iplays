-- iPlays PRODUCTION part 11: "derby" card for kids and parents (north vs south,
-- same birth year, personal trainings included). Run ONLY in the Production SQL
-- editor, ONLY after your approval of this part.
-- Adds TWO read-only functions: team_area() and team_derby().
-- No table, row or existing permission changes. Team averages only; a family
-- sees its own children's personal-training count, nobody else's.
-- Rollback: drop function public.team_derby(uuid, int); drop function public.team_area(text);
-- Built from: supabase/migrations/20261109500000_team_derby.sql
do $guard$ begin
  if to_regnamespace('staging') is not null then raise exception 'ABORT: this is the Staging database. Nothing changed.'; end if;
  if to_regclass('public.ifa_players') is null or (select count(*) from public.ifa_players) < 1000 then raise exception 'ABORT: this does not look like iPlays Production. Nothing changed.'; end if;
  if to_regclass('public.training_participants') is null or to_regprocedure('public.family_can(uuid,text)') is null then raise exception 'ABORT: needs the calendar and family parts first. Nothing changed.'; end if;
  if to_regprocedure('public.team_derby(uuid,int)') is not null then raise exception 'ABORT: part 11 already ran here. Nothing changed.'; end if;
end $guard$;

-- "Derby" card for kids and parents (user 2026-11-09): the same birth year in the
-- sister clubs of one house (north / south / center) side by side, to push kids
-- to train more, including personal trainings that families log themselves.
--
--   team_area(name)          the area word in a team name (צפון, דרום, מרכז, מזרח,
--                            מערב), or null. Same rule as src/os/areas.ts.
--   team_derby(team, weeks)  for a team of a club: every club team of the same
--                            birth year (most common year in the active roster)
--                            grouped by area, with team averages only:
--                              team trainings held per week (per team),
--                              personal trainings per kid per week,
--                              % of kids who logged at least one personal training,
--                              personal trainings in total;
--                            plus, for the caller's own children only, their own
--                            personal trainings (what they add to the score).
--
-- Privacy: aggregates only, never another child's name, number or own count. An area
-- shows numbers only when it has at least 5 kids in its rosters, so nobody can be
-- singled out. A personal training's title, place and time are never returned.
-- Who: members of the team (parents, players, staff). Read-only.
-- Rollback: supabase/rollback/20261109500000_team_derby.down.sql

create or replace function public.team_area(p_name text)
returns text language sql immutable set search_path = public as $$
  select a from unnest(array['צפון', 'דרום', 'מרכז', 'מזרח', 'מערב']) with ordinality as x(a, n)
  where coalesce(p_name, '') ~ ('(^|[[:space:]\-–·(])' || a || '($|[[:space:]\-–·)])')
  order by n limit 1;
$$;

create or replace function public.team_derby(p_team uuid, p_weeks int default 4)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_weeks int := least(greatest(coalesce(p_weeks, 4), 1), 12);
  v_from timestamptz := now() - make_interval(days => 7 * v_weeks);
  v_club uuid;
  v_name text;
  v_year int;
  v_out jsonb;
begin
  if auth.uid() is null or not is_team_member(p_team) then return null; end if;
  select club_id, name into v_club, v_name from teams where id = p_team and archived_at is null;
  if v_club is null or team_area(v_name) is null then return null; end if;
  v_year := (select p.birth_year from player_assignments a join players p on p.id = a.player_id
             where a.team_id = p_team and a.ended_on is null and p.birth_year is not null
             group by p.birth_year order by count(*) desc, p.birth_year desc limit 1);
  if v_year is null then return null; end if;

  with t as (
    select tm.id, tm.name, team_area(tm.name) as area
    from teams tm
    where tm.club_id = v_club and tm.archived_at is null and team_area(tm.name) is not null
      and (select p.birth_year from player_assignments a join players p on p.id = a.player_id
           where a.team_id = tm.id and a.ended_on is null and p.birth_year is not null
           group by p.birth_year order by count(*) desc, p.birth_year desc limit 1) = v_year
  ), kids as (
    select distinct t.area, a.player_id
    from t join player_assignments a on a.team_id = t.id and a.ended_on is null
  ), team_held as (
    select t.area, t.id, (select count(*) from training_sessions s
                          where s.team_id = t.id and s.kind = 'team' and not s.canceled
                            and s.starts_at >= v_from and s.starts_at <= now()) as held
    from t
  ), personal as (
    select k.area, k.player_id, count(distinct s.id) as n
    from kids k
    join training_participants tp on tp.player_id = k.player_id
    join training_sessions s on s.id = tp.session_id
    where s.kind = 'personal' and not s.canceled and s.starts_at >= v_from and s.starts_at <= now()
    group by k.area, k.player_id
  ), per_area as (
    select a.area,
           (select count(*) from t where t.area = a.area) as teams,
           (select count(*) from kids k where k.area = a.area) as kids,
           (select avg(h.held) from team_held h where h.area = a.area) as team_held,
           (select coalesce(sum(p.n), 0) from personal p where p.area = a.area) as personal,
           (select count(*) from personal p where p.area = a.area) as kids_personal
    from (select distinct area from t) a
  )
  select jsonb_build_object(
    'birth_year', v_year,
    'weeks', v_weeks,
    'our_area', team_area(v_name),
    'areas', coalesce(jsonb_agg(jsonb_build_object(
      'area', pa.area,
      'teams', pa.teams,
      'enough', pa.kids >= 5,
      'kids', case when pa.kids >= 5 then pa.kids end,
      'team_per_week', case when pa.kids >= 5 then round(pa.team_held / v_weeks, 1) end,
      'personal_per_kid_week', case when pa.kids >= 5 then round(pa.personal::numeric / pa.kids / v_weeks, 2) end,
      'pct_kids_personal', case when pa.kids >= 5 then round(100.0 * pa.kids_personal / pa.kids) end,
      'personal_total', case when pa.kids >= 5 then pa.personal end
    ) order by array_position(array['צפון', 'דרום', 'מרכז', 'מזרח', 'מערב'], pa.area)), '[]'::jsonb)
  ) into v_out
  from per_area pa;

  if jsonb_array_length(v_out -> 'areas') < 2 then return null; end if;
  -- the caller's own children in this team: their personal trainings, for the
  -- family only (family_can view), so the child sees what they add to the score
  v_out := v_out || jsonb_build_object('mine', coalesce((
    select jsonb_agg(jsonb_build_object('player_id', p.id, 'first_name', p.first_name,
             'personal', (select count(distinct s.id) from training_participants tp
                          join training_sessions s on s.id = tp.session_id
                          where tp.player_id = p.id and s.kind = 'personal' and not s.canceled
                            and s.starts_at >= v_from and s.starts_at <= now()))
           order by p.first_name)
    from player_assignments a join players p on p.id = a.player_id
    where a.team_id = p_team and a.ended_on is null and family_can(p.id, 'view')), '[]'::jsonb));
  return v_out;
end $$;

revoke all on function public.team_derby(uuid, int) from public, anon;
grant execute on function public.team_derby(uuid, int) to authenticated;
grant execute on function public.team_area(text) to authenticated;

