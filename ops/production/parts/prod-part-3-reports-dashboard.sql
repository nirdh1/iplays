-- iPlays 2.0 PRODUCTION part 3 of 6: reports-dashboard
-- Run ONLY in the Production SQL editor, ONLY after: backup PASSED + your approval of this part.
-- Additive. Rollback files: supabase/rollback/<same name>.down.sql
-- Built from: 20261106400000_training_reports_dashboard.sql
do $guard$ begin
  if to_regnamespace('staging') is not null then raise exception 'ABORT: this is the Staging database. Use the staging parts there.'; end if;
  if to_regclass('public.ifa_players') is null or (select count(*) from public.ifa_players) < 1000 then raise exception 'ABORT: this does not look like iPlays Production.'; end if;
  if not (to_regclass('public.session_plans') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'training_sessions' and column_name = 'kind')) then raise exception 'ABORT: part 3 needs part 2 to run first. Nothing changed.'; end if;
  if (to_regclass('public.training_reports') is not null) then raise exception 'ABORT: part 3 already ran here. Nothing changed.'; end if;
end $guard$;

-- ===== 20261106400000_training_reports_dashboard.sql
-- iPlays 2.0 MVP, day 5: the one-minute training report and the club
-- director dashboard (real numbers only).
--
--   training_reports   one per training: per plan block done / skipped / changed,
--                      an optional 1-5 rating and a short note. Written by staff
--                      with training level 3 once the training started.
--   club_dashboard()   per team and in total, over the last N days:
--                      trainings held, attendance from staff marks only,
--                      held trainings with no report, upcoming trainings with no
--                      plan, new exercises in the club library.
--                      Club owner / admin, or a 'reports' grant at club level.
--                      Personal trainings (kind 'personal') are left out.
--                      A number with no data behind it is null, never 0.
--
-- Additive only. Rollback: supabase/rollback/20261106400000_training_reports_dashboard.down.sql

create table if not exists public.training_reports (
  session_id uuid primary key references public.training_sessions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 30),
  rating smallint check (rating between 1 and 5),
  note text not null default '' check (char_length(note) <= 500),
  submitted_by uuid references auth.users (id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_reports_team_idx on public.training_reports (team_id, submitted_at desc);

alter table public.training_reports enable row level security;
drop policy if exists training_reports_select on public.training_reports;
create policy training_reports_select on public.training_reports for select to authenticated using (can_read_plans(team_id));
grant select on public.training_reports to authenticated;
revoke insert, update, delete on public.training_reports from anon, authenticated;

-- p: {"blocks":[{"ord":0,"status":"done"},...], "rating":4, "note":"..."}
create or replace function public.submit_training_report(p_session uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v training_sessions; v_blocks jsonb;
begin
  select * into v from training_sessions where id = p_session;
  if not found or not can(v.team_id, 'training', 3) then raise exception 'not allowed'; end if;
  if v.canceled then raise exception 'training canceled'; end if;
  if v.starts_at > now() + interval '1 hour' then raise exception 'training has not started'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ord', (x ->> 'ord')::int, 'status', x ->> 'status',
                                               'note', left(coalesce(x ->> 'note', ''), 200))), '[]'::jsonb)
    into v_blocks
    from jsonb_array_elements(coalesce(p -> 'blocks', '[]'::jsonb)) x;
  if exists (select 1 from jsonb_array_elements(v_blocks) x where x ->> 'status' not in ('done', 'skipped', 'changed')) then
    raise exception 'bad block status';
  end if;
  insert into training_reports (session_id, team_id, blocks, rating, note)
  values (p_session, v.team_id, v_blocks, (p ->> 'rating')::smallint, left(coalesce(trim(p ->> 'note'), ''), 500))
  on conflict (session_id) do update set blocks = excluded.blocks, rating = excluded.rating, note = excluded.note,
                                         submitted_by = auth.uid(), updated_at = now();
end $$;

