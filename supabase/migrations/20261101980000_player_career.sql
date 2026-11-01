-- iplays — player career: stats, monthly trend and athletic progress.
--
-- Run after 20261101971000_match_events.sql (live goal reporting).
-- Rollback: supabase/rollback/20261101980000_player_career.down.sql
-- Additive only: two new tables, one small lookup table, RPCs. No existing
-- table or row changes.
--
-- Everything shown on the career screen is computed from real data:
--   * appearances: a past, not-canceled match where the player was marked
--     present / late, or (with no mark) was in a published lineup, or
--     scored. A match marked absent / excused is never an appearance.
--     Nothing is presumed: no mark and no lineup = no appearance.
--   * starts: published lineup with a slot (on the field, not the bench).
--   * goals / points: match_events (kind 'goal', not deleted) with the
--     player as scorer and the side = the player's team. Basketball counts
--     points (1/2/3), football counts goals.
--   * training attendance: the same rule as team_attendance_summary (a
--     past training with no mark and no absence report counts as present).
--   * athletic progress: coach assessments (1-10 per attribute) and
--     fitness tests, entered by staff with metrics >= 3. Only the child's
--     parents and team staff with metrics >= 1 see them.
--   * highlights: derived (first goal, 2+ / 3+ goals in a match, personal
--     best in a fitness test).
-- There is no minutes-played source, so the career shows starts instead.

begin;

-- ----------------------------------------------------------- fitness tests

create table if not exists public.fitness_test_types (
  code text primary key,
  label text not null,
  unit text not null,
  lower_is_better boolean not null,
  sort int not null
);
insert into public.fitness_test_types (code, label, unit, lower_is_better, sort) values
  ('sprint_10m', 'ספרינט 10 מ׳', 'שניות', true, 1),
  ('sprint_30m', 'ספרינט 30 מ׳', 'שניות', true, 2),
  ('agility', 'זריזות (שאטל 5-10-5)', 'שניות', true, 3),
  ('beep_test', 'מבחן בליפ', 'שלב', false, 4),
  ('long_jump', 'קפיצה למרחק מהמקום', 'ס״מ', false, 5),
  ('juggling', 'הקפצות כדור', 'הקפצות', false, 6)
on conflict (code) do nothing;
alter table public.fitness_test_types enable row level security;
drop policy if exists fitness_test_types_read on public.fitness_test_types;
create policy fitness_test_types_read on public.fitness_test_types for select to authenticated using (true);

create table if not exists public.player_fitness_tests (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  test text not null references public.fitness_test_types (code),
  value numeric(7, 2) not null check (value >= 0 and value < 100000),
  tested_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);
create index if not exists player_fitness_tests_player_idx on public.player_fitness_tests (player_id, test, tested_on);

-- -------------------------------------------------------- coach assessments

create table if not exists public.player_assessments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  assessed_on date not null default current_date,
  speed smallint check (speed between 1 and 10),
  stamina smallint check (stamina between 1 and 10),
  technique smallint check (technique between 1 and 10),
  vision smallint check (vision between 1 and 10),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  check (num_nonnulls(speed, stamina, technique, vision) > 0)
);
create index if not exists player_assessments_player_idx on public.player_assessments (player_id, assessed_on);

-- Who may see a child's assessments and tests: the child's parents, and
-- staff of a team the child is in with metrics >= 1.
create or replace function public.can_view_player_metrics(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_player_parent(p_player)
      or is_platform_admin()
      or exists (select 1 from player_assignments a
                 where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'metrics', 1));
$$;

alter table public.player_fitness_tests enable row level security;
drop policy if exists player_fitness_tests_read on public.player_fitness_tests;
create policy player_fitness_tests_read on public.player_fitness_tests for select to authenticated
  using (deleted_at is null and can_view_player_metrics(player_id));

