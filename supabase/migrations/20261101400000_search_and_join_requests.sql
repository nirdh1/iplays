-- iplays — open search at sign-up + join requests.
--
-- Run after 20261101300000_permissions.sql.
-- Rollback: supabase/rollback/20261101400000_search_and_join_requests.down.sql
-- (the rollback keeps the join_requests and player_kit tables and their data;
-- running this file again picks them up).
--
-- Product decision (2026-11-01, project owner): search is open to every
-- signed-in user. Anyone can search a child by name (league and academy) and
-- see the child's team and club, or search a club by name / city and see its
-- teams by birth year. Joining a team is a request that the team's staff or
-- the club approves; training times, places, the roster and everything else
-- stay visible only to members, as before.
--
-- Search results show only: first + last name, birth year, team, club,
-- program (league / academy).
--
-- Parents vs. followers (owner decision, same day):
--   * A parent must declare "I am this child's parent" (stored with time and
--     wording). The team's staff / club approve parent requests.
--   * Anyone else (grandparent, relative) asks to FOLLOW an existing child.
--     Only a declared parent of that child can approve it.
--   * Followers see the child and the team schedule; only parents can edit
--     the child or report absences (is_player_guardian now means parent).

begin;

create extension if not exists pg_trgm;
create index if not exists players_name_trgm_idx on public.players
  using gin ((first_name || ' ' || last_name) gin_trgm_ops);
