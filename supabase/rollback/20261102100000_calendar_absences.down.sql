-- Rollback of 20261102100000_calendar_absences.sql.
--
-- Restores the previous attendance, career and notification functions and
-- the earlier training policies, and removes the new RPCs. Keeps every
-- table, column and row (training_participants, absence_documents, the
-- medical-docs bucket and its files, applies_to, the 'injury' reason);
-- running the migration again picks them up. While rolled back:
--   * goalkeeper / personal trainings stay hidden (the restored read policy
--     shows only team trainings), so nothing private leaks;
--   * absence documents and their files are unreadable (no policies).

begin;

drop trigger if exists training_sessions_guard on public.training_sessions;
drop trigger if exists training_notify_private_delete on public.training_sessions;
drop trigger if exists player_absences_touch on public.player_absences;
drop trigger if exists absence_documents_before on public.absence_documents;

drop policy if exists sessions_select on public.training_sessions;
create policy sessions_select on public.training_sessions for select to authenticated
  using (audience = 'team' and (is_team_member(team_id) or can(team_id, 'training', 1)));
drop policy if exists sessions_update on public.training_sessions;
create policy sessions_update on public.training_sessions for update to authenticated
  using (can(team_id, 'training', 3)) with check (can(team_id, 'training', 3));
drop policy if exists sessions_delete on public.training_sessions;
create policy sessions_delete on public.training_sessions for delete to authenticated using (can(team_id, 'training', 3));
drop policy if exists sessions_update_member on public.training_sessions;
create policy sessions_update_member on public.training_sessions for update to authenticated
  using (is_team_participant(team_id)) with check (is_team_participant(team_id));
drop policy if exists sessions_delete_member on public.training_sessions;
create policy sessions_delete_member on public.training_sessions for delete to authenticated
  using (is_team_participant(team_id));

drop policy if exists training_participants_select on public.training_participants;
drop policy if exists absence_documents_select on public.absence_documents;
drop policy if exists absence_documents_insert on public.absence_documents;
drop policy if exists absence_documents_delete on public.absence_documents;
drop policy if exists medical_docs_insert on storage.objects;
drop policy if exists medical_docs_select on storage.objects;
drop policy if exists medical_docs_delete on storage.objects;

-- previous function versions (20261101995000, 20261101500000, 20261101985000)

create or replace function public.notify_training_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select n.team_id, count(*) n, min(n.starts_at) first_at, (array_agg(n.id order by n.starts_at))[1] first_id,
           (array_agg(n.location order by n.starts_at))[1] loc
    from new_rows n where n.starts_at > now() and not n.canceled group by n.team_id
  loop
    perform notify_users(team_member_ids(r.team_id), r.team_id, 'training',
      case when r.n = 1 then 'אימון חדש' else 'נוספו ' || r.n || ' אימונים' end,
      concat_ws(' · ', case when r.n > 1 then 'הראשון' end, il_time(r.first_at), nullif(r.loc, '')),
      '#coach/' || r.team_id, r.first_id, 'team_updates');
  end loop;
  return null;
end;
$$;

create or replace function public.notify_training_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select o.team_id, count(*) n, min(o.starts_at) first_at
    from old_rows o where o.starts_at > now() and not o.canceled group by o.team_id
  loop
    perform notify_users(team_member_ids(r.team_id), r.team_id, 'training',
      case when r.n = 1 then 'אימון בוטל' else r.n || ' אימונים בוטלו' end,
      case when r.n = 1 then il_time(r.first_at) else 'החל מ־' || il_time(r.first_at) end,
      '#coach/' || r.team_id, null, 'team_updates');
  end loop;
  return null;
end;
$$;

create or replace function public.notify_training_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  if new.starts_at < now() and old.starts_at < now() then
    return null;
  end if;
  if new.canceled and not old.canceled then
    v_title := 'אימון בוטל';
  elsif old.canceled and not new.canceled then
    v_title := 'אימון חזר לתוכנית';
  elsif not new.canceled and (new.starts_at <> old.starts_at or new.location <> old.location) then
    v_title := 'שינוי באימון';
  else
    return null;
  end if;
  perform notify_users(team_member_ids(new.team_id), new.team_id, 'training', v_title,
    concat_ws(' · ', il_time(new.starts_at), nullif(new.location, '')), '#coach/' || new.team_id, new.id, 'team_updates');
  return null;
end;
$$;

create or replace function public.event_attendance(p_kind text, p_event uuid)
returns table (
  player_id uuid, first_name text, last_name text, shirt_number int,
  expected text, reason text, report_note text, reported_minutes_late int,
  status text, minutes_late int, effective text
)
language plpgsql stable security definer set search_path = public as $$
declare
  e record;
begin
  select * into e from event_team_and_date(p_kind, p_event);
  if e.team_id is null or not can(e.team_id, 'attendance', 1) then
    return;
  end if;
  return query
  select p.id, p.first_name, p.last_name, a.shirt_number,
         coalesce(ab.kind, 'coming'), ab.reason, ab.note, ab.minutes_late,
         r.status, r.minutes_late::int,
         coalesce(r.status, case ab.kind when 'absent' then 'absent' when 'late' then 'late' else 'coming' end)
  from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  left join lateral (
    select x.kind, x.reason, x.note, x.minutes_late from player_absences x
    where x.player_id = p.id
      and ((p_kind = 'training' and x.session_id = p_event)
           or (x.session_id is null and e.on_date between x.from_date and x.to_date))
    order by (x.session_id is not null) desc, x.created_at desc
    limit 1
  ) ab on true
  left join attendance_records r on r.player_id = p.id
    and ((p_kind = 'training' and r.session_id = p_event) or (p_kind = 'match' and r.match_id = p_event))
  where a.team_id = e.team_id and a.ended_on is null
  order by a.shirt_number nulls last, p.first_name;
