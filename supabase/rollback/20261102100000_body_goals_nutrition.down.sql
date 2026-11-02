-- Rollback for 20261102100000_body_goals_nutrition.sql.
-- Puts back the 20261101985000 behaviour (measurements readable by parents
-- and metrics staff, player_career() returns them) and removes the new
-- functions and read policies. The tables child_goals, child_goal_progress,
-- child_nutrition, the new player_measurements columns and all their data
-- are KEPT; running the migration again picks them up. The "at least one
-- value" check keeps counting the new columns, so no existing row breaks.

begin;

drop function if exists public.child_private_profile(uuid);
drop function if exists public.save_child_nutrition(uuid, text, text[], text, text[], text, text, text);
drop function if exists public.remove_child_goal_record(text, uuid);
drop function if exists public.add_child_goal_progress(uuid, date, numeric, text);
drop function if exists public.set_child_goal_status(uuid, text);
drop function if exists public.save_child_goal(uuid, uuid, text, text, text, date, date, text, text, text, numeric, numeric, text);
drop policy if exists child_nutrition_read on public.child_nutrition;
drop policy if exists child_goal_progress_read on public.child_goal_progress;
drop policy if exists child_goals_read on public.child_goals;

create or replace function public.add_player_measurement(
  p_player uuid, p_on date, p_height numeric, p_weight numeric,
  p_thigh numeric, p_calf numeric, p_arm numeric, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_edit_player_domain(p_player, 'metrics', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_on is null or p_on > current_date then
    raise exception 'date in the future' using errcode = '22023';
  end if;
  insert into player_measurements (player_id, measured_on, height_cm, weight_kg, thigh_cm, calf_cm, arm_cm, note)
  values (p_player, p_on, p_height, p_weight, p_thigh, p_calf, p_arm, left(coalesce(p_note, ''), 200))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_player_record(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  if p_kind = 'measurement' then
    select player_id into v_player from player_measurements where id = p_id and deleted_at is null;
    if v_player is null then raise exception 'not found' using errcode = 'P0002'; end if;
    if not can_edit_player_domain(v_player, 'metrics', 3) then raise exception 'not allowed' using errcode = '42501'; end if;
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

drop function if exists public.add_body_measurement(uuid, date, jsonb, jsonb, text);
drop function if exists public.clean_custom_measures(jsonb);

drop policy if exists player_measurements_read on public.player_measurements;
create policy player_measurements_read on public.player_measurements for select to authenticated
  using (deleted_at is null and can_view_player_metrics(player_id));

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
    'measurements', case when v_metrics then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'date', x.measured_on, 'height_cm', x.height_cm, 'weight_kg', x.weight_kg,
               'thigh_cm', x.thigh_cm, 'calf_cm', x.calf_cm, 'arm_cm', x.arm_cm, 'note', x.note)
             order by x.measured_on, x.created_at)
      from player_measurements x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb) end,
    'medical', case when v_medical then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'issued_on', x.issued_on, 'valid_until', x.valid_until,
               'issuer', x.issuer, 'note', x.note)
             order by x.valid_until desc, x.created_at desc)
      from player_medical_clearances x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb) end,
    'can_edit_profile', (is_player_parent(p_player) or exists (select 1 from player_assignments a
                         where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'roster', 3))),
    'can_edit_measurements', can_edit_player_domain(p_player, 'metrics', 3),
    'can_edit_medical', can_edit_player_domain(p_player, 'medical', 3)
  ) into v_out;
  return v_out;
end;
$$;

drop function if exists public.can_see_child_private(uuid);

revoke all on function public.player_career(uuid) from public, anon;
grant execute on function public.player_career(uuid) to authenticated;
revoke all on function public.add_player_measurement(uuid, date, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.add_player_measurement(uuid, date, numeric, numeric, numeric, numeric, numeric, text) to authenticated;
revoke all on function public.remove_player_record(text, uuid) from public, anon;
grant execute on function public.remove_player_record(text, uuid) to authenticated;

commit;
