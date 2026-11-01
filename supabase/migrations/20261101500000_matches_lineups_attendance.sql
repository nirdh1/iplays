-- iplays M4 — matches, lineups and attendance.
--
-- Run after 20261101400000_search_and_join_requests.sql.
-- Rollback: supabase/rollback/20261101500000_matches_lineups_attendance.down.sql
-- (the rollback keeps the tables and their data; running this file again
-- picks them up).
--
-- * team_matches: a team's games (opponent, home / away, time, place, score).
--   Members see them; staff with matches >= create add them, >= edit change
--   them. Matches are canceled, never deleted.
-- * match_lineups + match_lineup_players: any number of lineups per match
--   (e.g. two seven-a-side teams). Lineup size follows the sport profile:
--   football 7 by default (5-11 allowed), basketball 5, other sports none
--   (shared core only: matches, attendance, absences). Slot 1..size = on the field
--   (slot 1 = goalkeeper in football), no slot = bench. A player is in at most
--   one lineup per match. Parents see a lineup only after it is published.
-- * attendance_records: what staff marked for a training or a match.
--   Attendance is presumed: with no record and no absence report a player
--   counts as coming. event_attendance() merges the roster, the parents'
--   absence reports (by training, or by date range) and the marks.

begin;

-- ---------------------------------------------------------------- matches

create table if not exists public.team_matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  starts_at timestamptz not null,
  opponent text not null check (char_length(opponent) between 1 and 60),
  home boolean not null default true,
  venue text not null default '' check (char_length(venue) <= 80),
  competition text not null default 'league' check (competition in ('league', 'cup', 'friendly', 'tournament')),
  lineup_size smallint check (lineup_size between 3 and 11),
  status text not null default 'scheduled' check (status in ('scheduled', 'played', 'canceled')),
  score_for smallint check (score_for between 0 and 300),
  score_against smallint check (score_against between 0 and 300),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_matches_team_idx on public.team_matches (team_id, starts_at);

-- lineup size from the team's sport; the team never changes
create or replace function public.team_matches_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.team_id := old.team_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.lineup_size is null then
    -- sport profile: football 7, basketball 5, other sports have no lineup
    select case sport when 'basketball' then 5 when 'football' then 7 end into new.lineup_size from teams where id = new.team_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists team_matches_before on public.team_matches;
create trigger team_matches_before before insert or update on public.team_matches
  for each row execute function public.team_matches_before();

-- ---------------------------------------------------------------- lineups

create table if not exists public.match_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.team_matches (id) on delete restrict,
  label text not null default 'הרכב' check (char_length(label) between 1 and 30),
  sort smallint not null default 1,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists match_lineups_match_idx on public.match_lineups (match_id, sort);