alter table public.player_assessments enable row level security;
drop policy if exists player_assessments_read on public.player_assessments;
create policy player_assessments_read on public.player_assessments for select to authenticated
  using (deleted_at is null and can_view_player_metrics(player_id));

-- Writes go through these RPCs only (no insert / update / delete policies).

create or replace function public.metrics_check_player(p_player uuid, p_team uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not can(p_team, 'metrics', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from player_assignments a
                 where a.player_id = p_player and a.team_id = p_team and a.ended_on is null) then
    raise exception 'player not in this team' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.save_player_assessment(
  p_player uuid, p_team uuid, p_on date,
  p_speed int, p_stamina int, p_technique int, p_vision int, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform metrics_check_player(p_player, p_team);
  if p_on is null or p_on > current_date then
    raise exception 'date in the future' using errcode = '22023';
  end if;
  insert into player_assessments (player_id, team_id, assessed_on, speed, stamina, technique, vision, note)
  values (p_player, p_team, p_on, p_speed, p_stamina, p_technique, p_vision, left(coalesce(p_note, ''), 300))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_fitness_test(
  p_player uuid, p_team uuid, p_test text, p_value numeric, p_on date, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform metrics_check_player(p_player, p_team);
  if p_on is null or p_on > current_date then
    raise exception 'date in the future' using errcode = '22023';
  end if;
  insert into player_fitness_tests (player_id, team_id, test, value, tested_on, note)
  values (p_player, p_team, p_test, p_value, p_on, left(coalesce(p_note, ''), 200))
  returning id into v_id;
  return v_id;
end;
$$;

-- Remove a mistaken entry (soft: the row stays, hidden).
create or replace function public.remove_player_metric(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if p_kind = 'assessment' then
    select team_id into v_team from player_assessments where id = p_id and deleted_at is null;
  elsif p_kind = 'fitness' then
    select team_id into v_team from player_fitness_tests where id = p_id and deleted_at is null;
  else
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if v_team is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not can(v_team, 'metrics', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind = 'assessment' then
    update player_assessments set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  else
    update player_fitness_tests set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  end if;
end;
$$;

-- -------------------------------------------------------------- the career

-- Israeli season label for a date: Aug-Jul, e.g. 2026-10-01 -> '2026/27'.
create or replace function public.season_label(p_d date)
returns text language sql immutable as $$
  select (case when extract(month from p_d) >= 8 then extract(year from p_d) else extract(year from p_d) - 1 end)::int
         || '/' || lpad((((case when extract(month from p_d) >= 8 then extract(year from p_d) else extract(year from p_d) - 1 end)::int + 1) % 100)::text, 2, '0');
$$;

-- One child's whole career as JSON. Empty object when the caller may not
-- see the child. 'metrics' (assessments, tests) only for parents / staff.
create or replace function public.player_career(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_metrics boolean;
  v_out jsonb;
begin
  if auth.uid() is null or not can_view_player(p_player) then
    return '{}'::jsonb;
  end if;
  v_metrics := can_view_player_metrics(p_player);

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
                        'birth_year', p.birth_year, 'shirt_number', a.shirt_number, 'position', p.position,
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
                     order by a.is_primary desc limit 1)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.player_career(uuid) from public, anon;
grant execute on function public.player_career(uuid) to authenticated;
revoke all on function public.save_player_assessment(uuid, uuid, date, int, int, int, int, text) from public, anon;
grant execute on function public.save_player_assessment(uuid, uuid, date, int, int, int, int, text) to authenticated;
revoke all on function public.add_fitness_test(uuid, uuid, text, numeric, date, text) from public, anon;
grant execute on function public.add_fitness_test(uuid, uuid, text, numeric, date, text) to authenticated;
revoke all on function public.remove_player_metric(text, uuid) from public, anon;
grant execute on function public.remove_player_metric(text, uuid) to authenticated;
revoke all on function public.metrics_check_player(uuid, uuid) from public, anon;

commit;
