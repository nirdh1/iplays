-- iPlays 2.0, phase A: Executive Decision Cockpit + Management Interventions
-- (user approval 2026-11-11, Staging first).
--
-- An "intervention" is what a club manager decides to do about one insight on
-- the dashboard (attendance not marked, attendance dropping, results falling,
-- reports missing, trainings without a plan, a drill transfer between coaches).
-- Life cycle: open -> in_progress -> checking -> closed (or canceled).
--
--   club_interventions      one row per decision. owner, status, due date,
--                           baseline metric (taken by the server when opened),
--                           current metric (re-measured by the server), outcome
--                           and a written professional conclusion on close.
--   club_intervention_log   every action, who and when.
--
-- Rules
--   * One open intervention per insight: the server builds the insight key
--     (kind + team, or kind + 'club'), and a unique partial index enforces it.
--     Opening the same insight again returns the open one.
--   * Metrics come only from real rows (attendance marks, reports, plans,
--     IFA league table). No data -> null ("no data"), never 0 or 100.
--   * Who sees: club owner/admin and holders of the club "reports" grant
--     (can_view_club_dashboard) see all of the club's interventions; the
--     professional staff of a team (my_level(team, 'pro_notes') >= 2: coach,
--     assistant, instructor) see their team's; the owner sees their own.
--     Parents and players see nothing.
--   * Who changes: club owner/admin or "reports" level 3 open, assign, set due
--     dates, close and cancel. The owner and the team's professional staff may
--     add notes, move to in progress / for checking, and re-measure.
--   * No direct writes: tables are read-only to clients, all writes via RPCs.
--   * No deletes: an intervention is canceled, never deleted.
--
-- Additive only: two new tables and new functions. Nothing existing changes.
-- Rollback: supabase/rollback/20261111100000_club_interventions.down.sql
begin;

create table public.club_interventions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  team_id uuid references public.teams (id) on delete set null,
  insight_key text not null check (char_length(insight_key) between 3 and 120),
  kind text not null check (kind in ('missing_marks', 'attendance_drop', 'results_down', 'missing_reports', 'no_plan', 'drill_transfer')),
  metric text not null check (metric in ('marked_pct', 'attendance_pct', 'form_ppg', 'report_pct', 'plan_pct', 'drills_adopted')),
  context jsonb not null default '{}'::jsonb,
  title text not null check (char_length(title) between 3 and 160),
  why text not null default '' check (char_length(why) <= 1000),
  action_plan text not null default '' check (char_length(action_plan) <= 1000),
  owner_id uuid references auth.users (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'checking', 'closed', 'canceled')),
  due_on date,
  baseline_value numeric,
  baseline_at timestamptz not null default now(),
  current_value numeric,
  current_at timestamptz,
  outcome text check (outcome in ('improved', 'no_change', 'worse', 'inconclusive')),
  conclusion text check (char_length(conclusion) <= 2000),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint club_interventions_closed_has_conclusion
    check (status <> 'closed' or (outcome is not null and char_length(trim(coalesce(conclusion, ''))) >= 10))
);
-- the duplicate guard: one open intervention per insight per club
create unique index club_interventions_one_open on public.club_interventions (club_id, insight_key)
  where status in ('open', 'in_progress', 'checking');
create index club_interventions_club_idx on public.club_interventions (club_id, status, created_at desc);
create index club_interventions_team_idx on public.club_interventions (team_id);
create index club_interventions_owner_idx on public.club_interventions (owner_id);

create table public.club_intervention_log (
  id bigint generated always as identity primary key,
  intervention_id uuid not null references public.club_interventions (id) on delete restrict,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null default auth.uid(),
  action text not null check (action in ('opened', 'status', 'note', 'owner', 'due', 'plan', 'measured', 'closed', 'canceled')),
  note text check (char_length(note) <= 2000),
  value numeric,
  data jsonb not null default '{}'::jsonb
);
create index club_intervention_log_idx on public.club_intervention_log (intervention_id, at);

/* ---------- permissions ---------- */

