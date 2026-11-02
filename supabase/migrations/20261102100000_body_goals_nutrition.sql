-- iplays — body metrics, personal goals and nutrition: the child's private area.
--
-- Run after 20261101985000_player_career.sql (and the other 2026-11-01 files).
-- Rollback: supabase/rollback/20261102100000_body_goals_nutrition.down.sql
-- Additive only: new columns, new tables, new functions, replaced policies
-- and functions. No row is changed or deleted.
--
-- The user's spec (section 23) makes this area strictly private:
--   only the child's parents (player_guardians.relation = 'parent') see and
--   edit body measurements, BMI, personal goals and nutrition. Not the coach,
--   not the team admin, not the club admin or treasurer, not a platform
--   admin, and not family members / followers.
-- So, from this migration on:
--   * player_measurements (created in 20261101985000, until now readable by
--     staff with metrics >= 1) is parent-only. New columns: waist_cm,
--     chest_cm and custom (extra measures a parent names). Existing rows stay.
--   * New tables child_goals, child_goal_progress, child_nutrition. They are
--     keyed by the child only (no team / club column), so no club report,
--     export or search reads them.
--   * Every read goes through RLS (parent-only select policies) and every
--     write through security-definer RPCs that check is_player_parent().
--     There are no insert / update / delete policies, and anon has no grant.
--   * player_career() no longer returns measurements (always null) and
--     can_edit_measurements is always false; the career page reads the
--     private area with child_private_profile(), which returns null for
--     anyone but a parent.
--   * BMI is computed in the app from weight and height (no stored value).
--     No adult categories, no rating: children's BMI depends on age and sex.

begin;

-- ------------------------------------------------------------ who may see

