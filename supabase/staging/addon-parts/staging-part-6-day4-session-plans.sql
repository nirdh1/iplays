-- iPlays STAGING, add-on part 6 (day4-session-plans). NEVER run on Production.
-- Run in the SQL Editor of the Staging project, after part 5.
do $$
begin
  if to_regclass('staging.bundle_progress') is null then
    raise exception 'ABORT: this database is not a Staging project in progress (run parts 1-5 first).';
  end if;
  if not exists (select 1 from staging.bundle_progress where part = 5) then
    raise exception 'ABORT: run part 5 first.';
  end if;
  if exists (select 1 from staging.bundle_progress where part = 6) then
    raise exception 'ABORT: part 6 already ran here.';
  end if;
end $$;

-- ==== 20261106300000_session_plans.sql ====
-- iPlays 2.0 MVP, day 4: training session plans, parallel stations, and
-- assigning a plan to a training in the calendar.
--
--   session_plans            a team's plan: title, goal (topic), notes, draft/ready
--   session_plan_blocks      ordered parts: one exercise, a stations block, or a break
--   session_plan_stations    the stations of a stations block, each with an
--                            exercise (or a free title) and who runs it
--   session_plan_assignments one plan per training, with a frozen snapshot, so
--                            later edits to the plan don't rewrite a past training
--
-- Stations block duration = rounds × station_min + (rounds − 1) × transition_min
-- (groups rotate at the same time, so stations are not added up twice).
--
-- Who:
--   read the full plan    my_level(team, 'training') >= 1 (coach, assistant, club
--                         staff with a grant). Not parents, not the platform admin.
--   write / assign        can(team, 'training', 3)
--   parents and players   only the title and goal of the plan assigned to a
--                         training, through session_plan_summary().
--
-- Additive only: new tables and functions; training_sessions is not changed.
-- Rollback: supabase/rollback/20261106300000_session_plans.down.sql

create table if not exists public.session_plans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  goal text not null default '' check (char_length(goal) <= 200),
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'ready')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists session_plans_team_idx on public.session_plans (team_id, updated_at desc);

create table if not exists public.session_plan_blocks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.session_plans (id) on delete cascade,
  ord smallint not null check (ord between 0 and 29),
  kind text not null check (kind in ('exercise', 'stations', 'break')),
  title text not null default '' check (char_length(title) <= 80),
  exercise_id uuid references public.exercises (id) on delete set null,
  duration_min smallint check (duration_min between 1 and 120),
  goal text not null default '' check (char_length(goal) <= 200),
  groups smallint check (groups between 2 and 8),
  rounds smallint check (rounds between 1 and 8),
  station_min smallint check (station_min between 1 and 60),
  transition_min smallint check (transition_min between 0 and 10),
  unique (plan_id, ord),
  check (kind = 'stations' and groups is not null and rounds is not null and station_min is not null and transition_min is not null
         or kind <> 'stations' and duration_min is not null)
);

create table if not exists public.session_plan_stations (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.session_plan_blocks (id) on delete cascade,
  ord smallint not null check (ord between 0 and 7),
  exercise_id uuid references public.exercises (id) on delete set null,
  title text not null default '' check (char_length(title) <= 80),
  responsible text not null default '' check (char_length(responsible) <= 40),
  unique (block_id, ord)
);

create table if not exists public.session_plan_assignments (
  session_id uuid primary key references public.training_sessions (id) on delete cascade,
  plan_id uuid references public.session_plans (id) on delete set null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 524288),
  assigned_by uuid references auth.users (id) on delete set null default auth.uid(),
  assigned_at timestamptz not null default now()
);
create index if not exists session_plan_assignments_plan_idx on public.session_plan_assignments (plan_id);

alter table public.session_plans enable row level security;
alter table public.session_plan_blocks enable row level security;
alter table public.session_plan_stations enable row level security;
alter table public.session_plan_assignments enable row level security;

