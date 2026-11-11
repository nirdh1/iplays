-- iPlays STAGING, add-on part 11 (dashboard-metrics). NEVER run on Production.
-- Run in the SQL Editor of the Staging project, after part 9.
do $$
begin
  if to_regclass('staging.bundle_progress') is null then
    raise exception 'ABORT: this database is not a Staging project in progress (run parts 1-9 first).';
  end if;
  if not exists (select 1 from staging.bundle_progress where part = 9) then
    raise exception 'ABORT: run part 9 first.';
  end if;
  if exists (select 1 from staging.bundle_progress where part = 11) then
    raise exception 'ABORT: part 11 already ran here.';
  end if;
end $$;

-- ==== 20261109100000_adopt_candidates_info.sql ====
-- Club "חיפוש" tab: tell look-alike teams apart before a club adopts one.
-- Many IFA catalog teams share a name ("הפועל רמת גן דרום" x5) and have no age
-- group, so the club admin cannot see which is which. This returns, for teams
-- that are still free to adopt (no club), the league, the season, and the most
-- common birth year in the active roster. Aggregates only: no player names.
-- Who: a club owner/admin (of any club) or a platform admin. Read-only.
-- Rollback: supabase/rollback/20261109100000_adopt_candidates_info.down.sql
begin;

create or replace function public.adopt_candidates_info(p_teams uuid[])
returns table (team_id uuid, league text, season text, roster_year int, roster_players int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not (is_platform_admin() or exists (
    select 1 from club_staff s where s.user_id = auth.uid() and s.role in ('owner', 'admin')
  )) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_teams, 1), 0) > 100 then
    raise exception 'too many teams' using errcode = '22023';
  end if;
  return query
  select t.id,
         coalesce(nullif(il.name, ''), nullif(t.league, ''), '') as league,
         t.season,
         (select p.birth_year from player_assignments a join players p on p.id = a.player_id
           where a.team_id = t.id and a.ended_on is null and p.birth_year is not null
           group by p.birth_year order by count(*) desc, p.birth_year desc limit 1),
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null)
  from teams t
  left join ifa_teams it on it.team_id = t.id
  left join ifa_leagues il on il.ifa_season_id = it.ifa_season_id and il.ifa_league_id = it.ifa_league_id
  where t.id = any (p_teams) and t.club_id is null and t.archived_at is null;
end;
$$;

revoke all on function public.adopt_candidates_info(uuid[]) from public, anon;
grant execute on function public.adopt_candidates_info(uuid[]) to authenticated;

commit;


-- ==== 20261109200000_club_team_results.sql ====
-- Club director dashboard: results and coach per club team (decision 2026-11-09:
-- "מאזנים והשוואת מאמנים"). Read-only, function only: no table or row changes.
-- For each team of the club: its IFA league standing (same rules as
-- team_league_table(): only IFA-published results, win 3 / draw 1), last-5 form,
-- the IFA head coach's name (public on the IFA site) and the app coaches' names.
-- Who: the same people who may open the club dashboard (can_view_club_dashboard).
-- No players, no personal data beyond staff names.
-- Rollback: supabase/rollback/20261109200000_club_team_results.down.sql
begin;