create or replace function public.can_see_child_private(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and is_player_parent(p_player);
$$;

-- ----------------------------------------------------------- measurements

alter table public.player_measurements
  add column if not exists waist_cm numeric(4, 1) check (waist_cm between 30 and 200),
  add column if not exists chest_cm numeric(4, 1) check (chest_cm between 30 and 200),
  -- extra measures named by the parent: [{"label": "...", "unit": "...", "value": 12.5}]
  add column if not exists custom jsonb not null default '[]'::jsonb;

-- The "at least one value" check now also counts the new columns.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.player_measurements'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%num_nonnulls%'
  loop
    execute format('alter table public.player_measurements drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.player_measurements
  add constraint player_measurements_some_value check (
    num_nonnulls(height_cm, weight_kg, thigh_cm, calf_cm, arm_cm, waist_cm, chest_cm) > 0
    or jsonb_array_length(custom) > 0);
alter table public.player_measurements drop constraint if exists player_measurements_custom_shape;
alter table public.player_measurements
  add constraint player_measurements_custom_shape check (
    jsonb_typeof(custom) = 'array' and jsonb_array_length(custom) <= 8);

drop policy if exists player_measurements_read on public.player_measurements;
create policy player_measurements_read on public.player_measurements for select to authenticated
  using (deleted_at is null and can_see_child_private(player_id));
revoke all on public.player_measurements from anon;
revoke insert, update, delete, truncate on public.player_measurements from authenticated;
grant select on public.player_measurements to authenticated;

-- Clean the parent's free-form extra measures: label 1-30 chars, unit <= 10,
-- a number 0-10000. Bad entries are refused, not silently dropped.
create or replace function public.clean_custom_measures(p jsonb)
returns jsonb language plpgsql immutable as $$
declare
  e jsonb;
  v_label text;
  v_unit text;
  v_value numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if p is null or p = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'custom measures must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p) > 8 then raise exception 'too many custom measures' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p) loop
    v_label := btrim(coalesce(e ->> 'label', ''));
    v_unit := btrim(coalesce(e ->> 'unit', ''));
    begin
      v_value := (e ->> 'value')::numeric;
    exception when others then
      raise exception 'custom measure value is not a number' using errcode = '22023';
    end;
    if v_label = '' or char_length(v_label) > 30 or char_length(v_unit) > 10
       or v_value is null or v_value < 0 or v_value > 10000 then
      raise exception 'bad custom measure' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('label', v_label, 'unit', v_unit, 'value', round(v_value, 2));
  end loop;
  return v_out;
end;
$$;

-- Add one measurement (a dated, historical row; earlier rows are never overwritten).
-- p_values: {"height_cm":..,"weight_kg":..,"waist_cm":..,"thigh_cm":..,"chest_cm":..,"arm_cm":..,"calf_cm":..}
create or replace function public.add_body_measurement(
  p_player uuid, p_on date, p_values jsonb, p_custom jsonb default '[]'::jsonb, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v jsonb := coalesce(p_values, '{}'::jsonb);
begin
  if not can_see_child_private(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_on is null or p_on > current_date then
    raise exception 'date in the future' using errcode = '22023';
  end if;
  insert into player_measurements (player_id, measured_on, height_cm, weight_kg, waist_cm, thigh_cm, chest_cm, arm_cm, calf_cm, custom, note)
  values (p_player, p_on,
          nullif(v ->> 'height_cm', '')::numeric, nullif(v ->> 'weight_kg', '')::numeric,
          nullif(v ->> 'waist_cm', '')::numeric, nullif(v ->> 'thigh_cm', '')::numeric,
          nullif(v ->> 'chest_cm', '')::numeric, nullif(v ->> 'arm_cm', '')::numeric,
          nullif(v ->> 'calf_cm', '')::numeric,
          clean_custom_measures(p_custom), left(coalesce(p_note, ''), 200))
  returning id into v_id;
  return v_id;
end;
$$;

-- The older RPC (used by the previous career page) is now parent-only too.
create or replace function public.add_player_measurement(
  p_player uuid, p_on date, p_height numeric, p_weight numeric,
  p_thigh numeric, p_calf numeric, p_arm numeric, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return add_body_measurement(p_player, p_on,
    jsonb_build_object('height_cm', p_height, 'weight_kg', p_weight, 'thigh_cm', p_thigh, 'calf_cm', p_calf, 'arm_cm', p_arm),
    '[]'::jsonb, p_note);
end;
$$;

-- Soft-remove a mistaken measurement / clearance. Measurements: parents only.
create or replace function public.remove_player_record(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  if p_kind = 'measurement' then
    select player_id into v_player from player_measurements where id = p_id and deleted_at is null;
    if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
    if not can_see_child_private(v_player) then raise exception 'not allowed' using errcode = '42501'; end if;
    update player_measurements set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_kind = 'medical' then
    select player_id into v_player from player_medical_clearances where id = p_id and deleted_at is null;
    if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
    if not can_edit_player_domain(v_player, 'medical', 3) then raise exception 'not allowed' using errcode = '42501'; end if;
    update player_medical_clearances set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  else
    raise exception 'unknown kind' using errcode = '22023';
  end if;
end;
$$;

-- ------------------------------------------------------------------ goals

create table if not exists public.child_goals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 60),
  category text not null default 'other'
    check (category in ('speed', 'endurance', 'ball_control', 'weak_foot', 'shooting', 'fitness', 'other')),
  description text not null default '' check (char_length(description) <= 500),
  start_on date not null default current_date,
  target_on date,
  -- how progress is measured: 'percent' (0-100, the parent's estimate) or
  -- 'number' (a value moving from baseline to target, e.g. 30 m sprint 6.1 -> 5.6 s)
  metric_kind text not null default 'percent' check (metric_kind in ('percent', 'number')),
  metric_label text not null default '' check (char_length(metric_label) <= 40),
  unit text not null default '' check (char_length(unit) <= 10),
  baseline numeric(9, 2),
  target_value numeric(9, 2),
  status text not null default 'active' check (status in ('active', 'achieved', 'paused', 'dropped')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  check (target_on is null or target_on >= start_on),
  check (metric_kind = 'percent' or (baseline is not null and target_value is not null and baseline <> target_value))
);
create index if not exists child_goals_player_idx on public.child_goals (player_id, created_at);

create table if not exists public.child_goal_progress (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.child_goals (id) on delete restrict,
  recorded_on date not null default current_date,
  value numeric(9, 2) not null check (value between -100000 and 100000),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);
create index if not exists child_goal_progress_goal_idx on public.child_goal_progress (goal_id, recorded_on);

alter table public.child_goals enable row level security;
drop policy if exists child_goals_read on public.child_goals;
create policy child_goals_read on public.child_goals for select to authenticated
  using (deleted_at is null and can_see_child_private(player_id));

alter table public.child_goal_progress enable row level security;
drop policy if exists child_goal_progress_read on public.child_goal_progress;
create policy child_goal_progress_read on public.child_goal_progress for select to authenticated
  using (deleted_at is null and exists (select 1 from child_goals g where g.id = goal_id
                                        and g.deleted_at is null and can_see_child_private(g.player_id)));

revoke all on public.child_goals, public.child_goal_progress from anon;
revoke insert, update, delete, truncate on public.child_goals, public.child_goal_progress from authenticated;
grant select on public.child_goals, public.child_goal_progress to authenticated;

-- Create (p_id null) or edit a goal.
create or replace function public.save_child_goal(
  p_player uuid, p_id uuid, p_title text, p_category text, p_description text,
  p_start date, p_target_on date, p_metric_kind text, p_metric_label text, p_unit text,
  p_baseline numeric, p_target_value numeric, p_status text default 'active'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_kind text := coalesce(p_metric_kind, 'percent');
begin
  if not can_see_child_private(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_id is null then
    insert into child_goals (player_id, title, category, description, start_on, target_on, metric_kind,
                             metric_label, unit, baseline, target_value, status)
    values (p_player, btrim(coalesce(p_title, '')), coalesce(p_category, 'other'), btrim(coalesce(p_description, '')),
            coalesce(p_start, current_date), p_target_on, v_kind,
            case when v_kind = 'number' then btrim(coalesce(p_metric_label, '')) else '' end,
            case when v_kind = 'number' then btrim(coalesce(p_unit, '')) else '' end,
            case when v_kind = 'number' then p_baseline end,
            case when v_kind = 'number' then p_target_value end,
            coalesce(p_status, 'active'))
    returning id into v_id;
  else
    update child_goals set
      title = btrim(coalesce(p_title, '')), category = coalesce(p_category, 'other'),
      description = btrim(coalesce(p_description, '')), start_on = coalesce(p_start, start_on),
      target_on = p_target_on, metric_kind = v_kind,
      metric_label = case when v_kind = 'number' then btrim(coalesce(p_metric_label, '')) else '' end,
      unit = case when v_kind = 'number' then btrim(coalesce(p_unit, '')) else '' end,
      baseline = case when v_kind = 'number' then p_baseline end,
      target_value = case when v_kind = 'number' then p_target_value end,
      status = coalesce(p_status, status), updated_at = now()
    where id = p_id and player_id = p_player and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- Change only the status (achieved / paused / dropped / active).
create or replace function public.set_child_goal_status(p_goal uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  select player_id into v_player from child_goals where id = p_goal and deleted_at is null;
  if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_see_child_private(v_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  update child_goals set status = p_status, updated_at = now() where id = p_goal;
end;
$$;

-- Record progress on a goal (history; earlier entries are kept).
create or replace function public.add_child_goal_progress(p_goal uuid, p_on date, p_value numeric, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g child_goals;
  v_id uuid;
begin
  select * into g from child_goals where id = p_goal and deleted_at is null;
  if g.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_see_child_private(g.player_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_on is null or p_on > current_date then raise exception 'date in the future' using errcode = '22023'; end if;
  if p_value is null then raise exception 'value required' using errcode = '22023'; end if;
  if g.metric_kind = 'percent' and (p_value < 0 or p_value > 100) then
    raise exception 'percent out of range' using errcode = '22023';
  end if;
  insert into child_goal_progress (goal_id, recorded_on, value, note)
  values (p_goal, p_on, p_value, left(btrim(coalesce(p_note, '')), 200))
  returning id into v_id;
  update child_goals set updated_at = now() where id = p_goal;
  return v_id;
end;
$$;

-- Soft-remove a goal or one progress entry.
create or replace function public.remove_child_goal_record(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  if p_kind = 'goal' then
    select player_id into v_player from child_goals where id = p_id and deleted_at is null;
  elsif p_kind = 'progress' then
    select g.player_id into v_player from child_goal_progress p join child_goals g on g.id = p.goal_id
    where p.id = p_id and p.deleted_at is null and g.deleted_at is null;
  else
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_see_child_private(v_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind = 'goal' then
    update child_goals set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  else
    update child_goal_progress set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  end if;
end;
$$;

-- -------------------------------------------------------------- nutrition

-- One row per child. Allergies / restrictions are picked from fixed lists
-- (plus a free "other" text). No diet, calorie or weight-loss data is kept.
create table if not exists public.child_nutrition (
  player_id uuid primary key references public.players (id) on delete restrict,
  preferences text not null default '' check (char_length(preferences) <= 500),
  allergies text[] not null default '{}'
    check (allergies <@ array['milk', 'eggs', 'peanuts', 'tree_nuts', 'sesame', 'gluten', 'soy', 'fish']::text[]),
  allergy_other text not null default '' check (char_length(allergy_other) <= 200),
  restrictions text[] not null default '{}'
    check (restrictions <@ array['kosher', 'vegetarian', 'vegan', 'gluten_free', 'lactose_free']::text[]),
  restriction_other text not null default '' check (char_length(restriction_other) <= 200),
  training_times text not null default '' check (char_length(training_times) <= 200),
  sport_needs text not null default '' check (char_length(sport_needs) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.child_nutrition enable row level security;
drop policy if exists child_nutrition_read on public.child_nutrition;
create policy child_nutrition_read on public.child_nutrition for select to authenticated
  using (can_see_child_private(player_id));
revoke all on public.child_nutrition from anon;
revoke insert, update, delete, truncate on public.child_nutrition from authenticated;
grant select on public.child_nutrition to authenticated;

create or replace function public.save_child_nutrition(
  p_player uuid, p_preferences text, p_allergies text[], p_allergy_other text,
  p_restrictions text[], p_restriction_other text, p_training_times text, p_sport_needs text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_see_child_private(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into child_nutrition as n (player_id, preferences, allergies, allergy_other, restrictions,
                                    restriction_other, training_times, sport_needs, updated_by, updated_at)
  values (p_player, btrim(coalesce(p_preferences, '')),
          coalesce((select array_agg(distinct x order by x) from unnest(p_allergies) x), '{}'),
          btrim(coalesce(p_allergy_other, '')),
          coalesce((select array_agg(distinct x order by x) from unnest(p_restrictions) x), '{}'),
          btrim(coalesce(p_restriction_other, '')), btrim(coalesce(p_training_times, '')),
          btrim(coalesce(p_sport_needs, '')), auth.uid(), now())
  on conflict (player_id) do update set
    preferences = excluded.preferences, allergies = excluded.allergies, allergy_other = excluded.allergy_other,
    restrictions = excluded.restrictions, restriction_other = excluded.restriction_other,
    training_times = excluded.training_times, sport_needs = excluded.sport_needs,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- ------------------------------------------------------ the private area

-- Everything in the child's private area, in one call. null for anyone but
-- a parent of the child (the career page then hides the area).
create or replace function public.child_private_profile(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_see_child_private(p_player) then
    return null;
  end if;
  return jsonb_build_object(
    'measurements', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'date', x.measured_on,
               'height_cm', x.height_cm, 'weight_kg', x.weight_kg, 'waist_cm', x.waist_cm,
               'thigh_cm', x.thigh_cm, 'chest_cm', x.chest_cm, 'arm_cm', x.arm_cm, 'calf_cm', x.calf_cm,
               'custom', x.custom, 'note', x.note)
             order by x.measured_on, x.created_at)
      from player_measurements x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'category', g.category,
               'description', g.description, 'start_on', g.start_on, 'target_on', g.target_on,
               'metric_kind', g.metric_kind, 'metric_label', g.metric_label, 'unit', g.unit,
               'baseline', g.baseline, 'target_value', g.target_value, 'status', g.status,
               'progress', coalesce((
                 select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.recorded_on, 'value', p.value, 'note', p.note)
                        order by p.recorded_on, p.created_at)
                 from child_goal_progress p where p.goal_id = g.id and p.deleted_at is null), '[]'::jsonb))
             order by (g.status = 'active') desc, g.created_at desc)
      from child_goals g where g.player_id = p_player and g.deleted_at is null), '[]'::jsonb),
    'nutrition', (select jsonb_build_object('preferences', n.preferences, 'allergies', to_jsonb(n.allergies),
                    'allergy_other', n.allergy_other, 'restrictions', to_jsonb(n.restrictions),
                    'restriction_other', n.restriction_other, 'training_times', n.training_times,
                    'sport_needs', n.sport_needs, 'updated_at', n.updated_at)
                  from child_nutrition n where n.player_id = p_player)
  );
end;
$$;

-- -------------------------------------------------------------- the career

-- Same as 20261101985000 except: 'measurements' is always null and
-- 'can_edit_measurements' always false (the private area has its own RPC).
create or replace function public.player_career(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_metrics boolean;
  v_medical boolean;
  v_out jsonb;
begin
  if auth.uid() is null or not can_view_player(p_player) then
    return '{}'::jsonb;
  end if;
  v_metrics := can_view_player_metrics(p_player);
  v_medical := can_view_player_medical(p_player);

  with
  -- every past, not-canceled match the player is linked to in any way
  m as (
    select tm.id, tm.team_id, tm.starts_at, (tm.starts_at at time zone 'Asia/Jerusalem')::date as d,
           tm.opponent, tm.home, t.sport, t.name as team_name
    from team_matches tm join teams t on t.id = tm.team_id
    where tm.status <> 'canceled' and tm.starts_at < now()
      and (exists (select 1 from attendance_records r where r.match_id = tm.id and r.player_id = p_player)
           or exists (select 1 from match_lineup_players lp join match_lineups l on l.id = lp.lineup_id
                      where lp.match_id = tm.id and lp.player_id = p_player and l.published_at is not null)
           or exists (select 1 from match_events e where e.match_id = tm.id and e.player_id = p_player
                      and e.kind = 'goal' and e.deleted_at is null))
  ),
  pm as (
    select m.*,
           (select r.status from attendance_records r where r.match_id = m.id and r.player_id = p_player) as mark,
           exists (select 1 from match_lineup_players lp join match_lineups l on l.id = lp.lineup_id
                   where lp.match_id = m.id and lp.player_id = p_player and l.published_at is not null) as in_lineup,
           exists (select 1 from match_lineup_players lp join match_lineups l on l.id = lp.lineup_id
                   where lp.match_id = m.id and lp.player_id = p_player and l.published_at is not null
                     and lp.slot is not null) as started,
           coalesce((select count(*) from match_events e
                     where e.match_id = m.id and e.player_id = p_player and e.kind = 'goal' and e.deleted_at is null
                       and e.side = case when m.home then 'home' else 'away' end), 0)::int as goals,
           coalesce((select sum(e.points) from match_events e
                     where e.match_id = m.id and e.player_id = p_player and e.kind = 'goal' and e.deleted_at is null
                       and e.side = case when m.home then 'home' else 'away' end), 0)::int as points
    from m
  ),
  app as (
    select pm.*,
           (coalesce(pm.mark, '') not in ('absent', 'excused')
            and (pm.mark in ('present', 'late') or pm.in_lineup or pm.goals > 0)) as appeared
    from pm
  ),
  -- trainings of the player's teams while assigned (same rule as the team summary)
  tr as (
    select s.id, (s.starts_at at time zone 'Asia/Jerusalem')::date as d,
           coalesce(r.status,
             (select case x.kind when 'absent' then 'absent' else 'late' end from player_absences x
              where x.player_id = p_player
                and (x.session_id = s.id or (x.session_id is null and (s.starts_at at time zone 'Asia/Jerusalem')::date between x.from_date and x.to_date))
              order by (x.session_id is not null) desc, x.created_at desc limit 1),
             'present') as st
    from player_assignments a
    join training_sessions s on s.team_id = a.team_id and not s.canceled and s.starts_at < now()
      and (s.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
      and (a.ended_on is null or (s.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on)
    left join attendance_records r on r.session_id = s.id and r.player_id = p_player
    where a.player_id = p_player
  ),
  months as (
    select to_char(date_trunc('month', current_date) - (n || ' month')::interval, 'YYYY-MM') as ym
    from generate_series(0, 11) n
  )
  select jsonb_build_object(
    'player', (select jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
                        'birth_year', p.birth_year, 'shirt_number', a.shirt_number, 'position', p.position, 'strong_foot', p.strong_foot,
                        'team_id', t.id, 'team_name', t.name, 'club', coalesce(c.name, t.club), 'sport', t.sport)
               from players p
               left join lateral (select * from player_assignments x where x.player_id = p.id and x.ended_on is null
                                  order by x.is_primary desc, x.started_on desc limit 1) a on true
               left join teams t on t.id = a.team_id
               left join clubs c on c.id = t.club_id
               where p.id = p_player),
    'sport', (select t.sport from player_assignments a join teams t on t.id = a.team_id
              where a.player_id = p_player and a.ended_on is null order by a.is_primary desc limit 1),
    'totals', jsonb_build_object(
      'appearances', (select count(*) from app where appeared),
      'starts', (select count(*) from app where appeared and started),
      'goals', (select coalesce(sum(goals), 0) from app),
      'points', (select coalesce(sum(points), 0) from app),
      'trainings', (select count(*) from tr),
      'trainings_attended', (select count(*) from tr where st in ('present', 'late'))
    ),
    'seasons', coalesce((
      select jsonb_agg(x order by x.season desc, x.team_name) from (
        select season_label(d) as season, team_id, team_name,
               count(*) filter (where appeared) as appearances,
               count(*) filter (where appeared and started) as starts,
               sum(goals) as goals, sum(points) as points
        from app group by 1, 2, 3
      ) x), '[]'::jsonb),
    'monthly', (
      select jsonb_agg(jsonb_build_object(
        'month', months.ym,
        'appearances', (select count(*) from app where appeared and to_char(app.d, 'YYYY-MM') = months.ym),
        'goals', (select coalesce(sum(goals), 0) from app where to_char(app.d, 'YYYY-MM') = months.ym),
        'points', (select coalesce(sum(points), 0) from app where to_char(app.d, 'YYYY-MM') = months.ym),
        'trainings', (select count(*) from tr where to_char(tr.d, 'YYYY-MM') = months.ym),
        'trainings_attended', (select count(*) from tr where st in ('present', 'late') and to_char(tr.d, 'YYYY-MM') = months.ym)
      ) order by months.ym)
      from months
    ),
    'goal_matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'opponent', opponent, 'goals', goals, 'points', points, 'team', team_name)
                       order by d)
      from app where goals > 0), '[]'::jsonb),
    'assessments', case when v_metrics then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.assessed_on, 'team_id', a.team_id,
               'speed', a.speed, 'stamina', a.stamina, 'technique', a.technique, 'vision', a.vision, 'note', a.note)
             order by a.assessed_on, a.created_at)
      from player_assessments a where a.player_id = p_player and a.deleted_at is null), '[]'::jsonb) end,
    'fitness', case when v_metrics then coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'test', f.test, 'label', ft.label, 'unit', ft.unit,
               'lower_is_better', ft.lower_is_better, 'value', f.value, 'date', f.tested_on, 'team_id', f.team_id)
             order by ft.sort, f.tested_on, f.created_at)
      from player_fitness_tests f join fitness_test_types ft on ft.code = f.test
      where f.player_id = p_player and f.deleted_at is null), '[]'::jsonb) end,
    -- the team through which the caller may add assessments / tests (null = read only)
    'edit_team_id', (select a.team_id from player_assignments a
                     where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'metrics', 3)
                     order by a.is_primary desc limit 1),
    'measurements', null,
    'medical', case when v_medical then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'issued_on', x.issued_on, 'valid_until', x.valid_until,
               'issuer', x.issuer, 'note', x.note)
             order by x.valid_until desc, x.created_at desc)
      from player_medical_clearances x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb) end,
    'can_edit_profile', (is_player_parent(p_player) or exists (select 1 from player_assignments a
                         where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'roster', 3))),
    'can_edit_measurements', false,
    'can_edit_medical', can_edit_player_domain(p_player, 'medical', 3)
  ) into v_out;
  return v_out;