end;
$$;

create or replace function public.mark_attendance(
  p_kind text, p_event uuid, p_player uuid, p_status text, p_minutes_late int default null, p_note text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  select * into e from event_team_and_date(p_kind, p_event);
  if e.team_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if not can(e.team_id, 'attendance', 2) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from player_assignments a where a.player_id = p_player and a.team_id = e.team_id and a.ended_on is null) then
    raise exception 'player not in this team' using errcode = '22023';
  end if;
  if p_status is null then
    delete from attendance_records
    where player_id = p_player
      and ((p_kind = 'training' and session_id = p_event) or (p_kind = 'match' and match_id = p_event));
    return;
  end if;
  if p_kind = 'training' then
    insert into attendance_records (team_id, session_id, player_id, status, minutes_late, note)
    values (e.team_id, p_event, p_player, p_status, case when p_status = 'late' then p_minutes_late end, coalesce(p_note, ''))
    on conflict (session_id, player_id) where session_id is not null do update set
      status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note,
      marked_by = auth.uid(), marked_at = now();
  else
    insert into attendance_records (team_id, match_id, player_id, status, minutes_late, note)
    values (e.team_id, p_event, p_player, p_status, case when p_status = 'late' then p_minutes_late end, coalesce(p_note, ''))
    on conflict (match_id, player_id) where match_id is not null do update set
      status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note,
      marked_by = auth.uid(), marked_at = now();
  end if;
end;
$$;

create or replace function public.team_attendance_summary(p_team uuid, p_from date, p_to date)
returns table (player_id uuid, first_name text, last_name text, events int, present int, late int, absent int, rate int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can(p_team, 'attendance', 1) then
    return;
  end if;
  return query
  with ev as (
    select 'training'::text as kind, s.id, (s.starts_at at time zone 'Asia/Jerusalem')::date as d
    from training_sessions s
    where s.team_id = p_team and not s.canceled and s.audience = 'team' and s.starts_at < now()
      and (s.starts_at at time zone 'Asia/Jerusalem')::date between p_from and p_to
    union all
    select 'match', m.id, (m.starts_at at time zone 'Asia/Jerusalem')::date
    from team_matches m
    where m.team_id = p_team and m.status <> 'canceled' and m.starts_at < now()
      and (m.starts_at at time zone 'Asia/Jerusalem')::date between p_from and p_to
  ),
  cell as (
    select a.player_id, ev.kind, ev.id,
           coalesce(r.status,
             (select case x.kind when 'absent' then 'absent' else 'late' end from player_absences x
              where x.player_id = a.player_id
                and ((ev.kind = 'training' and x.session_id = ev.id) or (x.session_id is null and ev.d between x.from_date and x.to_date))
              order by (x.session_id is not null) desc, x.created_at desc limit 1),
             'present') as st
    from player_assignments a
    cross join ev
    left join attendance_records r on r.player_id = a.player_id
      and ((ev.kind = 'training' and r.session_id = ev.id) or (ev.kind = 'match' and r.match_id = ev.id))
    where a.team_id = p_team and a.ended_on is null and a.started_on <= ev.d
  )
  select p.id, p.first_name, p.last_name,
         count(c.id)::int,
         count(*) filter (where c.st = 'present')::int,
         count(*) filter (where c.st = 'late')::int,
         count(*) filter (where c.st in ('absent', 'excused'))::int,
         case when count(c.id) = 0 then null
              else round(100.0 * count(*) filter (where c.st in ('present', 'late')) / count(c.id))::int end
  from player_assignments a
  join players p on p.id = a.player_id
  left join cell c on c.player_id = a.player_id
  where a.team_id = p_team and a.ended_on is null
  group by p.id, p.first_name, p.last_name
  order by p.first_name;
end;
$$;

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
    join training_sessions s on s.team_id = a.team_id and not s.canceled and s.audience = 'team' and s.starts_at < now()
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

drop function if exists public.create_trainings(uuid, text, text, timestamptz[], int, text, text, text, uuid[]);
drop function if exists public.attendance_report(uuid, date, date);
drop function if exists public.player_attendance(uuid, date, date);
drop function if exists public.attendance_cells(uuid, uuid, date, date, boolean);
drop function if exists public.absence_at(uuid, text, uuid, date);
drop function if exists public.notify_private_training_delete();
drop function if exists public.training_sessions_guard();
drop function if exists public.player_absences_touch();
drop function if exists public.absence_documents_before();
drop function if exists public.medical_doc_player(text);
drop function if exists public.can_see_medical_docs(uuid);
drop function if exists public.session_visible(uuid, uuid, text, uuid, boolean);
drop function if exists public.session_includes(uuid, text, uuid);
drop function if exists public.gk_guardian_ids(uuid);
drop function if exists public.participant_guardian_ids(uuid);
drop function if exists public.is_goalkeeper(uuid);
drop function if exists public.try_uuid(text);

commit;
