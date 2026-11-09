-- iPlays PRODUCTION part 10: director dashboard trends + drill usage
-- (graphic dashboard, north vs south). Run ONLY in the Production SQL editor,
-- ONLY after your approval of this part.
-- Adds TWO read-only functions: club_trends() and club_drill_usage().
-- No table, row or existing permission changes. No player data.
-- Only for people who may open the club dashboard.
-- Rollback: drop function public.club_trends(uuid, int); drop function public.club_drill_usage(uuid, int);
-- Built from: supabase/migrations/20261109400000_club_trends_drills.sql
do $guard$ begin
  if to_regnamespace('staging') is not null then raise exception 'ABORT: this is the Staging database. Nothing changed.'; end if;
  if to_regclass('public.ifa_players') is null or (select count(*) from public.ifa_players) < 1000 then raise exception 'ABORT: this does not look like iPlays Production. Nothing changed.'; end if;
  if to_regprocedure('public.can_view_club_dashboard(uuid)') is null or to_regclass('public.session_plan_assignments') is null or to_regclass('public.exercise_topics') is null then raise exception 'ABORT: needs the Club OS parts first. Nothing changed.'; end if;
  if to_regprocedure('public.club_trends(uuid,int)') is not null then raise exception 'ABORT: part 10 already ran here. Nothing changed.'; end if;
end $guard$;

-- Club director dashboard, graphic version (user 2026-11-09: "יותר תכליתי
-- ומקצועי ויותר גרפי"). Two read-only functions, no table or row changes.
--
--   club_trends(club, weeks)      per calendar week (Sunday start, Israel time):
--                                 trainings held, attendance from staff marks,
--                                 % with a plan, % with a 1-minute report.
--                                 Club totals and per team.
--   club_drill_usage(club, days)  which exercises each club team really used
--                                 (from the plan frozen on held trainings).
--                                 Titles only for shared exercises (club or
--                                 iPlays library). A coach's personal exercises
--                                 are counted, never named (decision OD-28/29:
--                                 personal exercises belong to the coach).
--
-- Who: the same people who may open the club dashboard (can_view_club_dashboard).
-- No players and no personal data.
-- Rollback: supabase/rollback/20261109400000_club_trends_drills.down.sql

create or replace function public.club_trends(p_club uuid, p_weeks int default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_weeks int := least(greatest(coalesce(p_weeks, 8), 2), 26);
  -- Sunday of this week, Israel time
  v_this date := (now() at time zone 'Asia/Jerusalem')::date
                 - extract(dow from (now() at time zone 'Asia/Jerusalem'))::int;
  v_from date := v_this - 7 * (v_weeks - 1);
  v_out jsonb;
begin
  if not can_view_club_dashboard(p_club) then return null; end if;
  with t as (
    select id, name from teams where club_id = p_club and archived_at is null
  ), w as (
    select g::date as wk from generate_series(v_from, v_this, interval '7 days') g
  ), held as (
    select ts.id, ts.team_id,
           ((ts.starts_at at time zone 'Asia/Jerusalem')::date
            - extract(dow from (ts.starts_at at time zone 'Asia/Jerusalem'))::int) as wk
    from training_sessions ts join t on t.id = ts.team_id
    where not ts.canceled and ts.kind <> 'personal'
      and ts.starts_at <= now()
      and ts.starts_at >= (v_from::timestamp at time zone 'Asia/Jerusalem')
  ), per as (
    select h.team_id, h.wk,
           count(*) as held,
           count(*) filter (where exists (select 1 from session_plan_assignments a where a.session_id = h.id)) as with_plan,
           count(*) filter (where exists (select 1 from training_reports r where r.session_id = h.id)) as with_report,
           (select count(*) from attendance_records r join held h2 on h2.id = r.session_id
             where h2.team_id = h.team_id and h2.wk = h.wk) as cells,
           (select count(*) from attendance_records r join held h2 on h2.id = r.session_id
             where h2.team_id = h.team_id and h2.wk = h.wk and r.status in ('present', 'late')) as came
    from held h group by h.team_id, h.wk
  ), club_w as (
    select w.wk,
           coalesce(sum(p.held), 0) as held, coalesce(sum(p.with_plan), 0) as with_plan,
           coalesce(sum(p.with_report), 0) as with_report,
           coalesce(sum(p.cells), 0) as cells, coalesce(sum(p.came), 0) as came
    from w left join per p on p.wk = w.wk group by w.wk
  )
  select jsonb_build_object(
    'club_id', p_club,
    'generated_at', now(),
    'weeks', (select jsonb_agg(jsonb_build_object(
                'start', c.wk, 'held', c.held,
                'attendance_pct', case when c.cells > 0 then round(100.0 * c.came / c.cells) end,
                'plan_pct', case when c.held > 0 then round(100.0 * c.with_plan / c.held) end,
                'report_pct', case when c.held > 0 then round(100.0 * c.with_report / c.held) end
              ) order by c.wk) from club_w c),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                'team_id', t.id, 'name', t.name,
                'weeks', (select jsonb_agg(jsonb_build_object(
                            'start', w.wk, 'held', coalesce(p.held, 0),
                            'attendance_pct', case when p.cells > 0 then round(100.0 * p.came / p.cells) end,
                            'plan_pct', case when p.held > 0 then round(100.0 * p.with_plan / p.held) end
                          ) order by w.wk)
                          from w left join per p on p.wk = w.wk and p.team_id = t.id)
              ) order by t.name) from t), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

