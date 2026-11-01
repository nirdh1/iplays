-- iplays — parent carpools (shared rides) for trainings and matches.
--
-- Run after 20261101960000_parent_trainings.sql.
-- Rollback: supabase/rollback/20261101970000_rides.down.sql
-- Additive only: three new tables and their functions. Nothing existing changes.
--
-- Part of the shared core: every sport, every team.
--  * A team member offers a ride to a training or a match (including IFA
--    league games mirrored into team_matches): direction, seats, meeting
--    point and time.
--  * A parent seats their own child in a ride with a free seat, or marks that
--    the child needs a ride. The mark is cleared when the child gets a seat.
--  * Only members of the team see the rides. Children appear by first name only.
--  * The driver (or team staff) can cancel; the seated children then go back
--    to "needs a ride" so nobody is left without one silently.
-- All writes go through the functions below; the tables are read-only to clients.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  session_id uuid references public.training_sessions (id) on delete cascade,
  match_id uuid references public.team_matches (id) on delete cascade,
  driver_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  direction text not null default 'both' check (direction in ('to', 'from', 'both')),
  seats smallint not null check (seats between 1 and 8),
  leaves_at time,
  meet_point text not null default '' check (char_length(meet_point) <= 80),
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(session_id, match_id) = 1)
);
create unique index if not exists rides_driver_session_idx on public.rides (driver_id, session_id) where session_id is not null;
create unique index if not exists rides_driver_match_idx on public.rides (driver_id, match_id) where match_id is not null;
create index if not exists rides_session_idx on public.rides (session_id) where session_id is not null;
create index if not exists rides_match_idx on public.rides (match_id) where match_id is not null;
create index if not exists rides_team_idx on public.rides (team_id);

create table if not exists public.ride_passengers (
  ride_id uuid not null references public.rides (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (ride_id, player_id)
);
create index if not exists ride_passengers_player_idx on public.ride_passengers (player_id);

create table if not exists public.ride_needs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  session_id uuid references public.training_sessions (id) on delete cascade,
  match_id uuid references public.team_matches (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  direction text not null default 'both' check (direction in ('to', 'from', 'both')),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(session_id, match_id) = 1)
);
create unique index if not exists ride_needs_session_idx on public.ride_needs (player_id, session_id) where session_id is not null;
create unique index if not exists ride_needs_match_idx on public.ride_needs (player_id, match_id) where match_id is not null;
create index if not exists ride_needs_team_idx on public.ride_needs (team_id);

-- --------------------------------------------------------------- RLS (read only)

alter table public.rides enable row level security;
alter table public.ride_passengers enable row level security;
alter table public.ride_needs enable row level security;

drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select to authenticated using (is_team_member(team_id));

drop policy if exists ride_passengers_select on public.ride_passengers;
create policy ride_passengers_select on public.ride_passengers for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id and is_team_member(r.team_id)));

drop policy if exists ride_needs_select on public.ride_needs;
create policy ride_needs_select on public.ride_needs for select to authenticated using (is_team_member(team_id));

revoke all on public.rides, public.ride_passengers, public.ride_needs from anon, authenticated;
grant select on public.rides, public.ride_passengers, public.ride_needs to authenticated;

-- --------------------------------------------------------------- helpers