create or replace function public.club_team_results(p_club uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_t record;
  v_tab jsonb;
  v_us jsonb;
begin
  if not can_view_club_dashboard(p_club) then return null; end if;
  for v_t in select id, name from teams where club_id = p_club and archived_at is null order by name loop
    v_tab := team_league_table(v_t.id);
    v_us := (select r from jsonb_array_elements(coalesce(v_tab -> 'rows', '[]'::jsonb)) r where (r ->> 'is_us')::boolean limit 1);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'team_id', v_t.id,
      'name', v_t.name,
      'linked', v_tab is not null,
      'league_name', v_tab ->> 'league_name',
      'has_results', coalesce((v_tab ->> 'has_results')::boolean, false),
      'league_teams', jsonb_array_length(coalesce(v_tab -> 'rows', '[]'::jsonb)),
      'last_result_at', v_tab ->> 'last_result_at',
      'pos', (v_us ->> 'pos')::int,
      'played', (v_us ->> 'played')::int,
      'won', (v_us ->> 'won')::int,
      'drawn', (v_us ->> 'drawn')::int,
      'lost', (v_us ->> 'lost')::int,
      'goals_for', (v_us ->> 'goals_for')::int,
      'goals_against', (v_us ->> 'goals_against')::int,
      'points', (v_us ->> 'points')::int,
      'form', coalesce(v_us ->> 'form', ''),
      'ifa_coach', (select it.coaches -> 0 ->> 'name' from ifa_teams it
                    where it.team_id = v_t.id order by it.ifa_season_id desc limit 1),
      'app_coaches', coalesce((select jsonb_agg(distinct nullif(p.full_name, '')) filter (where nullif(p.full_name, '') is not null)
                               from team_members m join profiles p on p.id = m.user_id
                               where m.team_id = v_t.id and m.role in ('coach', 'admin')), '[]'::jsonb)
    ));
  end loop;
  return jsonb_build_object('club_id', p_club, 'generated_at', now(), 'teams', v_out);
end $$;

revoke all on function public.club_team_results(uuid) from public, anon;
grant execute on function public.club_team_results(uuid) to authenticated;

commit;


-- ==== 20261109300000_goal_alerts.sql ====
-- iplays — goal alerts: a push / bell notification to the whole team for
-- every goal that counts, with the score, minute, scorer and goal type.
--
-- Run after 20261102600000_live_match_session.sql and
-- 20261101995000_inbox_notifications.sql.
-- Rollback: supabase/rollback/20261109300000_goal_alerts.down.sql
-- Additive: one column on match_events, one more
-- notification kind, a trigger, one RPC. No row is changed or removed.
--
-- Product request (2026-11-09, project owner): goal reporting "like playday"
-- (UX inspiration only, none of its data): every parent in the team gets
-- "גול! הפועל רמת גן 1:0 הפועל אשקלון · דקה 23 · יונתן כהן (#9) · בעיטה חופשית".
-- * One notification per goal that counts (a goal by the primary reporter,
--   an approved report, or any report while no one holds the role). Pending
--   reports and cards do not notify. The person who made the goal count is not
--   notified about their own action (notify_users).
-- * Uses the existing "match results" preference, so a parent who turned
--   results off gets no goal alerts.
-- * goal_type: free_kick | penalty | header | own_goal | other (optional).

begin;

alter table public.match_events add column if not exists goal_type text
  check (goal_type in ('free_kick', 'penalty', 'header', 'own_goal', 'other'));

-- ------------------------------------------------------ notification kind

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'notification_outbox_kind_check' and conrelid = 'public.notification_outbox'::regclass;
  -- the definition is either kind IN ('a', 'b') or kind = ANY ('{a,b}'::text[]):
  -- take every lower-case word but the column name and the type
  select coalesce(array_agg(distinct m[1]), '{}') into v_kinds
  from regexp_matches(coalesce(v_def, ''), '([a-z_]+)', 'g') m
  where m[1] not in ('kind', 'text');
  if 'live_goal' = any (v_kinds) then
    return;
  end if;
  v_kinds := v_kinds || array['live_goal'];
  select array_agg(distinct k order by k) into v_kinds from unnest(v_kinds) k;
  alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
  execute format('alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind = any (%L::text[])) not valid',
                 v_kinds);
end;
$$;

-- --------------------------------------------------------------- labels