end;
$$;

-- ------------------------------------------------------------------ grants

revoke all on function public.can_see_child_private(uuid) from public, anon;
grant execute on function public.can_see_child_private(uuid) to authenticated;
revoke all on function public.clean_custom_measures(jsonb) from public, anon;
revoke all on function public.add_body_measurement(uuid, date, jsonb, jsonb, text) from public, anon;
grant execute on function public.add_body_measurement(uuid, date, jsonb, jsonb, text) to authenticated;
revoke all on function public.add_player_measurement(uuid, date, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.add_player_measurement(uuid, date, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
revoke all on function public.remove_player_record(text, uuid) from public, anon;
grant execute on function public.remove_player_record(text, uuid) to authenticated;
revoke all on function public.save_child_goal(uuid, uuid, text, text, text, date, date, text, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.save_child_goal(uuid, uuid, text, text, text, date, date, text, text, text, numeric, numeric, text) to authenticated;
revoke all on function public.set_child_goal_status(uuid, text) from public, anon;
grant execute on function public.set_child_goal_status(uuid, text) to authenticated;
revoke all on function public.add_child_goal_progress(uuid, date, numeric, text) from public, anon;
grant execute on function public.add_child_goal_progress(uuid, date, numeric, text) to authenticated;
revoke all on function public.remove_child_goal_record(text, uuid) from public, anon;
grant execute on function public.remove_child_goal_record(text, uuid) to authenticated;
revoke all on function public.save_child_nutrition(uuid, text, text[], text, text[], text, text, text) from public, anon;
grant execute on function public.save_child_nutrition(uuid, text, text[], text, text[], text, text, text) to authenticated;
revoke all on function public.child_private_profile(uuid) from public, anon;
grant execute on function public.child_private_profile(uuid) to authenticated;
revoke all on function public.player_career(uuid) from public, anon;
grant execute on function public.player_career(uuid) to authenticated;

commit;