-- open / assign / close / cancel
create or replace function public.can_manage_interventions(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (is_club_admin(p_club) or can_club(p_club, 'reports', 3));
$$;

-- professional staff of a team (coach, assistant, instructor, or a grant)
create or replace function public.is_team_pro_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p_team is not null and my_level(p_team, 'pro_notes') >= 2;
$$;

create or replace function public.can_see_intervention(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_interventions i
    where i.id = p_id and auth.uid() is not null
      and (can_view_club_dashboard(i.club_id) or i.owner_id = auth.uid() or is_team_pro_staff(i.team_id))
  );
$$;

-- notes, in progress / for checking, re-measure
create or replace function public.can_work_intervention(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_interventions i
    where i.id = p_id and auth.uid() is not null
      and (can_manage_interventions(i.club_id) or i.owner_id = auth.uid() or is_team_pro_staff(i.team_id))
  );
$$;

alter table public.club_interventions enable row level security;
alter table public.club_intervention_log enable row level security;
create policy club_interventions_read on public.club_interventions for select to authenticated
  using (can_see_intervention(id));
create policy club_intervention_log_read on public.club_intervention_log for select to authenticated
  using (can_see_intervention(intervention_id));
revoke all on public.club_interventions, public.club_intervention_log from public, anon, authenticated;
grant select on public.club_interventions, public.club_intervention_log to authenticated;

/* ---------- metrics (server side, real rows only) ---------- */

-- kind -> metric. The client never chooses the metric.
create or replace function public.intervention_metric_of(p_kind text)
returns text language sql immutable set search_path = public as $$
  select case p_kind
    when 'missing_marks' then 'marked_pct'
    when 'attendance_drop' then 'attendance_pct'
    when 'results_down' then 'form_ppg'
    when 'missing_reports' then 'report_pct'
    when 'no_plan' then 'plan_pct'
    when 'drill_transfer' then 'drills_adopted'
  end;
$$;

-- Trainings counted by the metrics: club (or one team), not canceled, not
-- personal, held in the last 14 days (with p_ahead: also the next 7 days).
create or replace function public.intervention_sessions(p_club uuid, p_team uuid, p_ahead boolean)
returns setof uuid language sql stable security definer set search_path = public as $$
  select ts.id from training_sessions ts join teams t on t.id = ts.team_id
  where t.club_id = p_club and t.archived_at is null and (p_team is null or ts.team_id = p_team)
    and not ts.canceled and ts.kind <> 'personal'
    and ts.starts_at >= now() - interval '14 days'
    and ts.starts_at <= case when p_ahead then now() + interval '7 days' else now() end;
$$;

-- The value of one metric now, for one team or the whole club (team null).
-- Window: held trainings of the last 14 days (plan_pct: last 14 days and the
-- next 7; drills_adopted: last 30 days). null = no data.
-- Internal: no permission check here, callers check. Not callable by clients.
create or replace function public.intervention_metric_value(p_club uuid, p_team uuid, p_metric text, p_context jsonb)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_n bigint;
  v_k bigint;
  v_tab jsonb;
  v_form text;
begin
  if p_metric in ('marked_pct', 'report_pct', 'attendance_pct', 'plan_pct') then
    if p_metric = 'attendance_pct' then
      select count(*), count(*) filter (where r.status in ('present', 'late')) into v_n, v_k
      from attendance_records r
      where r.session_id in (select intervention_sessions(p_club, p_team, false));
    else
      select count(*),
             count(*) filter (where case p_metric
               when 'marked_pct' then exists (select 1 from attendance_records r where r.session_id = s.id)
               when 'report_pct' then exists (select 1 from training_reports r where r.session_id = s.id)
               else exists (select 1 from session_plan_assignments a where a.session_id = s.id) end)
        into v_n, v_k from intervention_sessions(p_club, p_team, p_metric = 'plan_pct') s(id);
    end if;
    return case when v_n > 0 then round(100.0 * v_k / v_n) end;
  elsif p_metric = 'form_ppg' then
    if p_team is null then return null; end if;
    v_tab := team_league_table(p_team);
    select r ->> 'form' into v_form from jsonb_array_elements(coalesce(v_tab -> 'rows', '[]'::jsonb)) r
      where (r ->> 'is_us')::boolean limit 1;
    if coalesce(v_form, '') = '' then return null; end if;
    return round((3 * (length(v_form) - length(replace(v_form, 'W', '')))
                  + (length(v_form) - length(replace(v_form, 'D', ''))))::numeric / length(v_form), 2);
  elsif p_metric = 'drills_adopted' then
    if p_team is null or jsonb_typeof(p_context -> 'exercise_ids') <> 'array' then return null; end if;
    select count(distinct (x ->> 'id')) into v_k
    from training_sessions ts
    join session_plan_assignments a on a.session_id = ts.id
    cross join lateral (
      select b -> 'exercise' as x from jsonb_array_elements(coalesce(a.snapshot -> 'blocks', '[]'::jsonb)) b
      union all
      select st -> 'exercise' from jsonb_array_elements(coalesce(a.snapshot -> 'blocks', '[]'::jsonb)) b,
                                   jsonb_array_elements(coalesce(b -> 'stations', '[]'::jsonb)) st
    ) ex
    where ts.team_id = p_team and not ts.canceled and ts.kind <> 'personal' and ts.starts_at <= now()
      and ts.starts_at >= now() - interval '30 days'
      and jsonb_typeof(x) = 'object'
      and (x ->> 'id') in (select jsonb_array_elements_text(p_context -> 'exercise_ids'));
    return v_k;
  end if;
  return null;
end $$;

/* ---------- reads ---------- */

-- People who may own an intervention: club staff, and the professional staff
-- (coach, assistant, instructor) of the team, or of any club team for a
-- club-wide insight. Managers only.
create or replace function public.intervention_owner_options(p_club uuid, p_team uuid default null)
returns table (user_id uuid, name text, role text) language sql stable security definer set search_path = public as $$
  select x.user_id, coalesce(nullif(p.full_name, ''), 'ללא שם'), min(x.role)
  from (
    select s.user_id, case s.role when 'owner' then 'בעלים' when 'admin' then 'מנהל' else 'צוות מועדון' end as role
    from club_staff s where s.club_id = p_club
    union all
    select m.user_id, case m.role when 'coach' then 'מאמן' when 'assistant_coach' then 'עוזר מאמן' else 'מדריך' end
    from team_members m join teams t on t.id = m.team_id
    where (p_team is null or m.team_id = p_team) and t.club_id = p_club and t.archived_at is null
      and m.role in ('coach', 'assistant_coach', 'instructor')
  ) x
  left join profiles p on p.id = x.user_id
  where can_manage_interventions(p_club)
  group by x.user_id, p.full_name
  order by 2;
$$;

create or replace function public.intervention_json(i public.club_interventions)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(i) - 'context' || jsonb_build_object(
    'context', i.context,
    'team_name', (select name from teams where id = i.team_id),
    'club_name', (select name from clubs where id = i.club_id),
    'owner_name', (select coalesce(nullif(full_name, ''), 'ללא שם') from profiles where id = i.owner_id),
    'can_manage', can_manage_interventions(i.club_id),
    'can_work', can_work_intervention(i.id),
    'overdue', i.status in ('open', 'in_progress', 'checking') and i.due_on < (now() at time zone 'Asia/Jerusalem')::date
  );
$$;

-- Interventions I may see; one club, or all my clubs (p_club null).
create or replace function public.club_interventions_list(p_club uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(intervention_json(i) order by
           (i.status in ('open', 'in_progress', 'checking')) desc, i.due_on nulls last, i.created_at desc), '[]'::jsonb)
  from club_interventions i
  where auth.uid() is not null and (p_club is null or i.club_id = p_club) and can_see_intervention(i.id);
$$;

-- One intervention with its log. null = not found or not allowed.
create or replace function public.intervention_detail(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select intervention_json(i) || jsonb_build_object('log', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'at', l.at, 'action', l.action, 'note', l.note, 'value', l.value, 'data', l.data,
                    'actor_name', (select coalesce(nullif(full_name, ''), 'ללא שם') from profiles where id = l.actor))
                  order by l.at, l.id)
           from club_intervention_log l where l.intervention_id = i.id), '[]'::jsonb))
  from club_interventions i
  where i.id = p_id and can_see_intervention(i.id);