-- The team of a training / match the caller belongs to; raises otherwise.
create or replace function public.ride_event_team(p_kind text, p_event uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if p_kind not in ('training', 'match') then
    raise exception 'unknown event kind' using errcode = '22023';
  end if;
  select e.team_id into v_team from event_team_and_date(p_kind, p_event) e;
  if v_team is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if not is_team_member(v_team) then
    raise exception 'only team members can see rides' using errcode = '42501';
  end if;
  return v_team;
end;
$$;

-- Do two directions share a leg? ('to' and 'from' don't; anything with 'both' does.)
create or replace function public.ride_dirs_overlap(a text, b text)
returns boolean language sql immutable as $$
  select a = b or a = 'both' or b = 'both';
$$;

-- Is the child currently on this team's roster?
create or replace function public.ride_player_on_team(p_player uuid, p_team uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  begin
    return exists (select 1 from player_assignments a where a.player_id = p_player and a.team_id = p_team and a.ended_on is null)
        or exists (select 1 from players p where p.id = p_player and p.team_id = p_team);
  exception when undefined_table then
    return exists (select 1 from players p where p.id = p_player and p.team_id = p_team);
  end;
end;
$$;

-- What is left of a need after the child got a seat in a ride going `ride_dir`.
create or replace function public.ride_need_after(need_dir text, ride_dir text)
returns text language sql immutable as $$
  select case
    when ride_dir = 'both' or need_dir = ride_dir then null
    when need_dir = 'both' and ride_dir = 'to' then 'from'
    when need_dir = 'both' and ride_dir = 'from' then 'to'
    else need_dir
  end;
$$;

-- --------------------------------------------------------------- RPCs

-- Offer a ride, or update my offer for this event (one offer per driver per event).
create or replace function public.offer_ride(
  p_kind text, p_event uuid, p_direction text, p_seats int,
  p_leaves_at time default null, p_meet_point text default '', p_note text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := ride_event_team(p_kind, p_event);
  v_session uuid := case when p_kind = 'training' then p_event end;
  v_match uuid := case when p_kind = 'match' then p_event end;
  v_id uuid;
  v_taken int;
begin
  select id into v_id from rides
  where driver_id = auth.uid() and session_id is not distinct from v_session and match_id is not distinct from v_match
  for update;

  if v_id is null then
    insert into rides (team_id, session_id, match_id, driver_id, direction, seats, leaves_at, meet_point, note)
    values (v_team, v_session, v_match, auth.uid(), p_direction, p_seats, p_leaves_at,
            coalesce(trim(p_meet_point), ''), coalesce(trim(p_note), ''))
    returning id into v_id;
  else
    select count(*) into v_taken from ride_passengers where ride_id = v_id;
    if p_seats < v_taken then
      raise exception 'more children are already seated than seats' using errcode = '23514';
    end if;
    update rides set direction = p_direction, seats = p_seats, leaves_at = p_leaves_at,
      meet_point = coalesce(trim(p_meet_point), ''), note = coalesce(trim(p_note), ''), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

-- The driver (or team staff) cancels a ride. Seated children go back to "needs a ride".
create or replace function public.cancel_ride(p_ride uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rides%rowtype;
  p record;
begin
  select * into r from rides where id = p_ride for update;
  if not found then
    raise exception 'ride not found' using errcode = 'P0002';
  end if;
  if r.driver_id <> auth.uid() and not is_team_staff(r.team_id) then
    raise exception 'only the driver can cancel this ride' using errcode = '42501';
  end if;

  -- The driver's own children are the driver's business; everyone else
  -- goes back to "needs a ride" (merged with any leg they still need).
  for p in
    select x.player_id, x.added_by from ride_passengers x
    where x.ride_id = r.id
      and not exists (select 1 from player_guardians g where g.player_id = x.player_id and g.user_id = r.driver_id)
  loop
    update ride_needs set direction = case when direction = r.direction then direction else 'both' end
    where player_id = p.player_id and session_id is not distinct from r.session_id and match_id is not distinct from r.match_id;
    if not found then
      insert into ride_needs (team_id, session_id, match_id, player_id, direction, created_by)
      values (r.team_id, r.session_id, r.match_id, p.player_id, r.direction, p.added_by);
    end if;
  end loop;

  delete from rides where id = r.id;
end;
$$;

-- A parent seats their own child in a ride with a free seat.
create or replace function public.join_ride(p_ride uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rides%rowtype;
  v_taken int;
  v_need ride_needs%rowtype;
  v_left text;
begin
  select * into r from rides where id = p_ride for update;
  if not found or not is_team_member(r.team_id) then
    raise exception 'ride not found' using errcode = 'P0002';
  end if;
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can seat them' using errcode = '42501';
  end if;
  if not ride_player_on_team(p_player, r.team_id) then
    raise exception 'child is not in this team' using errcode = '42501';
  end if;
  if exists (select 1 from ride_passengers where ride_id = r.id and player_id = p_player) then
    return;
  end if;
  if exists (
    select 1 from ride_passengers p join rides o on o.id = p.ride_id
    where p.player_id = p_player and o.id <> r.id
      and o.session_id is not distinct from r.session_id and o.match_id is not distinct from r.match_id
      and ride_dirs_overlap(o.direction, r.direction)
  ) then
    raise exception 'child already has a ride for this event' using errcode = '23505';
  end if;
  select count(*) into v_taken from ride_passengers where ride_id = r.id;
  if v_taken >= r.seats then
    raise exception 'ride is full' using errcode = '23514';
  end if;

  insert into ride_passengers (ride_id, player_id) values (r.id, p_player);

  select * into v_need from ride_needs
  where player_id = p_player and session_id is not distinct from r.session_id and match_id is not distinct from r.match_id;
  if found then
    v_left := ride_need_after(v_need.direction, r.direction);
    if v_left is null then
      delete from ride_needs where id = v_need.id;
    else
      update ride_needs set direction = v_left where id = v_need.id;
    end if;
  end if;
end;
$$;

-- The child's parent, the driver or team staff take a child out of a ride.
create or replace function public.leave_ride(p_ride uuid, p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r rides%rowtype;
begin
  select * into r from rides where id = p_ride;
  if not found then
    raise exception 'ride not found' using errcode = 'P0002';
  end if;
  if not (is_player_parent(p_player) or r.driver_id = auth.uid() or is_team_staff(r.team_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from ride_passengers where ride_id = r.id and player_id = p_player;
end;
$$;

-- A parent marks (direction) or clears (null) that their child needs a ride.
create or replace function public.set_ride_need(p_kind text, p_event uuid, p_player uuid, p_direction text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid := ride_event_team(p_kind, p_event);
  v_session uuid := case when p_kind = 'training' then p_event end;
  v_match uuid := case when p_kind = 'match' then p_event end;
begin
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can ask for a ride' using errcode = '42501';
  end if;
  if not ride_player_on_team(p_player, v_team) then
    raise exception 'child is not in this team' using errcode = '42501';
  end if;
  delete from ride_needs
  where player_id = p_player and session_id is not distinct from v_session and match_id is not distinct from v_match;
  if p_direction is not null then
    insert into ride_needs (team_id, session_id, match_id, player_id, direction, note)
    values (v_team, v_session, v_match, p_player, p_direction, coalesce(trim(p_note), ''));
  end if;
end;
$$;

-- Everything about the rides of one event, for its members.
-- Children by first name only; the driver's name and phone (shared within the team).
create or replace function public.event_rides(p_kind text, p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid := ride_event_team(p_kind, p_event);
  v_session uuid := case when p_kind = 'training' then p_event end;
  v_match uuid := case when p_kind = 'match' then p_event end;
begin
  return jsonb_build_object(
    'rides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'driver_id', r.driver_id,
        'driver_name', coalesce(nullif(pr.full_name, ''), 'הורה בקבוצה'),
        'driver_phone', pr.phone,
        'direction', r.direction,
        'seats', r.seats,
        'leaves_at', to_char(r.leaves_at, 'HH24:MI'),
        'meet_point', r.meet_point,
        'note', r.note,
        'passengers', coalesce((
          select jsonb_agg(jsonb_build_object('player_id', p.player_id, 'first_name', pl.first_name, 'added_by', p.added_by) order by p.created_at)
          from ride_passengers p join players pl on pl.id = p.player_id
          where p.ride_id = r.id
        ), '[]'::jsonb)
      ) order by r.created_at)
      from rides r left join profiles pr on pr.id = r.driver_id
      where r.team_id = v_team and r.session_id is not distinct from v_session and r.match_id is not distinct from v_match
    ), '[]'::jsonb),
    'needs', coalesce((
      select jsonb_agg(jsonb_build_object('player_id', n.player_id, 'first_name', pl.first_name, 'direction', n.direction, 'note', n.note) order by n.created_at)
      from ride_needs n join players pl on pl.id = n.player_id
      where n.team_id = v_team and n.session_id is not distinct from v_session and n.match_id is not distinct from v_match
    ), '[]'::jsonb)
  );
end;
$$;

-- Short summary per upcoming event of my teams, for the event cards.
create or replace function public.rides_summary(p_team uuid)
returns table (kind text, event_id uuid, drivers int, free_seats int, needs int)
language sql stable security definer set search_path = public as $$
  with r as (
    select case when session_id is not null then 'training' else 'match' end as kind,
           coalesce(session_id, match_id) as event_id,
           count(*)::int as drivers,
           sum(seats - (select count(*) from ride_passengers p where p.ride_id = rides.id))::int as free_seats
    from rides
    where team_id = p_team and is_team_member(p_team)
    group by 1, 2
  ),
  n as (
    select case when session_id is not null then 'training' else 'match' end as kind,
           coalesce(session_id, match_id) as event_id,
           count(*)::int as needs
    from ride_needs
    where team_id = p_team and is_team_member(p_team)
    group by 1, 2
  )
  select coalesce(r.kind, n.kind), coalesce(r.event_id, n.event_id),
         coalesce(r.drivers, 0), coalesce(r.free_seats, 0), coalesce(n.needs, 0)
  from r full join n on n.kind = r.kind and n.event_id = r.event_id;
$$;

revoke all on function public.ride_event_team, public.ride_dirs_overlap, public.ride_player_on_team, public.ride_need_after,
  public.offer_ride, public.cancel_ride, public.join_ride, public.leave_ride, public.set_ride_need,
  public.event_rides, public.rides_summary
from public, anon;
grant execute on function public.offer_ride, public.cancel_ride, public.join_ride, public.leave_ride, public.set_ride_need,
  public.event_rides, public.rides_summary
to authenticated;

commit;