create or replace function public.club_drill_usage(p_club uuid, p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := least(greatest(coalesce(p_days, 90), 7), 365);
  v_out jsonb;
begin
  if not can_view_club_dashboard(p_club) then return null; end if;
  with used as (
    -- every exercise in the plan frozen on a held training: blocks and stations
    select ts.team_id, ts.id as session_id, (x ->> 'id')::uuid as exercise_id
    from training_sessions ts
    join teams tm on tm.id = ts.team_id and tm.club_id = p_club and tm.archived_at is null
    join session_plan_assignments a on a.session_id = ts.id
    cross join lateral (
      select b -> 'exercise' as x from jsonb_array_elements(coalesce(a.snapshot -> 'blocks', '[]'::jsonb)) b
      union all
      select s -> 'exercise' from jsonb_array_elements(coalesce(a.snapshot -> 'blocks', '[]'::jsonb)) b,
                                  jsonb_array_elements(coalesce(b -> 'stations', '[]'::jsonb)) s
    ) ex
    where not ts.canceled and ts.kind <> 'personal' and ts.starts_at <= now()
      and ts.starts_at >= now() - make_interval(days => v_days)
      and jsonb_typeof(x) = 'object' and (x ->> 'id') ~ '^[0-9a-f-]{36}$'
  ), agg as (
    select u.team_id, u.exercise_id, count(distinct u.session_id) as sessions
    from used u group by u.team_id, u.exercise_id
  )
  select jsonb_build_object(
    'club_id', p_club, 'days', v_days, 'generated_at', now(),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
               'team_id', g.team_id, 'exercise_id', e.id, 'title', e.title, 'scope', e.scope,
               'category', e.category,
               'topics', coalesce((select jsonb_agg(tp.label order by tp.sort) from exercise_topics tp
                                   where tp.code = any (coalesce(e.topics, '{}'))), '[]'::jsonb),
               'sessions', g.sessions) order by g.sessions desc, e.title)
             from agg g join exercises e on e.id = g.exercise_id
             where e.status = 'active'
               and (e.scope = 'iplays' or (e.scope = 'club' and e.club_id = p_club))), '[]'::jsonb),
    'personal', coalesce((select jsonb_agg(jsonb_build_object('team_id', x.team_id, 'sessions', x.n))
                          from (select g.team_id, sum(g.sessions) as n from agg g join exercises e on e.id = g.exercise_id
                                where e.scope = 'personal' group by g.team_id) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

revoke all on function public.club_trends(uuid, int), public.club_drill_usage(uuid, int) from public, anon;
grant execute on function public.club_trends(uuid, int), public.club_drill_usage(uuid, int) to authenticated;