$$;

-- Today's trainings of the club (Israel date), as planned in the calendar.
-- There is no live status yet (phase C: pitches + staff check-in).
create or replace function public.club_today_sessions(p_club uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not can_view_club_dashboard(p_club) then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'session_id', ts.id, 'team_id', t.id, 'team_name', t.name, 'starts_at', ts.starts_at,
             'duration_min', ts.duration_min, 'location', ts.location,
             'has_plan', exists (select 1 from session_plan_assignments a where a.session_id = ts.id))
           order by ts.starts_at, t.name)
    from training_sessions ts join teams t on t.id = ts.team_id
    where t.club_id = p_club and t.archived_at is null and not ts.canceled and ts.kind <> 'personal'
      and (ts.starts_at at time zone 'Asia/Jerusalem')::date = (now() at time zone 'Asia/Jerusalem')::date), '[]'::jsonb) end;
$$;

/* ---------- writes ---------- */

-- Open an intervention for one insight. If one is already open for the same
-- insight, nothing is created and that one is returned (existing = true).
create or replace function public.open_intervention(
  p_club uuid, p_team uuid, p_kind text, p_title text, p_why text default '', p_plan text default '',
  p_owner uuid default null, p_due date default null, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_metric text := intervention_metric_of(p_kind);
  v_key text;
  v_id uuid;
  v_base numeric;
  v_due date := coalesce(p_due, (now() at time zone 'Asia/Jerusalem')::date + 14);
  v_ctx jsonb := '{}'::jsonb;
begin
  if not can_manage_interventions(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_metric is null then raise exception 'unknown insight kind'; end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team and club_id = p_club and archived_at is null) then
    raise exception 'team is not in this club';
  end if;
  if p_kind in ('attendance_drop', 'results_down', 'drill_transfer') and p_team is null then
    raise exception 'this insight needs a team';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 then raise exception 'title required'; end if;
  if v_due < (now() at time zone 'Asia/Jerusalem')::date or v_due > (now() at time zone 'Asia/Jerusalem')::date + 180 then
    raise exception 'due date must be within the next 180 days';
  end if;
  if p_owner is not null and not exists (select 1 from intervention_owner_options(p_club, p_team) o where o.user_id = p_owner) then
    raise exception 'owner must be club staff or the team''s professional staff';
  end if;
  -- keep only the context the server understands
  if p_kind = 'drill_transfer' then
    v_ctx := jsonb_build_object(
      'exercise_ids', coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(coalesce(p_context -> 'exercise_ids', '[]'::jsonb)) x
                                where x ~ '^[0-9a-f-]{36}$' and exists (select 1 from exercises e where e.id = x::uuid)), '[]'::jsonb),
      'from_team_id', case when (p_context ->> 'from_team_id') ~ '^[0-9a-f-]{36}$'
                            and exists (select 1 from teams where id = (p_context ->> 'from_team_id')::uuid and club_id = p_club)
                           then p_context -> 'from_team_id' end);
    if jsonb_array_length(v_ctx -> 'exercise_ids') = 0 then raise exception 'drill transfer needs exercises'; end if;
  end if;
  v_key := p_kind || ':' || coalesce(p_team::text, 'club');

  select id into v_id from club_interventions
    where club_id = p_club and insight_key = v_key and status in ('open', 'in_progress', 'checking');
  if found then return jsonb_build_object('id', v_id, 'existing', true); end if;

  v_base := intervention_metric_value(p_club, p_team, v_metric, v_ctx);
  begin
    insert into club_interventions (club_id, team_id, insight_key, kind, metric, context, title, why, action_plan,
                                    owner_id, due_on, baseline_value, baseline_at)
    values (p_club, p_team, v_key, p_kind, v_metric, v_ctx, left(trim(p_title), 160), left(coalesce(trim(p_why), ''), 1000),
            left(coalesce(trim(p_plan), ''), 1000), p_owner, v_due, v_base, now())
    returning id into v_id;
  exception when unique_violation then
    -- opened by someone else a moment ago
    select id into v_id from club_interventions
      where club_id = p_club and insight_key = v_key and status in ('open', 'in_progress', 'checking');
    return jsonb_build_object('id', v_id, 'existing', true);
  end;
  insert into club_intervention_log (intervention_id, action, value, data)
    values (v_id, 'opened', v_base, jsonb_build_object('owner_id', p_owner, 'due_on', v_due));
  return jsonb_build_object('id', v_id, 'existing', false);