create table if not exists public.match_lineup_players (
  lineup_id uuid not null references public.match_lineups (id) on delete cascade,
  match_id uuid not null references public.team_matches (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  slot smallint check (slot between 1 and 11),
  position text not null default '' check (char_length(position) <= 20),
  primary key (lineup_id, player_id)
);
create unique index if not exists match_lineup_players_match_idx on public.match_lineup_players (match_id, player_id);
create unique index if not exists match_lineup_players_slot_idx on public.match_lineup_players (lineup_id, slot) where slot is not null;

-- ------------------------------------------------------------- attendance

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  session_id uuid references public.training_sessions (id) on delete restrict,
  match_id uuid references public.team_matches (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  minutes_late smallint check (minutes_late between 1 and 180),
  note text not null default '' check (char_length(note) <= 200),
  marked_by uuid references auth.users (id) on delete set null default auth.uid(),
  marked_at timestamptz not null default now(),
  check (num_nonnulls(session_id, match_id) = 1),
  check (status = 'late' or minutes_late is null)
);
create unique index if not exists attendance_session_idx on public.attendance_records (session_id, player_id) where session_id is not null;
create unique index if not exists attendance_match_idx on public.attendance_records (match_id, player_id) where match_id is not null;
create index if not exists attendance_team_idx on public.attendance_records (team_id, marked_at);

-- --------------------------------------------------------------- helpers

-- The team and local date of a training ('training') or a match ('match').
create or replace function public.event_team_and_date(p_kind text, p_event uuid, out team_id uuid, out on_date date, out canceled boolean)
language sql stable security definer set search_path = public as $$
  select s.team_id, (s.starts_at at time zone 'Asia/Jerusalem')::date, s.canceled
  from training_sessions s where p_kind = 'training' and s.id = p_event
  union all
  select m.team_id, (m.starts_at at time zone 'Asia/Jerusalem')::date, m.status = 'canceled'
  from team_matches m where p_kind = 'match' and m.id = p_event;
$$;

-- --------------------------------------------------------------- lineups RPCs

create or replace function public.add_lineup(p_match uuid, p_label text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_n int;
  v_id uuid;
begin
  select team_id into v_team from team_matches where id = p_match;
  if v_team is null then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if (select lineup_size from team_matches where id = p_match) is null then
    raise exception 'this sport has no lineups' using errcode = '22023';
  end if;
  if not can(v_team, 'matches', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select count(*) into v_n from match_lineups where match_id = p_match;
  if v_n >= 6 then
    raise exception 'too many lineups' using errcode = '22023';
  end if;
  insert into match_lineups (match_id, label, sort)
  values (p_match, coalesce(nullif(trim(p_label), ''), 'הרכב ' || (array['א','ב','ג','ד','ה','ו'])[v_n + 1]), v_n + 1)
  returning id into v_id;
  return v_id;
end;
$$;

-- Replace the players of one lineup: [{"player_id": "...", "slot": 1, "position": "שוער"}, ...]
create or replace function public.save_lineup(p_lineup uuid, p_players jsonb, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_match uuid;
  v_team uuid;
  v_size int;
  r jsonb;
begin
  select l.match_id, m.team_id, m.lineup_size into v_match, v_team, v_size
  from match_lineups l join team_matches m on m.id = l.match_id where l.id = p_lineup;
  if v_match is null then
    raise exception 'lineup not found' using errcode = 'P0002';
  end if;
  if not can(v_team, 'matches', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_label is not null and trim(p_label) <> '' then
    update match_lineups set label = left(trim(p_label), 30) where id = p_lineup;
  end if;
  delete from match_lineup_players where lineup_id = p_lineup;
  for r in select * from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) loop
    if not exists (select 1 from player_assignments a where a.player_id = (r ->> 'player_id')::uuid
                   and a.team_id = v_team and a.ended_on is null) then
      raise exception 'player not in this team' using errcode = '22023';
    end if;
    if (r ->> 'slot') is not null and (r ->> 'slot')::int > v_size then
      raise exception 'slot outside the lineup size' using errcode = '22023';
    end if;
    insert into match_lineup_players (lineup_id, match_id, player_id, slot, position)
    values (p_lineup, v_match, (r ->> 'player_id')::uuid, (r ->> 'slot')::smallint, left(coalesce(r ->> 'position', ''), 20));
  end loop;
end;
$$;

create or replace function public.publish_lineup(p_lineup uuid, p_publish boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select m.team_id into v_team from match_lineups l join team_matches m on m.id = l.match_id where l.id = p_lineup;
  if v_team is null then
    raise exception 'lineup not found' using errcode = 'P0002';
  end if;
  if not can(v_team, 'matches', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update match_lineups set published_at = case when p_publish then now() end where id = p_lineup;
end;
$$;

-- An unpublished lineup can be removed (its players go back to the pool).
create or replace function public.remove_lineup(p_lineup uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_published timestamptz;
begin
  select m.team_id, l.published_at into v_team, v_published
  from match_lineups l join team_matches m on m.id = l.match_id where l.id = p_lineup;
  if v_team is null then
    raise exception 'lineup not found' using errcode = 'P0002';
  end if;
  if not can(v_team, 'matches', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_published is not null then
    raise exception 'unpublish the lineup first' using errcode = '22023';
  end if;
  delete from match_lineups where id = p_lineup;
end;
$$;

-- ------------------------------------------------------------ attendance RPCs

-- Mark one player for a training or a match. p_status null = back to the
-- default (presumed coming / the parent's report).
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

-- The roster of a training / match with the expected and marked attendance.
-- expected: 'coming' (default), 'absent' or 'late' (from a parent's report).
-- status: what staff marked, or null. effective: status, else expected.
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

-- Per-player attendance between two dates (past, not canceled events).
-- A player with no mark counts as present unless a parent reported absence.
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
    where s.team_id = p_team and not s.canceled and s.starts_at < now()
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

-- ------------------------------------------------------------------- RLS

alter table public.team_matches enable row level security;
alter table public.match_lineups enable row level security;
alter table public.match_lineup_players enable row level security;
alter table public.attendance_records enable row level security;

drop policy if exists matches_select on public.team_matches;
create policy matches_select on public.team_matches for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'matches', 1));
drop policy if exists matches_insert on public.team_matches;
create policy matches_insert on public.team_matches for insert to authenticated
  with check (can(team_id, 'matches', 2));
drop policy if exists matches_update on public.team_matches;
create policy matches_update on public.team_matches for update to authenticated
  using (can(team_id, 'matches', 3)) with check (can(team_id, 'matches', 3));

drop policy if exists lineups_select on public.match_lineups;
create policy lineups_select on public.match_lineups for select to authenticated
  using (exists (select 1 from team_matches m where m.id = match_id
                 and (can(m.team_id, 'matches', 1) or (published_at is not null and is_team_member(m.team_id)))));

drop policy if exists lineup_players_select on public.match_lineup_players;
create policy lineup_players_select on public.match_lineup_players for select to authenticated
  using (exists (select 1 from match_lineups l join team_matches m on m.id = l.match_id where l.id = lineup_id
                 and (can(m.team_id, 'matches', 1) or (l.published_at is not null and is_team_member(m.team_id)))));

-- marks: attendance viewers, and the child's guardians for their own child
drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records for select to authenticated
  using (can(team_id, 'attendance', 1) or exists (select 1 from player_guardians g where g.player_id = attendance_records.player_id and g.user_id = auth.uid()));

grant select, insert, update on public.team_matches to authenticated;
grant select on public.match_lineups, public.match_lineup_players, public.attendance_records to authenticated;

revoke all on function public.team_matches_before, public.event_team_and_date from public, anon, authenticated;
revoke all on function public.add_lineup, public.save_lineup, public.publish_lineup, public.remove_lineup,
  public.mark_attendance, public.event_attendance, public.team_attendance_summary from public, anon;
grant execute on function public.add_lineup, public.save_lineup, public.publish_lineup, public.remove_lineup,
  public.mark_attendance, public.event_attendance, public.team_attendance_summary to authenticated;

do $$
begin
  raise notice 'iplays M4: matches, lineups and attendance installed';
end;
$$;

commit;
