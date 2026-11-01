-- iplays — M1 + M2: clubs, programs (league / academy), player assignments
-- and transfers between programs.
--
-- Run after 20261031000000_init.sql and 20261101100000_coach.sql.
-- Rollback: supabase/rollback/20261101200000_clubs_and_assignments.down.sql
--
-- Principles
--   * Additive only. No table, column or row is deleted. Existing columns that
--     are superseded (players.team_id, players.shirt_number) stay and are kept
--     in sync, so the current app keeps working.
--   * One club holds programs (league / academy); a team belongs to at most one
--     program. Teams without a club keep working as before (parents can use
--     iplays without their club being on it).
--   * A player is ONE profile for the whole career. Team membership lives in
--     player_assignments, with history. Moving between programs closes one
--     assignment and opens another; nothing is copied or deleted.
--   * Teams and players can no longer be deleted from the app (they are
--     archived instead), so a delete can never cascade into history.
--
-- The whole file runs in one transaction: if any statement fails, nothing changes.

begin;

-- ======================================================== M1: clubs, programs

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  city text not null default '' check (char_length(city) <= 60),
  -- draft: anyone can open one; verified: confirmed by the platform team.
  status text not null default 'draft'
    check (status in ('draft', 'pending_verification', 'verified', 'suspended')),
  ifa_club_name text not null default '' check (char_length(ifa_club_name) <= 120),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
-- Only one verified club per name (prevents duplicate claims of a real club).
create unique index clubs_verified_name_idx on public.clubs (lower(trim(name))) where status = 'verified';

create table public.club_programs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  kind text not null check (kind in ('league', 'academy')),
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (club_id, name)
);
create index club_programs_club_idx on public.club_programs (club_id);

