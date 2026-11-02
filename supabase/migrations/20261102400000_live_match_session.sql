-- iplays — live match: shared clock and halves, one primary reporter with a
-- queue, secondary reports that the primary approves, cards, final result.
--
-- Run after 20261102200000_match_overrides.sql (needs 20261101971000_match_events.sql;
-- it only depends on match_events and team_matches; it writes the score only of the team's own games, never IFA games).
-- Rollback: supabase/rollback/20261102400000_live_match_session.down.sql
-- Additive: three new tables, new columns on match_events, a wider
-- match_events.kind list (adds cards), functions and policies. No row is
-- changed or removed. Career counts (kind = 'goal', not deleted) are unchanged.
--
-- Product spec (2026-11-02, project owner, sections 16-17):
-- * One active primary reporter per game. Others join a queue. The primary
--   starts the game, runs the halves, reports, approves other parents'
--   reports, ends the game and confirms the final result.
-- * "Stop reporting" offers the role to the next in the queue; with no answer
--   within 60 seconds it moves on to the one after. A reporter is never
--   replaced just for being idle (team staff can take over explicitly).
-- * Any member may send a report (goal, scorer number or name, yellow / red
--   card), partial if that's all they know. It waits for the primary; only an
--   approved report changes the score. Similar reports close in time are
--   merged (counted as confirmations) instead of piling up.
-- * The clock runs on the server: clock_base + (now - clock_started_at), so
--   every phone shows the same time. It keeps running through stoppages; the
--   primary stops it at the end of a half and starts it for the next. No fixed
--   number or length of halves.
-- * While no one holds the primary role, a report counts at once (as before),
--   so goals are never stuck waiting for nobody.
-- * Corrections after the final result: team staff (matches >= edit).

begin;

-- ------------------------------------------------------- match_events

alter table public.match_events drop constraint if exists match_events_kind_check;
alter table public.match_events add constraint match_events_kind_check check (kind in ('goal', 'yellow', 'red'));
alter table public.match_events add column if not exists period smallint check (period between 1 and 9);
alter table public.match_events add column if not exists clock_seconds int check (clock_seconds >= 0);
alter table public.match_events add column if not exists player_name text check (char_length(player_name) <= 60);
alter table public.match_events add column if not exists approved_by uuid references auth.users (id) on delete set null;

-- ------------------------------------------------------------ tables

-- One row per game that went live.
create table if not exists public.match_live (
  match_id uuid primary key references public.team_matches (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  status text not null default 'not_started' check (status in ('not_started', 'running', 'break', 'finished')),
  period smallint not null default 0 check (period between 0 and 9),
  clock_base int not null default 0 check (clock_base >= 0),
  clock_started_at timestamptz,
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_since timestamptz,
  offer_to uuid references auth.users (id) on delete set null,
  offer_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  final_home smallint check (final_home between 0 and 300),
  final_away smallint check (final_away between 0 and 300),
  finalized_at timestamptz,
  finalized_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.match_reporter_queue (
  match_id uuid not null references public.team_matches (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete restrict,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- Reports from parents that wait for the primary reporter.
create table if not exists public.match_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.team_matches (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  kind text not null default 'goal' check (kind in ('goal', 'yellow', 'red')),
  side text check (side in ('home', 'away')),
  points smallint not null default 1 check (points between 1 and 3),
  shirt_number smallint check (shirt_number between 0 and 99),
  player_id uuid references public.players (id) on delete set null,
  player_name text check (char_length(player_name) <= 60),
  period smallint,
  clock_seconds int,
  minute smallint,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'merged')),
  merged_into uuid references public.match_reports (id) on delete set null,
  confirmations smallint not null default 1,
  event_id uuid references public.match_events (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz
);
create index if not exists match_reports_match_idx on public.match_reports (match_id, created_at);
create index if not exists match_reports_pending_idx on public.match_reports (match_id) where status = 'pending';

-- ------------------------------------------------------------ helpers

create or replace function public.match_live_row(p_match uuid)
returns public.match_live language plpgsql security definer set search_path = public as $$
declare
  r match_live%rowtype;
begin
  insert into match_live (match_id, team_id)
  select id, team_id from team_matches where id = p_match
  on conflict (match_id) do nothing;
  select * into r from match_live where match_id = p_match for update;
  return r;
end;
$$;

-- Seconds on the game clock now.
create or replace function public.match_clock_seconds(l public.match_live)
returns int language sql stable set search_path = public as $$
  select coalesce(l.clock_base, 0)
         + coalesce(floor(extract(epoch from now() - l.clock_started_at))::int, 0);
$$;

-- Hand the offer on when 60 seconds passed without an answer.
create or replace function public.match_live_advance(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l match_live%rowtype;
  v_next uuid;
begin
  select * into l from match_live where match_id = p_match for update;
  if not found or l.offer_to is null or l.offer_at > now() - interval '60 seconds' then
    return;
  end if;
  delete from match_reporter_queue where match_id = p_match and user_id = l.offer_to;
  select user_id into v_next from match_reporter_queue where match_id = p_match order by joined_at limit 1;
  update match_live set offer_to = v_next, offer_at = case when v_next is not null then now() end, updated_at = now()
  where match_id = p_match;
end;
$$;

-- Offer the role to the first in the queue (after the reporter left).
create or replace function public.match_live_offer_next(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_next uuid;
begin
  select user_id into v_next from match_reporter_queue where match_id = p_match order by joined_at limit 1;
  update match_live set offer_to = v_next, offer_at = case when v_next is not null then now() end, updated_at = now()
  where match_id = p_match;
end;
$$;

-- "Dana Levi (ההורה של יונתן)": the name and the user's children in this team.
create or replace function public.match_person_label(p_user uuid, p_team uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(pr.full_name), ''), 'הורה') ||
         coalesce(' (ההורה של ' || (
           select string_agg(distinct p.first_name, ' ו') from player_guardians g
           join player_assignments a on a.player_id = g.player_id and a.team_id = p_team and a.ended_on is null
           join players p on p.id = g.player_id
           where g.user_id = p_user) || ')', '')
  from profiles pr where pr.id = p_user;
$$;

create or replace function public.match_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select can(p_team, 'matches', 3);
$$;

-- Common checks; returns the match.
create or replace function public.match_live_check(p_match uuid)
returns public.team_matches language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
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
  return m;
end;
$$;

-- --------------------------------------------------------- state RPC

create or replace function public.match_live_state(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  l match_live%rowtype;
begin
  select team_id into v_team from team_matches where id = p_match;
  if v_team is null or not (is_team_member(v_team) or can(v_team, 'matches', 1)) then
    return null;
  end if;
  perform match_live_advance(p_match);
  select * into l from match_live where match_id = p_match;
  if not found then
    return jsonb_build_object('status', 'not_started', 'period', 0, 'clock_seconds', 0, 'running', false,
      'server_now', now(), 'queue', '[]'::jsonb, 'staff', match_staff(v_team));
  end if;
  return jsonb_build_object(
    'status', l.status,
    'period', l.period,
    'clock_seconds', match_clock_seconds(l),
    'running', l.clock_started_at is not null,
    'server_now', now(),
    'reporter_id', l.reporter_id,
    'reporter_label', case when l.reporter_id is not null then match_person_label(l.reporter_id, l.team_id) end,
    'offer_to', l.offer_to,
    'offer_label', case when l.offer_to is not null then match_person_label(l.offer_to, l.team_id) end,
    'offer_seconds_left', case when l.offer_to is not null then greatest(0, 60 - floor(extract(epoch from now() - l.offer_at))::int) end,
    'queue', coalesce((select jsonb_agg(jsonb_build_object('user_id', q.user_id, 'label', match_person_label(q.user_id, l.team_id)) order by q.joined_at)
                       from match_reporter_queue q where q.match_id = p_match), '[]'::jsonb),
    'final_home', l.final_home,
    'final_away', l.final_away,
    'finalized_at', l.finalized_at,
    'staff', match_staff(l.team_id)
  );
end;
$$;

-- -------------------------------------------------- reporter role RPCs

-- Become the primary reporter: when no one holds the role and no one else has
-- the open offer. Team staff can take over with p_force.
create or replace function public.claim_match_reporter(p_match uuid, p_force boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  l match_live%rowtype;
  me uuid := auth.uid();
begin
  m := match_live_check(p_match);
  perform match_live_advance(p_match);
  l := match_live_row(p_match);
  if l.reporter_id = me then
    return;
  end if;
  if not (p_force and match_staff(m.team_id)) then
    if l.reporter_id is not null then
      raise exception 'reporter taken' using errcode = '55000';
    end if;
    if l.offer_to is not null and l.offer_to <> me then
      raise exception 'offer pending' using errcode = '55000';
    end if;
  end if;
  update match_live set reporter_id = me, reporter_since = now(), offer_to = null, offer_at = null, updated_at = now()
  where match_id = p_match;
  delete from match_reporter_queue where match_id = p_match and user_id = me;
end;
$$;

create or replace function public.join_reporter_queue(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  l match_live%rowtype;
begin
  m := match_live_check(p_match);
  l := match_live_row(p_match);
  if l.reporter_id = auth.uid() then
    return;
  end if;
  insert into match_reporter_queue (match_id, user_id, team_id) values (p_match, auth.uid(), m.team_id)
  on conflict do nothing;
  -- the role is free and nobody has the offer: offer it now
  if l.reporter_id is null and l.offer_to is null then
    perform match_live_offer_next(p_match);
  end if;
end;
$$;

create or replace function public.leave_reporter_queue(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l match_live%rowtype;
begin
  perform match_live_check(p_match);
  delete from match_reporter_queue where match_id = p_match and user_id = auth.uid();
  select * into l from match_live where match_id = p_match for update;
  if found and l.offer_to = auth.uid() then
    perform match_live_offer_next(p_match);
  end if;
end;
$$;

-- "הפסק לדווח": give the role up; the next in the queue gets the offer.
create or replace function public.release_match_reporter(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l match_live%rowtype;
begin
  perform match_live_check(p_match);
  l := match_live_row(p_match);
  if l.reporter_id is distinct from auth.uid() then
    raise exception 'not the reporter' using errcode = '42501';
  end if;
  update match_live set reporter_id = null, reporter_since = null, updated_at = now() where match_id = p_match;
  perform match_live_offer_next(p_match);
end;
$$;

-- Answer the offer: accept = become the reporter, decline = pass to the next.
create or replace function public.answer_reporter_offer(p_match uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  l match_live%rowtype;
begin
  perform match_live_check(p_match);
  perform match_live_advance(p_match);
  l := match_live_row(p_match);
  if l.offer_to is distinct from auth.uid() then
    raise exception 'offer expired' using errcode = '55000';
  end if;
  if p_accept then
    perform claim_match_reporter(p_match);
  else
    delete from match_reporter_queue where match_id = p_match and user_id = auth.uid();
    perform match_live_offer_next(p_match);
  end if;
end;
$$;

-- -------------------------------------------------------- clock RPCs

-- p_action: start | end_period | start_period | finish | reopen
create or replace function public.match_clock(p_match uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  l match_live%rowtype;
begin
  m := match_live_check(p_match);
  l := match_live_row(p_match);
  if l.reporter_id is distinct from auth.uid() and not match_staff(m.team_id) then
    raise exception 'not the reporter' using errcode = '42501';
  end if;
  if p_action = 'start' and l.status = 'not_started' then
    update match_live set status = 'running', period = 1, clock_base = 0, clock_started_at = now(), started_at = now()
    where match_id = p_match;
  elsif p_action = 'end_period' and l.status = 'running' then
    update match_live set status = 'break', clock_base = match_clock_seconds(l), clock_started_at = null
    where match_id = p_match;
  elsif p_action = 'start_period' and l.status = 'break' then
    update match_live set status = 'running', period = least(9, period + 1), clock_started_at = now()
    where match_id = p_match;
  elsif p_action = 'finish' and l.status in ('running', 'break') then
    update match_live set status = 'finished', clock_base = match_clock_seconds(l), clock_started_at = null, ended_at = now()
    where match_id = p_match;
  elsif p_action = 'reopen' and l.status = 'finished' and l.finalized_at is null then
    update match_live set status = 'break', ended_at = null where match_id = p_match;
  else
    raise exception 'clock action not possible now' using errcode = '22023';
  end if;
  update match_live set updated_at = now() where match_id = p_match;
end;
$$;

-- Confirm the final result (after "finish"). For the team's own (non-IFA)
-- games it also becomes the match score; an IFA game keeps the IFA result.
create or replace function public.finalize_match_result(p_match uuid, p_home int, p_away int)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  l match_live%rowtype;
begin
  m := match_live_check(p_match);
  l := match_live_row(p_match);
  if l.finalized_at is not null and not match_staff(m.team_id) then
    raise exception 'already final' using errcode = '42501';
  end if;
  if l.reporter_id is distinct from auth.uid() and not match_staff(m.team_id) then
    raise exception 'not the reporter' using errcode = '42501';
  end if;
  if l.status <> 'finished' then
    raise exception 'finish the match first' using errcode = '22023';
  end if;
  if p_home is null or p_away is null or p_home < 0 or p_away < 0 or p_home > 300 or p_away > 300 then
    raise exception 'score out of range' using errcode = '22023';
  end if;
  update match_live set final_home = p_home, final_away = p_away, finalized_at = now(), finalized_by = auth.uid(), updated_at = now()
  where match_id = p_match;
  if coalesce(m.source, 'club') = 'club' then
    update team_matches
    set score_for = case when m.home then p_home else p_away end,
        score_against = case when m.home then p_away else p_home end,
        status = 'played'
    where id = p_match;
  end if;
end;
$$;

-- ------------------------------------------------------- report RPCs

create or replace function public.match_minute_now(m public.team_matches, l public.match_live)
returns int language sql stable set search_path = public as $$
  select case
    when l.match_id is not null and l.status in ('running', 'break', 'finished') and l.period > 0
      then least(200, match_clock_seconds(l) / 60 + 1)
    when coalesce(m.time_confirmed, true) and now() >= m.starts_at
      then least(200, floor(extract(epoch from now() - m.starts_at) / 60)::int + 1)
  end;
$$;

-- Send a report. The primary reporter's report (or anyone's while no one holds
-- the role) counts at once; otherwise it waits for the primary's approval.
-- Partial reports are fine: p_side null = team not known (filled in from the
-- roster when the shirt number matches ours, else by the primary).
-- Returns {"applied": bool, "id": event or report id, "merged": bool}.
create or replace function public.submit_match_report(
  p_match uuid, p_kind text default 'goal', p_side text default null, p_shirt int default null,
  p_points int default 1, p_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  l match_live%rowtype;
  me uuid := auth.uid();
  v_side text := p_side;
  v_player uuid;
  v_kind text := coalesce(p_kind, 'goal');
  v_points int := case when coalesce(p_kind, 'goal') = 'goal' then greatest(1, least(3, coalesce(p_points, 1))) else 1 end;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 60), '');
  v_minute int;
  v_clock int;
  v_dup match_reports%rowtype;
  v_id uuid;
begin
  m := match_live_check(p_match);
  if v_kind not in ('goal', 'yellow', 'red') then
    raise exception 'unknown report kind' using errcode = '22023';
  end if;
  if v_side is not null and v_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  if now() < m.starts_at - interval '2 hours' or now() > m.starts_at + interval '1 day' then
    raise exception 'match not live' using errcode = '22023';
  end if;
  perform match_live_advance(p_match);
  select * into l from match_live where match_id = p_match;
  if found and l.finalized_at is not null and not match_staff(m.team_id) then
    raise exception 'already final' using errcode = '42501';
  end if;
  -- a number that matches our roster: our side, and we know the player
  if p_shirt is not null and (v_side is null or (v_side = 'home') = m.home) then
    v_player := match_scorer_by_number(m.team_id, p_shirt);
    if v_player is not null and v_side is null then
      v_side := case when m.home then 'home' else 'away' end;
    end if;
  end if;
  v_minute := match_minute_now(m, l);
  v_clock := case when l.match_id is not null and l.period > 0 then match_clock_seconds(l) end;

  if coalesce(l.reporter_id = me, false) or (l.reporter_id is null and l.offer_to is null) then
    if v_side is null then
      raise exception 'choose the team' using errcode = '22023';
    end if;
    if (select count(*) from match_events where match_id = p_match and deleted_at is null) >= 150 then
      raise exception 'too many reports' using errcode = '22023';
    end if;
    insert into match_events (match_id, team_id, kind, side, points, shirt_number, player_id, player_name, minute, period, clock_seconds, approved_by)
    values (p_match, m.team_id, v_kind, v_side, v_points, p_shirt, v_player, v_name, v_minute, nullif(l.period, 0), v_clock, me)
    returning id into v_id;
    return jsonb_build_object('applied', true, 'id', v_id, 'merged', false);
  end if;

  if (select count(*) from match_reports where match_id = p_match) >= 400 then
    raise exception 'too many reports' using errcode = '22023';
  end if;
  -- a similar pending report from the last 90 seconds: count it as a confirmation
  select * into v_dup from match_reports r
  where r.match_id = p_match and r.status = 'pending' and r.kind = v_kind
    and r.created_at > now() - interval '90 seconds'
    and (r.side is null or v_side is null or r.side = v_side)
    and (r.shirt_number is null or p_shirt is null or r.shirt_number = p_shirt)
    and r.created_by is distinct from me
  order by r.created_at desc limit 1
  for update;
  if found then
    update match_reports set
      confirmations = least(99, confirmations + 1),
      side = coalesce(side, v_side),
      shirt_number = coalesce(shirt_number, p_shirt),
      player_id = coalesce(player_id, v_player),
      player_name = coalesce(player_name, v_name)
    where id = v_dup.id;
    insert into match_reports (match_id, team_id, kind, side, points, shirt_number, player_id, player_name, period, clock_seconds, minute, status, merged_into)
    values (p_match, m.team_id, v_kind, v_side, v_points, p_shirt, v_player, v_name, nullif(l.period, 0), v_clock, v_minute, 'merged', v_dup.id);
    return jsonb_build_object('applied', false, 'id', v_dup.id, 'merged', true);
  end if;
  insert into match_reports (match_id, team_id, kind, side, points, shirt_number, player_id, player_name, period, clock_seconds, minute)
  values (p_match, m.team_id, v_kind, v_side, v_points, p_shirt, v_player, v_name, nullif(l.period, 0), v_clock, v_minute)
  returning id into v_id;
  return jsonb_build_object('applied', false, 'id', v_id, 'merged', false);
end;
$$;

-- The old one-tap goal (PR #21 clients): same rules as submit_match_report.
create or replace function public.report_match_goal(p_match uuid, p_side text, p_shirt int default null, p_points int default 1)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return (submit_match_report(p_match, 'goal', p_side, p_shirt, p_points, null) ->> 'id')::uuid;
end;
$$;

-- Complete a pending report (its sender or the primary).
create or replace function public.update_match_report(p_report uuid, p_side text, p_shirt int, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r match_reports%rowtype;
  m team_matches%rowtype;
  l match_live%rowtype;
  v_side text := p_side;
  v_player uuid;
begin
  select * into r from match_reports where id = p_report and status = 'pending' for update;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  m := match_live_check(r.match_id);
  select * into l from match_live where match_id = r.match_id;
  if r.created_by is distinct from auth.uid() and l.reporter_id is distinct from auth.uid() and not match_staff(m.team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_side is not null and v_side not in ('home', 'away') then
    raise exception 'side must be home or away' using errcode = '22023';
  end if;
  if p_shirt is not null and (v_side is null or (v_side = 'home') = m.home) then
    v_player := match_scorer_by_number(m.team_id, p_shirt);
    if v_player is not null and v_side is null then
      v_side := case when m.home then 'home' else 'away' end;
    end if;
  end if;
  update match_reports set side = v_side, shirt_number = p_shirt, player_id = v_player,
    player_name = nullif(left(trim(coalesce(p_name, '')), 60), '')
  where id = p_report;
end;
$$;

-- The primary approves (optionally fixing the details) or rejects a report.
create or replace function public.review_match_report(
  p_report uuid, p_approve boolean, p_side text default null, p_shirt int default null, p_points int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  r match_reports%rowtype;
  m team_matches%rowtype;
  l match_live%rowtype;
  v_side text;
  v_shirt int;
  v_player uuid;
  v_id uuid;
begin
  select * into r from match_reports where id = p_report for update;
  if not found or r.status <> 'pending' then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  m := match_live_check(r.match_id);
  select * into l from match_live where match_id = r.match_id;
  if l.reporter_id is distinct from auth.uid() and not match_staff(m.team_id) then
    raise exception 'not the reporter' using errcode = '42501';
  end if;
  if not p_approve then
    update match_reports set status = 'rejected', resolved_by = auth.uid(), resolved_at = now() where id = p_report;
    update match_reports set status = 'rejected', resolved_by = auth.uid(), resolved_at = now() where merged_into = p_report;
    return null;
  end if;
  v_side := coalesce(p_side, r.side);
  v_shirt := coalesce(p_shirt, r.shirt_number);
  if v_side is null or v_side not in ('home', 'away') then
    raise exception 'choose the team' using errcode = '22023';
  end if;
  if v_shirt is not null and (v_side = 'home') = m.home then
    v_player := match_scorer_by_number(m.team_id, v_shirt);
  end if;
  insert into match_events (match_id, team_id, kind, side, points, shirt_number, player_id, player_name, minute, period, clock_seconds, created_by, created_at, approved_by)
  values (r.match_id, r.team_id, r.kind, v_side,
          case when r.kind = 'goal' then greatest(1, least(3, coalesce(p_points, r.points))) else 1 end,
          v_shirt, v_player, r.player_name, r.minute, r.period, r.clock_seconds, r.created_by, r.created_at, auth.uid())
  returning id into v_id;
  update match_reports set status = 'approved', event_id = v_id, resolved_by = auth.uid(), resolved_at = now() where id = p_report;
  update match_reports set status = 'approved', event_id = v_id, resolved_by = auth.uid(), resolved_at = now() where merged_into = p_report;
  return v_id;
end;
$$;

-- Who may change an event that already counts: the primary reporter, staff,
-- or anyone in the team while no one holds the role (as before). After the
-- final result: staff only.
create or replace function public.can_edit_match_event(p_match uuid, p_team uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  l match_live%rowtype;
begin
  select * into l from match_live where match_id = p_match;
  if l.finalized_at is not null then
    return match_staff(p_team);
  end if;
  if l.reporter_id is not null then
    return l.reporter_id = auth.uid() or match_staff(p_team);
  end if;
  return can_report_match(p_team);
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
  if not (can_edit_match_event(e.match_id, e.team_id) or (e.created_by = auth.uid() and e.shirt_number is null and can_report_match(e.team_id))) then
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
  e match_events%rowtype;
begin
  select * into e from match_events where id = p_event and deleted_at is null;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if not can_edit_match_event(e.match_id, e.team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update match_events set deleted_at = now(), deleted_by = auth.uid() where id = p_event;
end;
$$;

-- --------------------------------------------------------- feeds

drop function if exists public.match_events_feed(uuid);
create function public.match_events_feed(p_match uuid)
returns table (
  id uuid, kind text, side text, points int, shirt_number int, player_id uuid, scorer_name text,
  minute int, period int, clock_seconds int, created_at timestamptz, created_by uuid, reporter_name text
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
         e.minute::int, e.period::int, e.clock_seconds, e.created_at, e.created_by, nullif(pr.full_name, '')
  from match_events e
  left join players p on p.id = e.player_id
  left join profiles pr on pr.id = e.created_by
  where e.match_id = p_match and e.deleted_at is null
  order by coalesce(e.clock_seconds, 0), e.created_at;
end;
$$;

-- Pending reports, for the primary (and for everyone, to avoid double reports).
create or replace function public.match_reports_feed(p_match uuid)
returns table (
  id uuid, kind text, side text, points int, shirt_number int, player_id uuid, scorer_name text,
  minute int, confirmations int, created_at timestamptz, created_by uuid, reporter_name text
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
  select r.id, r.kind, r.side, r.points::int, r.shirt_number::int, r.player_id,
         coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), r.player_name),
         r.minute::int, r.confirmations::int, r.created_at, r.created_by, nullif(pr.full_name, '')
  from match_reports r
  left join players p on p.id = r.player_id
  left join profiles pr on pr.id = r.created_by
  where r.match_id = p_match and r.status = 'pending'
  order by r.created_at;
end;
$$;

-- ------------------------------------------------------------- RLS

alter table public.match_live enable row level security;
alter table public.match_reporter_queue enable row level security;
alter table public.match_reports enable row level security;

drop policy if exists match_live_select on public.match_live;
create policy match_live_select on public.match_live for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'matches', 1));
drop policy if exists match_reporter_queue_select on public.match_reporter_queue;
create policy match_reporter_queue_select on public.match_reporter_queue for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'matches', 1));
drop policy if exists match_reports_select on public.match_reports;
create policy match_reports_select on public.match_reports for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'matches', 1));

grant select on public.match_live, public.match_reporter_queue, public.match_reports to authenticated;

revoke all on function public.match_live_row(uuid), public.match_clock_seconds(public.match_live),
  public.match_live_advance(uuid), public.match_live_offer_next(uuid), public.match_person_label(uuid, uuid),
  public.match_staff(uuid), public.match_live_check(uuid), public.match_minute_now(public.team_matches, public.match_live),
  public.can_edit_match_event(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.match_live_state(uuid), public.claim_match_reporter(uuid, boolean),
  public.join_reporter_queue(uuid), public.leave_reporter_queue(uuid), public.release_match_reporter(uuid),
  public.answer_reporter_offer(uuid, boolean), public.match_clock(uuid, text), public.finalize_match_result(uuid, int, int),
  public.submit_match_report(uuid, text, text, int, int, text), public.report_match_goal(uuid, text, int, int),
  public.update_match_report(uuid, text, int, text), public.review_match_report(uuid, boolean, text, int, int),
  public.set_match_goal_scorer(uuid, int), public.remove_match_event(uuid),
  public.match_events_feed(uuid), public.match_reports_feed(uuid)
  from public, anon;
grant execute on function public.match_live_state(uuid), public.claim_match_reporter(uuid, boolean),
  public.join_reporter_queue(uuid), public.leave_reporter_queue(uuid), public.release_match_reporter(uuid),
  public.answer_reporter_offer(uuid, boolean), public.match_clock(uuid, text), public.finalize_match_result(uuid, int, int),
  public.submit_match_report(uuid, text, text, int, int, text), public.report_match_goal(uuid, text, int, int),
  public.update_match_report(uuid, text, int, text), public.review_match_report(uuid, boolean, text, int, int),
  public.set_match_goal_scorer(uuid, int), public.remove_match_event(uuid),
  public.match_events_feed(uuid), public.match_reports_feed(uuid)
  to authenticated;

-- ------------------------------------------------------------ realtime

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['match_live', 'match_reporter_queue', 'match_reports'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

do $$
begin
  raise notice 'iplays: live match (clock, primary reporter, queue, reports) installed';
end;
$$;

commit;
