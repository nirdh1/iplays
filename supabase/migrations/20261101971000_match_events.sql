-- iplays — live match reporting (goals / baskets as they happen).
--
-- Run after 20261101960000_parent_trainings.sql.
-- Rollback: supabase/rollback/20261101971000_match_events.down.sql
-- Additive only: one new table, four functions, RLS policies and the realtime
-- publication. No existing table or row changes.
--
-- Product decision (2026-11-01, project owner): during a game, any member of
-- the team (a parent too, not only staff) reports live. Each tap is one goal
-- for the home or the away team; the shirt number of the scorer can be added
-- (then or later) and the app finds the player in the team's roster.
-- Basketball reports 1, 2 or 3 points per tap.
--
-- * match_events: one row per goal / basket of a team_matches game, on the
--   side that scored ('home' / 'away' = the real home and away teams of the
--   game). For our side, shirt_number is resolved to player_id from the
--   team's current roster (player_assignments).
-- * The live score is the sum of the events. team_matches.score_for /
--   score_against stay the official result (staff, or the IFA sync), so
--   reporting never touches the official fields of an IFA league game.
-- * A report that was wrong is removed (soft: deleted_at / deleted_by), so the
--   history of who reported what stays.
-- * Members of the team (and club staff with matches >= view) read the events;
--   writes go through the functions below only. The table is in the realtime
--   publication, so the score updates live for every parent in the team.

begin;

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.team_matches (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  kind text not null default 'goal' check (kind in ('goal')),
  side text not null check (side in ('home', 'away')),
  points smallint not null default 1 check (points between 1 and 3),
  shirt_number smallint check (shirt_number between 0 and 99),
  player_id uuid references public.players (id) on delete set null,
  minute smallint check (minute between 1 and 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);
create index if not exists match_events_match_idx on public.match_events (match_id, created_at);
create index if not exists match_events_team_idx on public.match_events (team_id) where deleted_at is null;

-- Who may report on a game: members of the team and staff who can add matches.
create or replace function public.can_report_match(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_member(p_team) or can(p_team, 'matches', 2);
$$;

-- The current roster player with this shirt number, if any.
create or replace function public.match_scorer_by_number(p_team uuid, p_number int)
returns uuid language sql stable security definer set search_path = public as $$
  select a.player_id from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  where a.team_id = p_team and a.ended_on is null and a.shirt_number = p_number
  limit 1;
$$;

-- Report one goal (football) or basket (basketball: 1-3 points).
-- p_side: 'home' / 'away' (the game's home and away teams).
-- p_shirt: optional shirt number of the scorer; for our side it is matched to
-- the roster. Returns the new event id.
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

-- Add, change or clear (null) the scorer's shirt number of a reported goal.
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

-- Remove a wrong report (kept as deleted, with who removed it).
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

-- The game's live feed: reports with the scorer and the reporter's name.
create or replace function public.match_events_feed(p_match uuid)
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

-- ------------------------------------------------------------------- RLS

alter table public.match_events enable row level security;

drop policy if exists match_events_select on public.match_events;
create policy match_events_select on public.match_events for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'matches', 1));

grant select on public.match_events to authenticated;

revoke all on function public.can_report_match(uuid), public.match_scorer_by_number(uuid, int) from public, anon, authenticated;
revoke all on function public.report_match_goal(uuid, text, int, int), public.set_match_goal_scorer(uuid, int),
  public.remove_match_event(uuid), public.match_events_feed(uuid) from public, anon;
grant execute on function public.report_match_goal(uuid, text, int, int), public.set_match_goal_scorer(uuid, int),
  public.remove_match_event(uuid), public.match_events_feed(uuid) to authenticated;

-- ------------------------------------------------------------- realtime

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_events') then
    alter publication supabase_realtime add table public.match_events;
  end if;
end;
$$;

do $$
begin
  raise notice 'iplays: live match reporting installed';
end;
$$;

commit;