create or replace function public.can_read_plans(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and my_level(p_team, 'training') >= 1;
$$;

drop policy if exists session_plans_select on public.session_plans;
create policy session_plans_select on public.session_plans for select to authenticated using (can_read_plans(team_id));
drop policy if exists session_plan_blocks_select on public.session_plan_blocks;
create policy session_plan_blocks_select on public.session_plan_blocks for select to authenticated
  using (exists (select 1 from session_plans p where p.id = plan_id and can_read_plans(p.team_id)));
drop policy if exists session_plan_stations_select on public.session_plan_stations;
create policy session_plan_stations_select on public.session_plan_stations for select to authenticated
  using (exists (select 1 from session_plan_blocks b join session_plans p on p.id = b.plan_id
                 where b.id = block_id and can_read_plans(p.team_id)));
drop policy if exists session_plan_assignments_select on public.session_plan_assignments;
create policy session_plan_assignments_select on public.session_plan_assignments for select to authenticated
  using (exists (select 1 from training_sessions s where s.id = session_id and can_read_plans(s.team_id)));

grant select on public.session_plans, public.session_plan_blocks, public.session_plan_stations, public.session_plan_assignments to authenticated;
revoke insert, update, delete on public.session_plans, public.session_plan_blocks, public.session_plan_stations, public.session_plan_assignments from anon, authenticated;

-- minutes of one block (the rule in the header)
create or replace function public.plan_block_minutes(p_kind text, p_duration int, p_rounds int, p_station int, p_transition int)
returns int language sql immutable as $$
  select case when p_kind = 'stations'
              then coalesce(p_rounds, 0) * coalesce(p_station, 0) + greatest(coalesce(p_rounds, 0) - 1, 0) * coalesce(p_transition, 0)
              else coalesce(p_duration, 0) end;
$$;

-- the whole plan as JSON, with exercise details: what the editor loads and
-- what an assignment freezes. Caller must be allowed to read plans of the team.
create or replace function public.session_plan_json(p_plan uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v session_plans; v_blocks jsonb;
begin
  select * into v from session_plans where id = p_plan;
  if not found or not can_read_plans(v.team_id) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'ord', b.ord, 'kind', b.kind, 'title', b.title, 'goal', b.goal,
           'duration_min', b.duration_min, 'groups', b.groups, 'rounds', b.rounds,
           'station_min', b.station_min, 'transition_min', b.transition_min,
           'minutes', plan_block_minutes(b.kind, b.duration_min, b.rounds, b.station_min, b.transition_min),
           'exercise', (select jsonb_build_object('id', e.id, 'title', e.title, 'category', e.category, 'pitch_preset', e.pitch_preset,
                               'area_w_m', e.area_w_m, 'area_l_m', e.area_l_m, 'diagram', e.diagram, 'coaching_points', e.coaching_points,
                               'equipment', e.equipment)
                        from exercises e where e.id = b.exercise_id),
           'stations', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'ord', s.ord, 'title', s.title, 'responsible', s.responsible,
                          'exercise', (select jsonb_build_object('id', e.id, 'title', e.title, 'category', e.category, 'pitch_preset', e.pitch_preset,
                                              'area_w_m', e.area_w_m, 'area_l_m', e.area_l_m, 'diagram', e.diagram, 'coaching_points', e.coaching_points,
                                              'equipment', e.equipment)
                                       from exercises e where e.id = s.exercise_id)) order by s.ord)
                        from session_plan_stations s where s.block_id = b.id), '[]'::jsonb)
         ) order by b.ord), '[]'::jsonb)
    into v_blocks
    from session_plan_blocks b where b.plan_id = v.id;
  return jsonb_build_object('id', v.id, 'team_id', v.team_id, 'title', v.title, 'goal', v.goal, 'notes', v.notes,
                            'status', v.status, 'updated_at', v.updated_at, 'blocks', v_blocks,
                            'total_min', (select coalesce(sum(plan_block_minutes(b.kind, b.duration_min, b.rounds, b.station_min, b.transition_min)), 0)
                                          from session_plan_blocks b where b.plan_id = v.id));
end $$;