create or replace function public.goal_type_label(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'free_kick' then 'בעיטה חופשית'
    when 'penalty' then 'פנדל'
    when 'header' then 'נגיחה'
    when 'own_goal' then 'שער עצמי'
  end;
$$;

-- ---------------------------------------------------------------- trigger

create or replace function public.notify_live_goal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  v_team text;
  v_home_name text;
  v_away_name text;
  v_home int;
  v_away int;
  v_scorer text;
  v_body text;
  v_basket boolean;
begin
  if new.kind <> 'goal' or new.deleted_at is not null then
    return new;
  end if;
  select * into m from team_matches where id = new.match_id;
  if not found or m.status = 'canceled' then
    return new;
  end if;
  select name, sport = 'basketball' into v_team, v_basket from teams where id = new.team_id;
  v_home_name := case when m.home then v_team else m.opponent end;
  v_away_name := case when m.home then m.opponent else v_team end;
  select coalesce(sum(points) filter (where side = 'home'), 0), coalesce(sum(points) filter (where side = 'away'), 0)
    into v_home, v_away
  from match_events where match_id = new.match_id and kind = 'goal' and deleted_at is null;
  select nullif(trim(p.first_name || ' ' || p.last_name), '') into v_scorer from players p where p.id = new.player_id;
  v_scorer := coalesce(v_scorer, new.player_name);
  if v_scorer is not null and new.shirt_number is not null then
    v_scorer := v_scorer || ' (#' || new.shirt_number || ')';
  elsif v_scorer is null and new.shirt_number is not null then
    v_scorer := 'מספר ' || new.shirt_number;
  end if;
  v_body := concat_ws(' · ',
    case when new.minute is not null then 'דקה ' || new.minute end,
    v_scorer,
    goal_type_label(new.goal_type),
    'ל' || case when new.side = 'home' then v_home_name else v_away_name end);
  perform notify_users(
    team_member_ids(new.team_id), new.team_id, 'live_goal',
    case when v_basket then 'סל! ' else 'גול! ' end || v_home_name || ' ' || v_home || ':' || v_away || ' ' || v_away_name,
    v_body,
    '#matches/' || new.team_id || '/' || new.match_id,
    new.id, 'match_results');
  return new;
end;
$$;

drop trigger if exists match_events_notify_goal on public.match_events;
create trigger match_events_notify_goal after insert on public.match_events
  for each row execute function public.notify_live_goal();

-- ------------------------------------------------------------------ RPCs

-- Set or clear the goal type of a counted goal (same rules as the scorer:
-- whoever may edit the event, or its sender while no type is set yet).
create or replace function public.set_match_goal_type(p_event uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e match_events%rowtype;
begin
  select * into e from match_events where id = p_event and deleted_at is null;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if not (can_edit_match_event(e.match_id, e.team_id) or (e.created_by = auth.uid() and e.goal_type is null and can_report_match(e.team_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('free_kick', 'penalty', 'header', 'own_goal', 'other') then
    raise exception 'unknown goal type' using errcode = '22023';
  end if;
  update match_events set goal_type = p_type where id = p_event;
end;
$$;

-- The feed gains goal_type.
drop function if exists public.match_events_feed(uuid);
create function public.match_events_feed(p_match uuid)
returns table (
  id uuid, kind text, side text, points int, shirt_number int, player_id uuid, scorer_name text,
  minute int, period int, clock_seconds int, created_at timestamptz, created_by uuid, reporter_name text,
  goal_type text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_matches where team_matches.id = p_match;
  if v_team is null or not (is_team_member(v_team) or can(v_team, 'matches', 1)) then
    return;
  end if;
  return query
  select e.id, e.kind, e.side, e.points::int, e.shirt_number::int, e.player_id,
         coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), e.player_name),
         e.minute::int, e.period::int, e.clock_seconds, e.created_at, e.created_by, nullif(pr.full_name, ''),
         e.goal_type
  from match_events e
  left join players p on p.id = e.player_id
  left join profiles pr on pr.id = e.created_by
  where e.match_id = p_match and e.deleted_at is null
  order by coalesce(e.clock_seconds, 0), e.created_at;
end;
$$;

revoke all on function public.notify_live_goal(), public.goal_type_label(text) from public, anon, authenticated;
revoke all on function public.set_match_goal_type(uuid, text), public.match_events_feed(uuid) from public, anon;
grant execute on function public.set_match_goal_type(uuid, text), public.match_events_feed(uuid) to authenticated;

commit;


-- ==== 20261109400000_club_trends_drills.sql ====
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
begin;

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

commit;


-- ==== 20261109500000_team_derby.sql ====
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
begin;

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

commit;


insert into staging.bundle_progress (part) values (11);
select 11 as part_done, 'dashboard-metrics' as label;