create table public.club_staff (
  club_id uuid not null references public.clubs (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- owner / admin manage the whole club; staff get access through grants (M3).
  role text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_staff_user_idx on public.club_staff (user_id);

create table public.club_claims (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index club_claims_pending_idx on public.club_claims (club_id, user_id) where status = 'pending';

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  club_id uuid,
  entity text not null default '',
  entity_id uuid,
  details jsonb not null default '{}'::jsonb
);
create index audit_log_club_idx on public.audit_log (club_id, at desc);

alter table public.teams
  add column club_id uuid references public.clubs (id) on delete restrict,
  add column program_id uuid references public.club_programs (id) on delete restrict,
  add column age_group text not null default '' check (char_length(age_group) <= 40),
  add column birth_year_from int check (birth_year_from between 2000 and 2030),
  add column birth_year_to int check (birth_year_to between 2000 and 2030),
  add column archived_at timestamptz;
create index teams_club_idx on public.teams (club_id);
create index teams_program_idx on public.teams (program_id);

alter table public.players add column archived_at timestamptz;

-- --------------------------------------------------------------- helpers

create function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- owner / admin of the club
create function public.is_club_admin(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_staff where club_id = p_club and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

-- any club staff, or a member (parent / coach) of one of the club's teams
create function public.is_club_member(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_staff where club_id = p_club and user_id = auth.uid())
      or exists (
        select 1 from teams t join team_members m on m.team_id = t.id
        where t.club_id = p_club and m.user_id = auth.uid()
      );
$$;

create function public.is_team_admin(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and role = 'admin');
$$;

-- Trusted context = SQL editor / service role: no signed-in app user. Signed-in
-- users always have auth.uid(); anon has no write grants on these tables.
create function public.is_trusted_context()
returns boolean language sql stable as $$
  select auth.uid() is null;
$$;

create function public.write_audit(p_action text, p_club uuid, p_entity text, p_entity_id uuid, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, action, club_id, entity, entity_id, details)
  values (auth.uid(), p_action, p_club, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- A team's club / program can only be changed by someone who is both an admin
-- of the team and an admin of the target club (or a platform admin). This
-- runs on every update, so a direct table update can't bypass it.
create function public.teams_guard_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.program_id is not null then
    select club_id into new.club_id from club_programs where id = new.program_id;
  end if;
  if new.club_id is not distinct from old.club_id and new.program_id is not distinct from old.program_id then
    return new;
  end if;
  if is_trusted_context() or is_platform_admin() then
    return new;
  end if;
  if not is_team_admin(new.id) then
    raise exception 'only the team admin can move the team between clubs' using errcode = '42501';
  end if;
  if new.club_id is not null and not is_club_admin(new.club_id) then
    raise exception 'only a club admin can add teams to the club' using errcode = '42501';
  end if;
  if old.club_id is not null and new.club_id is distinct from old.club_id and not is_club_admin(old.club_id) then
    raise exception 'only a club admin can remove teams from the club' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger teams_guard_club
  before update of club_id, program_id on public.teams
  for each row execute function public.teams_guard_club();

-- ------------------------------------------------------------------ RPCs

-- Open a new club (draft). The caller becomes its owner. Two programs are
-- created: league and academy.
create function public.create_club(p_name text, p_city text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into clubs (name, city, created_by) values (trim(p_name), trim(coalesce(p_city, '')), auth.uid())
  returning id into v_club;
  insert into club_staff (club_id, user_id, role, added_by) values (v_club, auth.uid(), 'owner', auth.uid());
  insert into club_programs (club_id, kind, name) values (v_club, 'league', 'ליגה'), (v_club, 'academy', 'אקדמיה');
  perform write_audit('club.create', v_club, 'club', v_club, jsonb_build_object('name', trim(p_name)));
  return v_club;
end;
$$;

create function public.add_program(p_club uuid, p_kind text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not (is_club_admin(p_club) or is_platform_admin()) then
    raise exception 'only a club admin can add programs' using errcode = '42501';
  end if;
  insert into club_programs (club_id, kind, name) values (p_club, p_kind, trim(p_name)) returning id into v_id;
  perform write_audit('program.create', p_club, 'program', v_id, jsonb_build_object('kind', p_kind, 'name', trim(p_name)));
  return v_id;
end;
$$;

create function public.update_club(p_club uuid, p_name text, p_city text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (is_club_admin(p_club) or is_platform_admin()) then
    raise exception 'only a club admin can edit the club' using errcode = '42501';
  end if;
  update clubs set name = trim(p_name), city = trim(coalesce(p_city, '')) where id = p_club;
  perform write_audit('club.update', p_club, 'club', p_club, jsonb_build_object('name', trim(p_name)));
end;
$$;

-- Put a team into a program (or take it out with p_program = null).
create function public.set_team_program(p_team uuid, p_program uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old uuid;
  v_club uuid;
begin
  select club_id into v_old from teams where id = p_team;
  select club_id into v_club from club_programs where id = p_program;
  -- authorization is enforced by the teams_guard_club trigger
  update teams set program_id = p_program, club_id = v_club where id = p_team;
  perform write_audit('team.set_program', coalesce(v_club, v_old), 'team', p_team,
                      jsonb_build_object('program_id', p_program, 'from_club', v_old));
end;
$$;

-- The owner asks the platform to verify the club.
create function public.request_club_verification(p_club uuid, p_message text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin(p_club) then
    raise exception 'only a club admin can request verification' using errcode = '42501';
  end if;
  insert into club_claims (club_id, user_id, message) values (p_club, auth.uid(), coalesce(p_message, ''))
  on conflict do nothing;
  update clubs set status = 'pending_verification' where id = p_club and status = 'draft';
  perform write_audit('club.request_verification', p_club, 'club', p_club);
end;
$$;

-- Platform admin only.
create function public.set_club_status(p_club uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
  update clubs set status = p_status where id = p_club;
  update club_claims set status = case when p_status = 'verified' then 'approved' else 'rejected' end,
                         reviewed_by = auth.uid(), reviewed_at = now()
  where club_id = p_club and status = 'pending' and p_status in ('verified', 'suspended');
  perform write_audit('club.set_status', p_club, 'club', p_club, jsonb_build_object('status', p_status));
end;
$$;

-- Archive instead of delete. Team admin or club admin.
create function public.archive_team(p_team uuid, p_archived boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
begin
  select club_id into v_club from teams where id = p_team;
  if not (is_team_admin(p_team) or (v_club is not null and is_club_admin(v_club)) or is_platform_admin()) then
    raise exception 'only the team admin or a club admin can archive a team' using errcode = '42501';
  end if;
  update teams set archived_at = case when p_archived then now() end where id = p_team;
  perform write_audit(case when p_archived then 'team.archive' else 'team.unarchive' end, v_club, 'team', p_team);
end;
$$;

-- ======================================================== M2: assignments

alter table public.players alter column team_id drop not null;
-- deleting a team must never delete its players
alter table public.players drop constraint players_team_id_fkey;
alter table public.players
  add constraint players_team_id_fkey foreign key (team_id) references public.teams (id) on delete restrict;

create table public.player_assignments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  shirt_number int check (shirt_number between 0 and 99),
  -- the player's main team (shown first; mirrored into players.team_id)
  is_primary boolean not null default true,
  started_on date not null default current_date,
  ended_on date,
  end_reason text not null default '' check (char_length(end_reason) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);
create unique index player_assignments_active_idx on public.player_assignments (player_id, team_id) where ended_on is null;
create unique index player_assignments_primary_idx on public.player_assignments (player_id) where is_primary and ended_on is null;
create unique index player_assignments_shirt_idx on public.player_assignments (team_id, shirt_number)
  where ended_on is null and shirt_number is not null;
create index player_assignments_team_idx on public.player_assignments (team_id) where ended_on is null;

create table public.player_transfers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  -- move: leave one team for another; add: join another team in parallel;
  -- end: leave a team without joining another
  kind text not null check (kind in ('move', 'add', 'end')),
  from_team_id uuid references public.teams (id) on delete restrict,
  to_team_id uuid references public.teams (id) on delete restrict,
  from_assignment_id uuid references public.player_assignments (id) on delete restrict,
  to_assignment_id uuid references public.player_assignments (id) on delete restrict,
  reason text not null default '' check (char_length(reason) <= 300),
  effective_on date not null default current_date,
  performed_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index player_transfers_player_idx on public.player_transfers (player_id, created_at desc);
create index player_transfers_to_idx on public.player_transfers (to_team_id);
create index player_transfers_from_idx on public.player_transfers (from_team_id);

-- Backfill: every existing player gets one active, primary assignment in
-- their current team (same shirt number, started on the day they were added).
insert into public.player_assignments (player_id, team_id, shirt_number, is_primary, started_on, created_by, created_at)
select p.id, p.team_id, p.shirt_number, true, p.created_at::date, p.created_by, p.created_at
from public.players p
where p.team_id is not null;

-- --------------------------------------------------------------- helpers

create function public.player_team_ids(p_player uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from player_assignments where player_id = p_player and ended_on is null;
$$;

-- Who may see a player's profile:
--   guardians; every member of a team the player is in now; staff of a team
--   the player was in before (to keep that team's history readable); admins
--   of a club the player is or was in.
create function public.can_view_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid())
      or exists (
        select 1 from player_assignments a join team_members m on m.team_id = a.team_id
        where a.player_id = p_player and m.user_id = auth.uid()
          and (a.ended_on is null or m.role in ('admin', 'coach'))
      )
      or exists (
        select 1 from player_assignments a join teams t on t.id = a.team_id
        join club_staff s on s.club_id = t.club_id
        where a.player_id = p_player and s.user_id = auth.uid() and s.role in ('owner', 'admin')
      )
      -- legacy: a player row without assignments (should not exist after backfill)
      or exists (select 1 from players p where p.id = p_player and p.team_id is not null and is_team_member(p.team_id)
                 and not exists (select 1 from player_assignments a where a.player_id = p.id));
$$;

-- staff (admin / coach) of any team the player is in now
create function public.is_player_staff(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from player_assignments a join team_members m on m.team_id = a.team_id
    where a.player_id = p_player and a.ended_on is null and m.user_id = auth.uid() and m.role in ('admin', 'coach')
  );
$$;

-- Mirror the primary active assignment into players.team_id / shirt_number,
-- so code that still reads those columns keeps working.
create function public.sync_player_primary(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_shirt int;
begin
  select team_id, shirt_number into v_team, v_shirt
  from player_assignments
  where player_id = p_player and ended_on is null
  order by is_primary desc, started_on, created_at
  limit 1;
  if v_team is null then
    return; -- no active team: keep the last one for reference
  end if;
  -- players has unique (team_id, shirt_number); don't collide with a legacy row
  if v_shirt is not null and exists (
    select 1 from players where team_id = v_team and shirt_number = v_shirt and id <> p_player
  ) then
    v_shirt := null;
  end if;
  update players set team_id = v_team, shirt_number = v_shirt
  where id = p_player and (team_id is distinct from v_team or shirt_number is distinct from v_shirt);
end;
$$;

create function public.player_assignments_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sync_player_primary(coalesce(new.player_id, old.player_id));
  return null;
end;
$$;

create trigger player_assignments_sync
  after insert or update of is_primary, ended_on, team_id on public.player_assignments
  for each row execute function public.player_assignments_after();

-- A player added the old way (insert into players with team_id) gets an assignment.
create function public.players_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null then
    insert into player_assignments (player_id, team_id, shirt_number, is_primary, created_by)
    values (new.id, new.team_id, new.shirt_number, true, new.created_by)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger players_create_assignment
  after insert on public.players
  for each row execute function public.players_after_insert();

-- players.team_id is now derived. Changing it directly is not allowed (use
-- transfer_player). A shirt number edited the old way updates the primary assignment.
create function public.players_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 and new.team_id is distinct from old.team_id and not is_trusted_context() then
    raise exception 'use transfer_player to change a player''s team' using errcode = '42501';
  end if;
  if pg_trigger_depth() = 1 and new.shirt_number is distinct from old.shirt_number then
    update player_assignments set shirt_number = new.shirt_number
    where player_id = new.id and team_id = new.team_id and ended_on is null;
  end if;
  return new;
end;
$$;

create trigger players_guard_team
  before update on public.players
  for each row execute function public.players_before_update();

-- ------------------------------------------------------------------ RPCs

-- Who can move players: an admin of the club that owns the target team (and,
-- for a move, of the club that owns the source team), or a platform admin.
-- Teams without a club: the team admin of both teams.
create function public.can_manage_team_roster(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from teams t where t.id = p_team and t.club_id is not null and is_club_admin(t.club_id))
      or exists (select 1 from teams t where t.id = p_team and t.club_id is null and is_team_admin(t.id));
$$;

-- Move a player to another team (p_mode = 'move'), or add them to another
-- team in parallel (p_mode = 'add', e.g. academy + league). History is kept.
create function public.transfer_player(
  p_player uuid,
  p_to_team uuid,
  p_mode text default 'move',
  p_from_team uuid default null,
  p_reason text default '',
  p_shirt int default null,
  p_effective date default current_date
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from player_assignments%rowtype;
  v_to uuid;
  v_club uuid;
  v_transfer uuid;
  v_has_primary boolean;
begin
  if p_mode not in ('move', 'add') then
    raise exception 'mode must be move or add' using errcode = '22023';
  end if;
  if not exists (select 1 from players where id = p_player) then
    raise exception 'player not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from teams where id = p_to_team and archived_at is not null) then
    raise exception 'target team is archived' using errcode = '22023';
  end if;
  if not can_manage_team_roster(p_to_team) then
    raise exception 'not allowed to add players to this team' using errcode = '42501';
  end if;
  if exists (select 1 from player_assignments where player_id = p_player and team_id = p_to_team and ended_on is null) then
    raise exception 'player is already in this team' using errcode = '23505';
  end if;

  -- lock this player's assignments for the duration of the transfer
  perform 1 from player_assignments where player_id = p_player for update;

  if p_mode = 'move' then
    select * into v_from from player_assignments
    where player_id = p_player and ended_on is null
      and (p_from_team is null and is_primary or team_id = p_from_team)
    limit 1;
    if v_from.id is null then
      raise exception 'player has no current team to move from' using errcode = 'P0002';
    end if;
    if not can_manage_team_roster(v_from.team_id) then
      raise exception 'not allowed to remove players from the current team' using errcode = '42501';
    end if;
    update player_assignments
    set ended_on = greatest(p_effective, started_on), end_reason = coalesce(nullif(trim(p_reason), ''), 'transfer'),
        is_primary = false
    where id = v_from.id;
  end if;

  select exists (select 1 from player_assignments where player_id = p_player and is_primary and ended_on is null)
  into v_has_primary;

  insert into player_assignments (player_id, team_id, shirt_number, is_primary, started_on)
  values (p_player, p_to_team, p_shirt, not v_has_primary, p_effective)
  returning id into v_to;

  insert into player_transfers (player_id, kind, from_team_id, to_team_id, from_assignment_id, to_assignment_id, reason, effective_on)
  values (p_player, p_mode, v_from.team_id, p_to_team, v_from.id, v_to, trim(coalesce(p_reason, '')), p_effective)
  returning id into v_transfer;

  select club_id into v_club from teams where id = p_to_team;
  perform write_audit('player.' || p_mode, v_club, 'player', p_player,
                      jsonb_build_object('from_team', v_from.team_id, 'to_team', p_to_team, 'transfer_id', v_transfer));
  return v_transfer;
end;
$$;

-- Take a player out of a team without adding them elsewhere (history stays).
create function public.end_player_assignment(p_player uuid, p_team uuid, p_reason text default '', p_effective date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_a player_assignments%rowtype;
  v_next uuid;
  v_club uuid;
begin
  if not can_manage_team_roster(p_team) then
    raise exception 'not allowed to remove players from this team' using errcode = '42501';
  end if;
  select * into v_a from player_assignments where player_id = p_player and team_id = p_team and ended_on is null for update;
  if v_a.id is null then
    raise exception 'player is not in this team' using errcode = 'P0002';
  end if;
  update player_assignments
  set ended_on = greatest(p_effective, started_on), end_reason = coalesce(nullif(trim(p_reason), ''), 'left'), is_primary = false
  where id = v_a.id;
  if v_a.is_primary then
    select id into v_next from player_assignments
    where player_id = p_player and ended_on is null order by started_on, created_at limit 1;
    if v_next is not null then
      update player_assignments set is_primary = true where id = v_next;
    end if;
  end if;
  insert into player_transfers (player_id, kind, from_team_id, from_assignment_id, reason, effective_on)
  values (p_player, 'end', p_team, v_a.id, trim(coalesce(p_reason, '')), p_effective);
  select club_id into v_club from teams where id = p_team;
  perform write_audit('player.end', v_club, 'player', p_player, jsonb_build_object('team', p_team));
end;
$$;

-- ---------------------------------------- existing functions, multi-team aware

-- add_my_child / claim_player keep their signatures. claim_player now also
-- finds players who are in the team through an assignment.
create or replace function public.claim_player(p_player uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from player_assignments a
    where a.player_id = p_player and a.ended_on is null and is_team_member(a.team_id)
  ) then
    raise exception 'player not found in your teams' using errcode = '42501';
  end if;
  insert into player_guardians (player_id, user_id) values (p_player, auth.uid())
  on conflict do nothing;
end;
$$;

-- Absences: a report for a specific training belongs to that training's team;
-- a date-range report belongs to the player's main team and is visible to the
-- staff of every team the player is in.
create or replace function public.player_absences_set_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.session_id is not null then
    select s.team_id into new.team_id from training_sessions s where s.id = new.session_id;
    if not exists (
      select 1 from player_assignments a
      where a.player_id = new.player_id and a.team_id = new.team_id and a.ended_on is null
    ) then
      raise exception 'training not in this team' using errcode = '42501';
    end if;
  else
    select team_id into new.team_id from players where id = new.player_id;
  end if;
  if new.team_id is null then
    raise exception 'player not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------- grants

revoke all on function
  public.create_club, public.add_program, public.update_club, public.set_team_program,
  public.request_club_verification, public.set_club_status, public.archive_team,
  public.transfer_player, public.end_player_assignment
from public, anon;
grant execute on function
  public.create_club, public.add_program, public.update_club, public.set_team_program,
  public.request_club_verification, public.set_club_status, public.archive_team,
  public.transfer_player, public.end_player_assignment
to authenticated;
revoke all on function
  public.write_audit, public.sync_player_primary, public.teams_guard_club,
  public.player_assignments_after, public.players_after_insert, public.players_before_update
from public, anon, authenticated;

-- -------------------------------------------------------------------- RLS

alter table public.platform_admins enable row level security;
alter table public.clubs enable row level security;
alter table public.club_programs enable row level security;
alter table public.club_staff enable row level security;
alter table public.club_claims enable row level security;
alter table public.audit_log enable row level security;
alter table public.player_assignments enable row level security;
alter table public.player_transfers enable row level security;

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = auth.uid() or is_platform_admin());

-- clubs: verified clubs are a public directory (name, city); drafts only to their people
create policy clubs_select on public.clubs for select to authenticated
  using (status = 'verified' or is_club_member(id) or is_platform_admin());

create policy programs_select on public.club_programs for select to authenticated
  using (is_club_member(club_id) or is_platform_admin()
         or exists (select 1 from clubs c where c.id = club_id and c.status = 'verified'));

create policy club_staff_select on public.club_staff for select to authenticated
  using (user_id = auth.uid() or is_club_member(club_id) or is_platform_admin());
create policy club_staff_insert on public.club_staff for insert to authenticated
  with check ((is_club_admin(club_id) and role <> 'owner') or is_platform_admin());
create policy club_staff_update on public.club_staff for update to authenticated
  using (is_club_admin(club_id) or is_platform_admin())
  with check ((is_club_admin(club_id) and role <> 'owner') or is_platform_admin());
create policy club_staff_delete on public.club_staff for delete to authenticated
  using ((is_club_admin(club_id) and role <> 'owner') or user_id = auth.uid() or is_platform_admin());

create policy club_claims_select on public.club_claims for select to authenticated
  using (user_id = auth.uid() or is_club_admin(club_id) or is_platform_admin());

create policy audit_select on public.audit_log for select to authenticated
  using (is_platform_admin() or (club_id is not null and is_club_admin(club_id)));

create policy assignments_select on public.player_assignments for select to authenticated
  using (can_view_player(player_id) and (is_team_member(team_id) or is_player_guardian(player_id)
         or exists (select 1 from teams t where t.id = team_id and t.club_id is not null and is_club_admin(t.club_id))));

create policy transfers_select on public.player_transfers for select to authenticated
  using (can_view_player(player_id));

-- players: one profile, visible through any current team (see can_view_player)
drop policy players_select on public.players;
create policy players_select on public.players for select to authenticated using (can_view_player(id));
-- no deleting players from the app: history must survive
drop policy players_delete on public.players;
revoke delete on public.players from authenticated;

-- teams: club admins can see the club's teams; no deleting from the app (archive instead)
drop policy teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (is_team_member(id) or (club_id is not null and is_club_admin(club_id)) or is_platform_admin());
drop policy teams_delete on public.teams;
revoke delete on public.teams from authenticated;

drop policy guardians_select on public.player_guardians;
create policy guardians_select on public.player_guardians for select to authenticated
  using (user_id = auth.uid() or can_view_player(player_id));

drop policy absences_select on public.player_absences;
create policy absences_select on public.player_absences for select to authenticated
  using (is_team_staff(team_id) or is_player_staff(player_id) or is_player_guardian(player_id));

grant select on public.platform_admins, public.clubs, public.club_programs, public.club_claims,
  public.audit_log, public.player_assignments, public.player_transfers to authenticated;
grant select, insert, update, delete on public.club_staff to authenticated;
-- clubs / programs / assignments / transfers are written only through the functions above.

-- ---------------------------------------------- backfill: existing club names
-- Decision 3 (approved 2026-11-01): for every team creator who typed a club
-- name, open a draft club owned by them with league + academy programs, and
-- put those teams in its league program. Clubs are not merged across users
-- by name; the platform team verifies them later.

with sources as (
  select distinct t.created_by as owner, trim(t.club) as name
  from public.teams t
  where trim(t.club) <> '' and t.club_id is null
),
new_clubs as (
  insert into public.clubs (name, created_by, status)
  select left(name, 80), owner, 'draft' from sources
  returning id, name, created_by
),
staff as (
  insert into public.club_staff (club_id, user_id, role, added_by)
  select id, created_by, 'owner', created_by from new_clubs
  returning club_id
),
programs as (
  insert into public.club_programs (club_id, kind, name)
  select id, k.kind, k.name from new_clubs
  cross join (values ('league', 'ליגה'), ('academy', 'אקדמיה')) as k (kind, name)
  returning id, club_id, kind
)
update public.teams t
set club_id = c.id, program_id = p.id
from new_clubs c
join programs p on p.club_id = c.id and p.kind = 'league'
where t.created_by = c.created_by and left(trim(t.club), 80) = c.name and t.club_id is null;

insert into public.audit_log (action, club_id, entity, entity_id, details)
select 'club.backfill', c.id, 'club', c.id, jsonb_build_object('name', c.name) from public.clubs c;

-- ---------------------------------------------------------- verification
-- Every player has exactly one active primary assignment in their team.
do $$
declare
  v_players int;
  v_assign int;
begin
  select count(*) into v_players from public.players where team_id is not null;
  select count(*) into v_assign from public.player_assignments a
    join public.players p on p.id = a.player_id and p.team_id = a.team_id
    where a.is_primary and a.ended_on is null;
  if v_players <> v_assign then
    raise exception 'backfill check failed: % players, % primary assignments', v_players, v_assign;
  end if;
  raise notice 'iplays M1+M2: % players backfilled, % clubs created', v_assign, (select count(*) from public.clubs);
end;
$$;

commit;

-- After running: make yourself platform admin (replace the email):
--   insert into public.platform_admins (user_id, note)
--   select id, 'owner' from auth.users where email = 'you@example.com';