end $$;

-- Re-measure the metric now (server side).
create or replace function public.measure_intervention(p_id uuid)
returns numeric language plpgsql volatile security definer set search_path = public as $$
declare
  v club_interventions%rowtype;
  v_val numeric;
begin
  if not can_work_intervention(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v from club_interventions where id = p_id for update;
  if v.status in ('closed', 'canceled') then raise exception 'intervention is not open'; end if;
  v_val := intervention_metric_value(v.club_id, v.team_id, v.metric, v.context);
  update club_interventions set current_value = v_val, current_at = now(), updated_at = now() where id = p_id;
  insert into club_intervention_log (intervention_id, action, value) values (p_id, 'measured', v_val);
  return v_val;
end $$;

-- Everyday actions. p_action:
--   'note'   (worker)   p_value = the note
--   'status' (worker)   p_value = 'in_progress' | 'checking'
--   'owner'  (manager)  p_value = user id
--   'due'    (manager)  p_value = yyyy-mm-dd
--   'plan'   (manager)  p_value = the action plan text
create or replace function public.intervention_act(p_id uuid, p_action text, p_value text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v club_interventions%rowtype;
  v_manage boolean;
  v_due date;
begin
  select * into v from club_interventions where id = p_id for update;
  if not found or not can_work_intervention(p_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v.status in ('closed', 'canceled') then raise exception 'intervention is not open'; end if;
  v_manage := can_manage_interventions(v.club_id);
  if p_action = 'note' then
    if char_length(trim(coalesce(p_value, ''))) = 0 then raise exception 'note required'; end if;
    insert into club_intervention_log (intervention_id, action, note) values (p_id, 'note', left(trim(p_value), 2000));
  elsif p_action = 'status' then
    if p_value not in ('open', 'in_progress', 'checking') then raise exception 'use close or cancel to end an intervention'; end if;
    if p_value = v.status then return; end if;
    update club_interventions set status = p_value, updated_at = now() where id = p_id;
    insert into club_intervention_log (intervention_id, action, data)
      values (p_id, 'status', jsonb_build_object('from', v.status, 'to', p_value));
  elsif p_action = 'owner' then
    if not v_manage then raise exception 'not allowed' using errcode = '42501'; end if;
    if p_value is not null and p_value <> ''
       and not exists (select 1 from intervention_owner_options(v.club_id, v.team_id) o where o.user_id::text = p_value) then
      raise exception 'owner must be club staff or the team''s professional staff';
    end if;
    update club_interventions set owner_id = nullif(p_value, '')::uuid, updated_at = now() where id = p_id;
    insert into club_intervention_log (intervention_id, action, data)
      values (p_id, 'owner', jsonb_build_object('owner_id', nullif(p_value, '')));
  elsif p_action = 'due' then
    if not v_manage then raise exception 'not allowed' using errcode = '42501'; end if;
    v_due := p_value::date;
    if v_due < (now() at time zone 'Asia/Jerusalem')::date or v_due > (now() at time zone 'Asia/Jerusalem')::date + 180 then
      raise exception 'due date must be within the next 180 days';
    end if;
    update club_interventions set due_on = v_due, updated_at = now() where id = p_id;
    insert into club_intervention_log (intervention_id, action, data) values (p_id, 'due', jsonb_build_object('due_on', v_due));
  elsif p_action = 'plan' then
    if not v_manage then raise exception 'not allowed' using errcode = '42501'; end if;
    update club_interventions set action_plan = left(coalesce(trim(p_value), ''), 1000), updated_at = now() where id = p_id;
    insert into club_intervention_log (intervention_id, action, note) values (p_id, 'plan', left(coalesce(trim(p_value), ''), 2000));
  else
    raise exception 'unknown action';
  end if;
end $$;

-- Close with a final measurement, an outcome and a written conclusion.
create or replace function public.close_intervention(p_id uuid, p_outcome text, p_conclusion text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v club_interventions%rowtype;
  v_val numeric;
begin
  select * into v from club_interventions where id = p_id for update;
  if not found or not can_manage_interventions(v.club_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v.status in ('closed', 'canceled') then raise exception 'intervention is not open'; end if;
  if p_outcome not in ('improved', 'no_change', 'worse', 'inconclusive') then raise exception 'unknown outcome'; end if;
  if char_length(trim(coalesce(p_conclusion, ''))) < 10 then raise exception 'a professional conclusion is required (10+ characters)'; end if;
  v_val := intervention_metric_value(v.club_id, v.team_id, v.metric, v.context);
  update club_interventions
    set status = 'closed', outcome = p_outcome, conclusion = left(trim(p_conclusion), 2000),
        current_value = v_val, current_at = now(), closed_at = now(), updated_at = now()
    where id = p_id;
  insert into club_intervention_log (intervention_id, action, value, note, data)
    values (p_id, 'closed', v_val, left(trim(p_conclusion), 2000), jsonb_build_object('outcome', p_outcome));
end $$;

-- Cancel (not needed any more, opened by mistake). A reason is required.
create or replace function public.cancel_intervention(p_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v club_interventions%rowtype;
begin
  select * into v from club_interventions where id = p_id for update;
  if not found or not can_manage_interventions(v.club_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v.status in ('closed', 'canceled') then raise exception 'intervention is not open'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  update club_interventions set status = 'canceled', closed_at = now(), updated_at = now() where id = p_id;
  insert into club_intervention_log (intervention_id, action, note) values (p_id, 'canceled', left(trim(p_reason), 2000));
end $$;

revoke all on function
  public.can_manage_interventions(uuid), public.is_team_pro_staff(uuid), public.can_see_intervention(uuid),
  public.can_work_intervention(uuid), public.intervention_metric_of(text),
  public.intervention_metric_value(uuid, uuid, text, jsonb), public.intervention_sessions(uuid, uuid, boolean),
  public.intervention_owner_options(uuid, uuid),
  public.intervention_json(public.club_interventions), public.club_interventions_list(uuid),
  public.intervention_detail(uuid), public.club_today_sessions(uuid),
  public.open_intervention(uuid, uuid, text, text, text, text, uuid, date, jsonb),
  public.measure_intervention(uuid), public.intervention_act(uuid, text, text),
  public.close_intervention(uuid, text, text), public.cancel_intervention(uuid, text)
  from public, anon;
-- internal helpers stay closed to clients
revoke all on function public.intervention_metric_value(uuid, uuid, text, jsonb),
  public.intervention_sessions(uuid, uuid, boolean), public.intervention_json(public.club_interventions) from authenticated;
grant execute on function
  public.can_manage_interventions(uuid), public.is_team_pro_staff(uuid), public.can_see_intervention(uuid),
  public.can_work_intervention(uuid), public.intervention_metric_of(text), public.intervention_owner_options(uuid, uuid),
  public.club_interventions_list(uuid), public.intervention_detail(uuid), public.club_today_sessions(uuid),
  public.open_intervention(uuid, uuid, text, text, text, text, uuid, date, jsonb),
  public.measure_intervention(uuid), public.intervention_act(uuid, text, text),
  public.close_intervention(uuid, text, text), public.cancel_intervention(uuid, text)
  to authenticated;

commit;