create or replace function public.can_view_club_dashboard(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (is_club_admin(p_club) or can_club(p_club, 'reports', 1));
$$;

-- Clubs whose dashboard I may open.
create or replace function public.my_dashboard_clubs()
returns table (club_id uuid, name text) language sql stable security definer set search_path = public as $$
  select c.id, c.name from clubs c
  where c.archived_at is null and can_view_club_dashboard(c.id)
  order by c.name;
$$;

create or replace function public.club_dashboard(p_club uuid, p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_days int := least(greatest(coalesce(p_days, 7), 1), 90);
  v_from timestamptz := now() - make_interval(days => v_days);
  v_to timestamptz := now() + make_interval(days => 7);
  v_teams jsonb;
begin
  if not can_view_club_dashboard(p_club) then return null; end if;
  with t as (
    select id, name from teams where club_id = p_club and archived_at is null
  ), s as (
    select ts.id, ts.team_id, ts.starts_at
    from training_sessions ts join t on t.id = ts.team_id
    where not ts.canceled and ts.kind <> 'personal' and ts.starts_at >= v_from and ts.starts_at < v_to
  ), held as (
    select * from s where starts_at <= now()
  ), marks as (
    select r.session_id, r.status from attendance_records r join held h on h.id = r.session_id
  ), per_team as (
    select t.id, t.name,
      (select count(*) from held h where h.team_id = t.id) as held,
      (select count(distinct m.session_id) from marks m join held h on h.id = m.session_id where h.team_id = t.id) as held_marked,
      (select count(*) from marks m join held h on h.id = m.session_id where h.team_id = t.id and m.status in ('present', 'late')) as came,
      (select count(*) from marks m join held h on h.id = m.session_id where h.team_id = t.id) as marked_cells,
      (select count(*) from held h where h.team_id = t.id and not exists (select 1 from training_reports r where r.session_id = h.id)) as missing_reports,
      (select count(*) from s where s.team_id = t.id and s.starts_at > now()) as upcoming,
      (select count(*) from s where s.team_id = t.id and s.starts_at > now()
         and not exists (select 1 from session_plan_assignments a where a.session_id = s.id)) as upcoming_no_plan,
      (select count(*) from held h where h.team_id = t.id
         and not exists (select 1 from session_plan_assignments a where a.session_id = h.id)) as held_no_plan
    from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'team_id', id, 'name', name, 'held', held, 'held_marked', held_marked, 'marked_cells', marked_cells, 'came', came,
           'attendance_pct', case when marked_cells > 0 then round(100.0 * came / marked_cells) end,
           'missing_reports', missing_reports, 'upcoming', upcoming, 'upcoming_no_plan', upcoming_no_plan,
           'held_no_plan', held_no_plan) order by name), '[]'::jsonb)
    into v_teams from per_team;

  return jsonb_build_object(
    'club_id', p_club,
    'days', v_days,
    'from', v_from,
    'generated_at', now(),
    'teams', v_teams,
    'totals', jsonb_build_object(
      'held', (select coalesce(sum((x ->> 'held')::int), 0) from jsonb_array_elements(v_teams) x),
      'marked_cells', (select coalesce(sum((x ->> 'marked_cells')::int), 0) from jsonb_array_elements(v_teams) x),
      'attendance_pct', (select case when sum((x ->> 'marked_cells')::int) > 0
                                     then round(100.0 * sum((x ->> 'came')::int) / sum((x ->> 'marked_cells')::int)) end
                         from jsonb_array_elements(v_teams) x),
      'missing_reports', (select coalesce(sum((x ->> 'missing_reports')::int), 0) from jsonb_array_elements(v_teams) x),
      'upcoming', (select coalesce(sum((x ->> 'upcoming')::int), 0) from jsonb_array_elements(v_teams) x),
      'upcoming_no_plan', (select coalesce(sum((x ->> 'upcoming_no_plan')::int), 0) from jsonb_array_elements(v_teams) x),
      'new_club_exercises', (select count(*) from exercises e where e.scope = 'club' and e.club_id = p_club and e.created_at >= v_from)
    )
  );
end $$;

revoke all on function public.submit_training_report(uuid, jsonb), public.can_view_club_dashboard(uuid),
  public.my_dashboard_clubs(), public.club_dashboard(uuid, int) from public, anon;
grant execute on function public.submit_training_report(uuid, jsonb), public.can_view_club_dashboard(uuid),
  public.my_dashboard_clubs(), public.club_dashboard(uuid, int) to authenticated;

select 3 as part_done, 'reports-dashboard' as label;
