-- iplays — initial schema: profiles, teams, memberships, invites, players
-- (roster) and guardians (which parent owns which child).
--
-- Every table has Row Level Security. Writes that cross trust boundaries
-- (creating a team, joining with an invite code, adding your own child) go
-- through SECURITY DEFINER functions that check the caller first.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  club text not null default '' check (char_length(club) <= 60),
  season text not null default '2026/27' check (char_length(season) <= 12),
  sport text not null default 'football' check (sport in ('football', 'basketball', 'other')),
  league text not null default '' check (char_length(league) <= 80),
  created_by uuid not null references auth.users (id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'parent' check (role in ('admin', 'coach', 'parent')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);

create table public.invites (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  team_id uuid not null references public.teams (id) on delete cascade,
  role text not null default 'parent' check (role in ('coach', 'parent')),
  created_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  expires_at timestamptz not null default now() + interval '60 days',
  created_at timestamptz not null default now()
);
create index invites_team_idx on public.invites (team_id);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 40),
  last_name text not null default '' check (char_length(last_name) <= 40),
  shirt_number int check (shirt_number between 0 and 99),
  position text not null default '' check (char_length(position) <= 30),
  birth_year int check (birth_year between 2000 and 2030),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (team_id, shirt_number)
);
create index players_team_idx on public.players (team_id);

create table public.player_guardians (
  player_id uuid not null references public.players (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  relation text not null default 'parent' check (relation in ('parent', 'family')),
  created_at timestamptz not null default now(),
  primary key (player_id, user_id)
);
create index player_guardians_user_idx on public.player_guardians (user_id);

-- --------------------------------------------------------------- helpers
-- SECURITY DEFINER so policies can ask "is the caller a member?" without
-- recursing into team_members' own policy.

create function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid());
$$;

create function public.is_team_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = p_team and user_id = auth.uid() and role in ('admin', 'coach')
  );
$$;

create function public.shares_team_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members a join team_members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

create function public.new_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  result text;
begin
  loop
    result := '';
    for i in 1..6 loop
      result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from invites where code = result);
  end loop;
  return result;
end;
$$;

-- -------------------------------------------------------- profile trigger

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone, email, full_name)
  values (new.id, new.phone, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------- RPCs

-- Create a team; the caller becomes its admin and gets a parent invite code.
create function public.create_team(p_name text, p_club text, p_season text, p_sport text, p_role text default 'coach')
returns table (team_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into teams (name, club, season, sport, created_by)
  values (trim(p_name), trim(coalesce(p_club, '')), coalesce(nullif(trim(p_season), ''), '2026/27'), coalesce(p_sport, 'football'), auth.uid())
  returning id into v_team;
  -- The creator is always admin; p_role is kept for the UI ("I am the coach" vs "team manager").
  insert into team_members (team_id, user_id, role) values (v_team, auth.uid(), 'admin');
  v_code := new_invite_code();
  insert into invites (code, team_id, role, created_by) values (v_code, v_team, 'parent', auth.uid());
  return query select v_team, v_code;
end;
$$;

-- Join a team with an invite code. Idempotent for existing members.
create function public.join_team(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_inv from invites where code = upper(trim(p_code));
  if not found or v_inv.expires_at < now() then
    raise exception 'invalid or expired invite code' using errcode = 'P0002';
  end if;
  insert into team_members (team_id, user_id, role)
  values (v_inv.team_id, auth.uid(), v_inv.role)
  on conflict (team_id, user_id) do nothing;
  return v_inv.team_id;
end;
$$;

-- Staff: create another invite (e.g. a separate code for coaches).
create function public.create_invite(p_team uuid, p_role text default 'parent')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not is_team_staff(p_team) then
    raise exception 'only team staff can create invites' using errcode = '42501';
  end if;
  v_code := new_invite_code();
  insert into invites (code, team_id, role, created_by) values (v_code, p_team, p_role, auth.uid());
  return v_code;
end;
$$;

-- A parent adds their own child to a team they belong to (creates the roster
-- entry and links the caller as guardian).
create function public.add_my_child(
  p_team uuid, p_first text, p_last text, p_number int default null, p_position text default '', p_birth_year int default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  if not is_team_member(p_team) then
    raise exception 'join the team first' using errcode = '42501';
  end if;
  insert into players (team_id, first_name, last_name, shirt_number, position, birth_year, created_by)
  values (p_team, trim(p_first), trim(coalesce(p_last, '')), p_number, coalesce(p_position, ''), p_birth_year, auth.uid())
  returning id into v_player;
  insert into player_guardians (player_id, user_id) values (v_player, auth.uid());
  return v_player;
end;
$$;

-- A parent claims a roster entry the coach already created ("this is my child").
create function public.claim_player(p_player uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from players where id = p_player;
  if v_team is null or not is_team_member(v_team) then
    raise exception 'player not found in your teams' using errcode = '42501';
  end if;
  insert into player_guardians (player_id, user_id) values (p_player, auth.uid())
  on conflict do nothing;
end;
$$;

revoke all on function public.create_team, public.join_team, public.create_invite, public.add_my_child, public.claim_player from public, anon;
grant execute on function public.create_team, public.join_team, public.create_invite, public.add_my_child, public.claim_player to authenticated;
revoke all on function public.new_invite_code from public, anon, authenticated;

-- -------------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.invites enable row level security;
alter table public.players enable row level security;
alter table public.player_guardians enable row level security;

-- profiles: see yourself and people you share a team with; edit only yourself
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or shares_team_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- teams: members read; staff edit; creation only via create_team()
create policy teams_select on public.teams for select to authenticated using (is_team_member(id));
create policy teams_update on public.teams for update to authenticated
  using (is_team_staff(id)) with check (is_team_staff(id));
create policy teams_delete on public.teams for delete to authenticated
  using (exists (select 1 from public.team_members m where m.team_id = id and m.user_id = auth.uid() and m.role = 'admin'));

-- team_members: members see the member list; you can leave; staff can remove/change roles
create policy members_select on public.team_members for select to authenticated using (is_team_member(team_id));
create policy members_delete on public.team_members for delete to authenticated
  using (user_id = auth.uid() or is_team_staff(team_id));
create policy members_update on public.team_members for update to authenticated
  using (is_team_staff(team_id)) with check (is_team_staff(team_id));

-- invites: staff only (parents join via join_team())
create policy invites_select on public.invites for select to authenticated using (is_team_staff(team_id));
create policy invites_delete on public.invites for delete to authenticated using (is_team_staff(team_id));

-- players: members read the roster; staff manage it; guardians can edit their own child
create policy players_select on public.players for select to authenticated using (is_team_member(team_id));
create policy players_insert on public.players for insert to authenticated with check (is_team_staff(team_id));
create policy players_update on public.players for update to authenticated
  using (
    is_team_staff(team_id)
    or exists (select 1 from public.player_guardians g where g.player_id = id and g.user_id = auth.uid())
  )
  with check (is_team_member(team_id));
create policy players_delete on public.players for delete to authenticated using (is_team_staff(team_id));

-- guardians: team members can see who belongs to whom; you can unlink yourself
create policy guardians_select on public.player_guardians for select to authenticated
  using (exists (select 1 from public.players p where p.id = player_id and is_team_member(p.team_id)));
create policy guardians_delete on public.player_guardians for delete to authenticated
  using (user_id = auth.uid());

grant select, update on public.profiles to authenticated;
grant select, update, delete on public.teams to authenticated;
grant select, update, delete on public.team_members to authenticated;
grant select, delete on public.invites to authenticated;
grant select, insert, update, delete on public.players to authenticated;
grant select, delete on public.player_guardians to authenticated;