create index if not exists clubs_name_trgm_idx on public.clubs using gin (name gin_trgm_ops);

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- the child already on the roster ("this is my child"), or a new child
  player_id uuid references public.players (id) on delete restrict,
  child_first text not null default '' check (char_length(child_first) <= 40),
  child_last text not null default '' check (char_length(child_last) <= 40),
  birth_year int check (birth_year between 2000 and 2030),
  message text not null default '' check (char_length(message) <= 300),
  -- parent: "I am the child's parent" (declared); family: wants to follow the child
  relation text not null default 'parent' check (relation in ('parent', 'family')),
  declaration text not null default '' check (char_length(declaration) <= 300),
  declared_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (player_id is not null or char_length(child_first) > 0),
  check (relation = 'family' or declared_at is not null),
  check (relation = 'parent' or player_id is not null)
);
create unique index if not exists join_requests_pending_idx on public.join_requests (
  team_id, user_id, coalesce(player_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(child_first)
) where status = 'pending';
create index if not exists join_requests_team_idx on public.join_requests (team_id) where status = 'pending';
create index if not exists join_requests_user_idx on public.join_requests (user_id);

-- ------------------------------------------------------- parent vs follower

-- A declared parent of the child (relation 'parent').
create function public.is_player_parent(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid() and relation = 'parent');
$$;

-- is_player_guardian is used by the write policies (edit child, report
-- absences): from now on it means a parent, not a follower. Followers still
-- see the child through can_view_player (any guardian row).
create or replace function public.is_player_guardian(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_player_parent(p_player);
$$;

-- --------------------------------------------------------------- search

create function public.search_players(p_query text, p_birth_year int default null)
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  team_id uuid, team_name text, club_id uuid, club_name text, program_kind text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.first_name, p.last_name, p.birth_year,
         t.id, t.name, c.id, coalesce(c.name, nullif(t.club, '')), cp.kind
  from players p
  join player_assignments a on a.player_id = p.id and a.ended_on is null
  join teams t on t.id = a.team_id and t.archived_at is null
  left join clubs c on c.id = t.club_id and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where p.archived_at is null
    and (p.first_name || ' ' || p.last_name) ilike '%' || v_q || '%'
    and (p_birth_year is null or p.birth_year = p_birth_year)
  order by p.first_name, p.last_name
  limit 30;
end;
$$;

create function public.search_clubs(p_query text)
returns table (club_id uuid, name text, city text, status text, teams int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select c.id, c.name, c.city, c.status,
         (select count(*)::int from teams t where t.club_id = c.id and t.archived_at is null)
  from clubs c
  where c.archived_at is null and c.status <> 'suspended'
    and (c.name ilike '%' || v_q || '%' or c.city ilike '%' || v_q || '%')
  order by (c.status = 'verified') desc, c.name
  limit 30;
end;
$$;

-- Teams of a club, optionally only those whose players are of a birth year.
create function public.club_teams_public(p_club uuid, p_birth_year int default null)
returns table (team_id uuid, name text, program_kind text, program_name text, season text, players int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, cp.kind, cp.name, t.season,
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null)
  from teams t
  left join club_programs cp on cp.id = t.program_id
  where auth.uid() is not null
    and t.club_id = p_club and t.archived_at is null
    and (p_birth_year is null
         or (t.birth_year_from is not null and p_birth_year between t.birth_year_from and coalesce(t.birth_year_to, t.birth_year_from))
         or exists (select 1 from player_assignments a join players p on p.id = a.player_id
                    where a.team_id = t.id and a.ended_on is null and p.birth_year = p_birth_year))
  order by cp.kind nulls last, t.name;
$$;

-- --------------------------------------------------------------- requests

create function public.request_join(
  p_team uuid, p_player uuid default null, p_first text default '', p_last text default '',
  p_birth_year int default null, p_message text default '',
  p_relation text default 'parent', p_declare_parent boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_declaration constant text := 'אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה';
begin
  if p_relation not in ('parent', 'family') then
    raise exception 'relation must be parent or family' using errcode = '22023';
  end if;
  if p_relation = 'parent' and not coalesce(p_declare_parent, false) then
    raise exception 'parent declaration required' using errcode = '22023';
  end if;
  if p_relation = 'family' and p_player is null then
    raise exception 'follow requests need an existing child' using errcode = '22023';
  end if;
  if p_relation = 'family' and not exists (
    select 1 from player_guardians where player_id = p_player and relation = 'parent'
  ) then
    raise exception 'child has no parent yet' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from teams where id = p_team and archived_at is null) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if p_player is not null and not exists (
    select 1 from player_assignments where player_id = p_player and team_id = p_team and ended_on is null
  ) then
    raise exception 'player not in this team' using errcode = '22023';
  end if;
  if p_player is not null and exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid())
     and is_team_member(p_team) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into join_requests (team_id, user_id, player_id, child_first, child_last, birth_year, message,
                             relation, declaration, declared_at)
  values (p_team, auth.uid(), p_player, trim(coalesce(p_first, '')), trim(coalesce(p_last, '')), p_birth_year,
          trim(coalesce(p_message, '')), p_relation,
          case when p_relation = 'parent' then v_declaration else '' end,
          case when p_relation = 'parent' then now() end)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_join_request(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update join_requests set status = 'cancelled' where id = p_id and user_id = auth.uid() and status = 'pending';
$$;

-- Staff who may invite parents to the team (staff >= create) approve or reject.
create function public.review_join_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r join_requests%rowtype;
  v_player uuid;
  v_club uuid;
begin
  select * into r from join_requests where id = p_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if r.relation = 'parent' and not can(r.team_id, 'staff', 2) then
    raise exception 'not allowed to approve requests for this team' using errcode = '42501';
  end if;
  if r.relation = 'family' and not is_player_parent(r.player_id) then
    raise exception 'only the child''s parent can approve followers' using errcode = '42501';
  end if;

  if p_approve then
    insert into team_members (team_id, user_id, role) values (r.team_id, r.user_id, 'parent')
    on conflict (team_id, user_id) do nothing;
    v_player := r.player_id;
    if v_player is null then
      -- new child: create the profile and its assignment (trigger) in this team
      insert into players (team_id, first_name, last_name, birth_year, created_by)
      values (r.team_id, left(r.child_first, 40), left(r.child_last, 40), r.birth_year, r.user_id)
      returning id into v_player;
    end if;
    insert into player_guardians (player_id, user_id, relation) values (v_player, r.user_id, r.relation)
    on conflict (player_id, user_id) do nothing;
  end if;

  update join_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      player_id = coalesce(v_player, player_id), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  select club_id into v_club from teams where id = r.team_id;
  perform write_audit(case when p_approve then 'join.approve' else 'join.reject' end, v_club, 'join_request', p_id,
                      jsonb_build_object('team_id', r.team_id, 'user_id', r.user_id));
end;
$$;

-- Pending requests the caller can approve, with the requester's name.
create function public.pending_join_requests(p_team uuid)
returns table (id uuid, user_id uuid, requester text, player_id uuid, child_name text, birth_year int, message text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.user_id, coalesce(nullif(pr.full_name, ''), coalesce(pr.email, pr.phone, '')),
         r.player_id,
         coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), trim(r.child_first || ' ' || r.child_last)),
         coalesce(p.birth_year, r.birth_year), r.message, r.created_at
  from join_requests r
  left join profiles pr on pr.id = r.user_id
  left join players p on p.id = r.player_id
  where r.team_id = p_team and r.status = 'pending' and r.relation = 'parent' and can(p_team, 'staff', 2)
  order by r.created_at;
$$;

-- Follow requests waiting for the caller (as a declared parent) to approve.
create function public.my_follow_requests()
returns table (id uuid, requester text, player_id uuid, child_name text, message text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, coalesce(nullif(pr.full_name, ''), coalesce(pr.email, pr.phone, '')), r.player_id,
         trim(p.first_name || ' ' || p.last_name), r.message, r.created_at
  from join_requests r
  join players p on p.id = r.player_id
  left join profiles pr on pr.id = r.user_id
  where r.status = 'pending' and r.relation = 'family'
    and exists (select 1 from player_guardians g where g.player_id = r.player_id and g.user_id = auth.uid() and g.relation = 'parent')
  order by r.created_at;
$$;


-- My own requests (to show "waiting for approval"), with the team's name.
create function public.my_join_requests()
returns table (id uuid, team_id uuid, team_name text, club_name text, child_name text, relation text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.team_id, t.name, coalesce(c.name, nullif(t.club, '')),
         coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), trim(r.child_first || ' ' || r.child_last)),
         r.relation, r.status, r.created_at
  from join_requests r
  join teams t on t.id = r.team_id
  left join clubs c on c.id = t.club_id
  left join players p on p.id = r.player_id
  where r.user_id = auth.uid() and (r.status = 'pending' or r.reviewed_at > now() - interval '30 days')
  order by r.created_at desc;
$$;

-- ------------------------------------------------------- team page link

-- The public card of a team (what a shared #t/<id> link shows).
create function public.team_public(p_team uuid)
returns table (team_id uuid, name text, season text, sport text, club_id uuid, club_name text, club_status text,
               program_kind text, players int, is_member boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.season, t.sport, c.id, coalesce(c.name, nullif(t.club, '')), c.status, cp.kind,
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null),
         is_team_member(t.id)
  from teams t
  left join clubs c on c.id = t.club_id and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where auth.uid() is not null and t.id = p_team and t.archived_at is null;
$$;

-- Names and birth years on the team's roster (the same data the open search
-- shows), so a parent can pick "this is my child" from a shared link.
create function public.team_roster_public(p_team uuid)
returns table (player_id uuid, first_name text, last_name text, birth_year int, has_parent boolean, linked boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.birth_year,
         exists (select 1 from player_guardians g where g.player_id = p.id and g.relation = 'parent'),
         exists (select 1 from player_guardians g where g.player_id = p.id and g.user_id = auth.uid())
  from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  where auth.uid() is not null and a.team_id = p_team and a.ended_on is null
    and exists (select 1 from teams t where t.id = p_team and t.archived_at is null)
  order by p.first_name, p.last_name;
$$;

-- "This is my child" inside a team you are in: only while the child has no
-- declared parent yet. Otherwise it's a request (parent → staff approve,
-- follower → the parent approves).
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
  if exists (select 1 from player_guardians where player_id = p_player and relation = 'parent' and user_id <> auth.uid()) then
    raise exception 'child already has a parent' using errcode = '42501';
  end if;
  insert into player_guardians (player_id, user_id, relation) values (p_player, auth.uid(), 'parent')
  on conflict do nothing;
end;
$$;

-- ------------------------------------------------- shirt number and kit

-- The child's shirt number in one team. The parent or roster editors set it;
-- it can change any time (unique per team among current players).
create function public.set_shirt_number(p_player uuid, p_team uuid, p_number int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_number is not null and (p_number < 0 or p_number > 99) then
    raise exception 'shirt number must be 0-99' using errcode = '22023';
  end if;
  if not (is_player_parent(p_player) or can(p_team, 'roster', 3)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update player_assignments set shirt_number = p_number
  where player_id = p_player and team_id = p_team and ended_on is null;
  if not found then
    raise exception 'player not in this team' using errcode = '22023';
  end if;
  perform sync_player_primary(p_player);
end;
$$;

create table if not exists public.player_kit (
  player_id uuid primary key references public.players (id) on delete restrict,
  summer_sets smallint not null default 0 check (summer_sets between 0 and 20),
  winter_sets smallint not null default 0 check (winter_sets between 0 and 20),
  home_sets smallint not null default 0 check (home_sets between 0 and 20),
  away_sets smallint not null default 0 check (away_sets between 0 and 20),
  socks smallint not null default 0 check (socks between 0 and 20),
  shirt_size text not null default '' check (char_length(shirt_size) <= 10),
  pants_size text not null default '' check (char_length(pants_size) <= 10),
  shoe_size text not null default '' check (char_length(shoe_size) <= 10),
  notes text not null default '' check (char_length(notes) <= 200),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Who may edit the kit: the child's parent, or equipment editors of one of its teams.
create function public.can_edit_kit(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_player_parent(p_player)
      or exists (select 1 from player_assignments a where a.player_id = p_player and a.ended_on is null
                 and can(a.team_id, 'equipment', 3));
$$;

create function public.set_player_kit(
  p_player uuid, p_summer int default 0, p_winter int default 0, p_home int default 0, p_away int default 0,
  p_socks int default 0, p_shirt_size text default '', p_pants_size text default '', p_shoe_size text default '',
  p_notes text default ''
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_edit_kit(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into player_kit as k (player_id, summer_sets, winter_sets, home_sets, away_sets, socks,
                               shirt_size, pants_size, shoe_size, notes, updated_by, updated_at)
  values (p_player, coalesce(p_summer, 0), coalesce(p_winter, 0), coalesce(p_home, 0), coalesce(p_away, 0),
          coalesce(p_socks, 0), trim(coalesce(p_shirt_size, '')), trim(coalesce(p_pants_size, '')),
          trim(coalesce(p_shoe_size, '')), trim(coalesce(p_notes, '')), auth.uid(), now())
  on conflict (player_id) do update set
    summer_sets = excluded.summer_sets, winter_sets = excluded.winter_sets, home_sets = excluded.home_sets,
    away_sets = excluded.away_sets, socks = excluded.socks, shirt_size = excluded.shirt_size,
    pants_size = excluded.pants_size, shoe_size = excluded.shoe_size, notes = excluded.notes,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- ------------------------------------------------------------------- RLS

alter table public.join_requests enable row level security;
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests for select to authenticated
  using (user_id = auth.uid()
         or (relation = 'parent' and can(team_id, 'staff', 2))
         or (relation = 'family' and is_player_parent(player_id)));
grant select on public.join_requests to authenticated;

-- Kit: the child's guardians (parents and followers) and equipment viewers of its teams.
alter table public.player_kit enable row level security;
drop policy if exists player_kit_select on public.player_kit;
create policy player_kit_select on public.player_kit for select to authenticated
  using (exists (select 1 from player_guardians g where g.player_id = player_kit.player_id and g.user_id = auth.uid())
         or exists (select 1 from player_assignments a where a.player_id = player_kit.player_id and a.ended_on is null
                    and can(a.team_id, 'equipment', 1)));
grant select on public.player_kit to authenticated;

revoke all on function public.search_players, public.search_clubs, public.club_teams_public, public.request_join,
  public.cancel_join_request, public.review_join_request, public.pending_join_requests, public.my_follow_requests,
  public.is_player_parent, public.my_join_requests, public.team_public, public.team_roster_public,
  public.set_shirt_number, public.can_edit_kit, public.set_player_kit from public, anon;
grant execute on function public.search_players, public.search_clubs, public.club_teams_public, public.request_join,
  public.cancel_join_request, public.review_join_request, public.pending_join_requests, public.my_follow_requests,
  public.is_player_parent, public.my_join_requests, public.team_public, public.team_roster_public,
  public.set_shirt_number, public.can_edit_kit, public.set_player_kit to authenticated;

do $$
begin
  raise notice 'iplays: search and join requests installed';
end;
$$;

commit;