-- list of a team's plans, with total minutes and how many trainings use each
create or replace function public.team_session_plans(p_team uuid)
returns table (id uuid, title text, goal text, status text, total_min int, blocks int, assigned int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.goal, p.status,
         coalesce((select sum(plan_block_minutes(b.kind, b.duration_min, b.rounds, b.station_min, b.transition_min))
                   from session_plan_blocks b where b.plan_id = p.id), 0)::int,
         (select count(*) from session_plan_blocks b where b.plan_id = p.id)::int,
         (select count(*) from session_plan_assignments a where a.plan_id = p.id)::int,
         p.updated_at
  from session_plans p
  where p.team_id = p_team and can_read_plans(p_team)
  order by p.updated_at desc;
$$;

-- Create or replace a plan with all its blocks and stations. p_id null = new.
create or replace function public.save_session_plan(p_id uuid, p_team uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_team uuid; v_id uuid; v_block uuid; b jsonb; s jsonb; i int := 0; k int; v_kind text; v_n int; v_ex uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_id is not null then
    select team_id into v_team from session_plans where id = p_id;
    if not found then raise exception 'plan not found'; end if;
  else
    v_team := p_team;
  end if;
  if v_team is null or not can(v_team, 'training', 3) then raise exception 'not allowed'; end if;
  if jsonb_typeof(coalesce(p -> 'blocks', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> 'blocks', '[]'::jsonb)) > 30 then
    raise exception 'too many blocks';
  end if;

  if p_id is null then
    insert into session_plans (team_id, title, goal, notes, status)
    values (v_team, trim(p ->> 'title'), coalesce(trim(p ->> 'goal'), ''), coalesce(trim(p ->> 'notes'), ''), coalesce(p ->> 'status', 'draft'))
    returning id into v_id;
  else
    update session_plans set title = trim(p ->> 'title'), goal = coalesce(trim(p ->> 'goal'), ''), notes = coalesce(trim(p ->> 'notes'), ''),
           status = coalesce(p ->> 'status', status), updated_at = now()
    where id = p_id;
    v_id := p_id;
    delete from session_plan_blocks where plan_id = v_id;
  end if;

  for b in select * from jsonb_array_elements(coalesce(p -> 'blocks', '[]'::jsonb)) loop
    v_kind := b ->> 'kind';
    v_ex := nullif(b ->> 'exercise_id', '')::uuid;
    if v_ex is not null and not exists (select 1 from exercises e where e.id = v_ex and e.status <> 'archived'
                                         and can_read_exercise(e.scope, e.owner_id, e.club_id)) then
      raise exception 'exercise not found';
    end if;
    v_n := jsonb_array_length(coalesce(b -> 'stations', '[]'::jsonb));
    if v_kind = 'stations' then
      if v_n < 2 or v_n > 8 then raise exception 'a stations block needs 2 to 8 stations'; end if;
      if (b ->> 'rounds')::int > v_n then raise exception 'more rounds than stations'; end if;
    end if;
    insert into session_plan_blocks (plan_id, ord, kind, title, exercise_id, duration_min, goal, groups, rounds, station_min, transition_min)
    values (v_id, i, v_kind, coalesce(trim(b ->> 'title'), ''), case when v_kind = 'exercise' then v_ex end,
            case when v_kind <> 'stations' then (b ->> 'duration_min')::smallint end,
            coalesce(trim(b ->> 'goal'), ''),
            case when v_kind = 'stations' then (b ->> 'groups')::smallint end,
            case when v_kind = 'stations' then (b ->> 'rounds')::smallint end,
            case when v_kind = 'stations' then (b ->> 'station_min')::smallint end,
            case when v_kind = 'stations' then coalesce((b ->> 'transition_min')::smallint, 0) end)
    returning id into v_block;
    if v_kind = 'stations' then
      k := 0;
      for s in select * from jsonb_array_elements(b -> 'stations') loop
        v_ex := nullif(s ->> 'exercise_id', '')::uuid;
        if v_ex is not null and not exists (select 1 from exercises e where e.id = v_ex and e.status <> 'archived'
                                             and can_read_exercise(e.scope, e.owner_id, e.club_id)) then
          raise exception 'exercise not found';
        end if;
        insert into session_plan_stations (block_id, ord, exercise_id, title, responsible)
        values (v_block, k, v_ex, coalesce(trim(s ->> 'title'), ''), coalesce(trim(s ->> 'responsible'), ''));
        k := k + 1;
      end loop;
    end if;
    i := i + 1;
  end loop;
  return v_id;
end $$;

create or replace function public.delete_session_plan(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select team_id into v_team from session_plans where id = p_id;
  if not found or not can(v_team, 'training', 3) then raise exception 'not allowed'; end if;
  delete from session_plans where id = p_id;  -- assignments keep their snapshot (plan_id becomes null)
end $$;

-- Assign a plan to a training of the same team (replaces an earlier one).
-- The snapshot freezes the plan as it is now.
create or replace function public.assign_session_plan(p_session uuid, p_plan uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_plan_team uuid;
begin
  select team_id into v_team from training_sessions where id = p_session;
  select team_id into v_plan_team from session_plans where id = p_plan;
  if v_team is null or v_plan_team is null or v_team <> v_plan_team or not can(v_team, 'training', 3) then
    raise exception 'not allowed';
  end if;
  insert into session_plan_assignments (session_id, plan_id, snapshot)
  values (p_session, p_plan, session_plan_json(p_plan))
  on conflict (session_id) do update set plan_id = excluded.plan_id, snapshot = excluded.snapshot,
                                         assigned_by = auth.uid(), assigned_at = now();
end $$;

create or replace function public.unassign_session_plan(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select team_id into v_team from training_sessions where id = p_session;
  if v_team is null or not can(v_team, 'training', 3) then raise exception 'not allowed'; end if;
  delete from session_plan_assignments where session_id = p_session;
end $$;

-- What a parent or player may see about the plan of a training: title and goal only.
create or replace function public.session_plan_summary(p_session uuid)
returns table (title text, goal text) language sql stable security definer set search_path = public as $$
  select a.snapshot ->> 'title', a.snapshot ->> 'goal'
  from session_plan_assignments a join training_sessions s on s.id = a.session_id
  where a.session_id = p_session and can_see_team(s.team_id);
$$;

revoke all on function public.can_read_plans(uuid), public.session_plan_json(uuid), public.team_session_plans(uuid),
  public.save_session_plan(uuid, uuid, jsonb), public.delete_session_plan(uuid), public.assign_session_plan(uuid, uuid),
  public.unassign_session_plan(uuid), public.session_plan_summary(uuid) from public, anon;
grant execute on function public.can_read_plans(uuid), public.session_plan_json(uuid), public.team_session_plans(uuid),
  public.save_session_plan(uuid, uuid, jsonb), public.delete_session_plan(uuid), public.assign_session_plan(uuid, uuid),
  public.unassign_session_plan(uuid), public.session_plan_summary(uuid) to authenticated;
grant execute on function public.plan_block_minutes(text, int, int, int, int) to authenticated;


insert into staging.bundle_progress (part) values (6);
select 6 as part_done, 'day4-session-plans' as label;
