-- Rollback of 20261102400000_live_match_session.sql.
-- Keeps every row: match_live, match_reporter_queue, match_reports and the new
-- match_events columns stay (running the migration again picks them up). The
-- wider match_events.kind list (cards) also stays, so recorded cards remain
-- valid. Restores the PR #21 versions of the reporting functions.
begin;

do $$
declare
  t text;
begin
  foreach t in array array['match_live', 'match_reporter_queue', 'match_reports'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end;
$$;

drop function if exists public.match_reports_feed(uuid);
drop function if exists public.review_match_report(uuid, boolean, text, int, int);
drop function if exists public.update_match_report(uuid, text, int, text);
drop function if exists public.submit_match_report(uuid, text, text, int, int, text);
drop function if exists public.finalize_match_result(uuid, int, int);
drop function if exists public.match_clock(uuid, text);
drop function if exists public.answer_reporter_offer(uuid, boolean);
drop function if exists public.release_match_reporter(uuid);
drop function if exists public.leave_reporter_queue(uuid);
drop function if exists public.join_reporter_queue(uuid);
drop function if exists public.claim_match_reporter(uuid, boolean);
drop function if exists public.match_live_state(uuid);
drop function if exists public.can_edit_match_event(uuid, uuid);
drop function if exists public.match_minute_now(public.team_matches, public.match_live);
drop function if exists public.match_live_check(uuid);
drop function if exists public.match_staff(uuid);
drop function if exists public.match_person_label(uuid, uuid);
drop function if exists public.match_live_offer_next(uuid);
drop function if exists public.match_live_advance(uuid);
drop function if exists public.match_clock_seconds(public.match_live);
drop function if exists public.match_live_row(uuid);

-- the PR #21 versions
drop function if exists public.match_events_feed(uuid);
create or replace function public.report_match_goal(p_match uuid, p_side text, p_shirt int default null, p_points int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  v_ours boolean;
  v_minute int;
  v_id uuid;
begin
  select * into m from team_matches where id = p_match;
  if not found then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if not can_report_match(m.team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.status = 'canceled' then
    raise exception 'match canceled' using errcode = '22023';
  end if;
  if p_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  -- reports are taken around the game only: from 2 hours before kickoff to a day after
  if now() < m.starts_at - interval '2 hours' or now() > m.starts_at + interval '1 day' then
    raise exception 'match not live' using errcode = '22023';
  end if;
  if (select count(*) from match_events where match_id = p_match and deleted_at is null) >= 150 then
    raise exception 'too many reports' using errcode = '22023';
  end if;
  v_ours := (p_side = 'home') = m.home;
  -- game minute, only while the kickoff time is known
  if coalesce(m.time_confirmed, true) and now() >= m.starts_at then
    v_minute := least(200, floor(extract(epoch from now() - m.starts_at) / 60)::int + 1);
  end if;
  insert into match_events (match_id, team_id, side, points, shirt_number, player_id, minute)
  values (p_match, m.team_id, p_side, greatest(1, least(3, coalesce(p_points, 1))),
          p_shirt, case when v_ours and p_shirt is not null then match_scorer_by_number(m.team_id, p_shirt) end, v_minute)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_match_goal_scorer(p_event uuid, p_shirt int)
returns void language plpgsql security definer set search_path = public as $$
declare
  e match_events%rowtype;
  v_home boolean;
begin
  select * into e from match_events where id = p_event and deleted_at is null;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if not can_report_match(e.team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select home into v_home from team_matches where id = e.match_id;
  update match_events
  set shirt_number = p_shirt,
      player_id = case when (e.side = 'home') = v_home and p_shirt is not null then match_scorer_by_number(e.team_id, p_shirt) end
  where id = p_event;
end;
$$;

create or replace function public.remove_match_event(p_event uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from match_events where id = p_event and deleted_at is null;
  if v_team is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if not can_report_match(v_team) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update match_events set deleted_at = now(), deleted_by = auth.uid() where id = p_event;
end;
$$;

create function public.match_events_feed(p_match uuid)
returns table (
  id uuid, side text, points int, shirt_number int, player_id uuid, scorer_name text,
  minute int, created_at timestamptz, created_by uuid, reporter_name text
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
  select e.id, e.side, e.points::int, e.shirt_number::int, e.player_id,
         nullif(trim(p.first_name || ' ' || p.last_name), ''),
         e.minute::int, e.created_at, e.created_by, nullif(pr.full_name, '')
  from match_events e
  left join players p on p.id = e.player_id
  left join profiles pr on pr.id = e.created_by
  where e.match_id = p_match and e.deleted_at is null
  order by e.created_at;
end;
$$;

revoke all on function public.report_match_goal(uuid, text, int, int), public.set_match_goal_scorer(uuid, int),
  public.remove_match_event(uuid), public.match_events_feed(uuid) from public, anon;
grant execute on function public.report_match_goal(uuid, text, int, int), public.set_match_goal_scorer(uuid, int),
  public.remove_match_event(uuid), public.match_events_feed(uuid) to authenticated;

commit;
