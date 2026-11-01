-- iplays — M3: club permission tree.
--
-- Run after 20261101200000_clubs_and_assignments.sql.
-- Rollback: supabase/rollback/20261101300000_permissions.down.sql
--
-- Who may do what is answered by one function, can(team, domain, level):
--   1. owner / admin of the team's club          -> everything in the club
--   2. explicit grants (permission_grants) on the club, a program or a team
--      (a grant on a program covers every team in it)
--   3. the person's role in the team (team_members) -> default levels
-- Levels: 1 view < 2 create < 3 edit < 4 manage.
-- Every RLS policy that used "is team staff" now asks can() for the
-- specific domain, so a coach of one team can't touch another team unless a
-- club admin granted it.
--
-- Additive: no data is deleted. Existing roles keep (at least) the access
-- they had before, so nothing breaks for current users.

begin;

-- ------------------------------------------------------------ team roles

alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check
  check (role in ('admin', 'coach', 'assistant_coach', 'instructor', 'team_manager', 'parent'));

alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('coach', 'assistant_coach', 'instructor', 'team_manager', 'parent'));

-- ---------------------------------------------------------------- tables

create table public.permission_domains (
  domain text primary key,
  label text not null,
  sort int not null
);
insert into public.permission_domains (domain, label, sort) values
  ('roster', 'סגל ושחקנים', 1),
  ('training', 'אימונים', 2),
  ('matches', 'משחקים והרכבים', 3),
  ('attendance', 'נוכחות והיעדרויות', 4),
  ('metrics', 'מדדים והתקדמות', 5),
  ('communication', 'הודעות להורים', 6),
  ('finance', 'תשלומים ויתרות', 7),
  ('equipment', 'ציוד', 8),
  ('medical', 'אישורים רפואיים', 9),
  ('staff', 'צוות והזמנות', 10),
  ('reports', 'דוחות', 11);

create table public.permission_grants (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- scope: whole club (both null), one program, or one team
  program_id uuid references public.club_programs (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  domain text not null references public.permission_domains (domain),
  level smallint not null check (level between 1 and 4),
  granted_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (program_id is null or team_id is null)
);
create unique index permission_grants_scope_idx on public.permission_grants (
  club_id, user_id,
  coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  domain
);
create index permission_grants_user_idx on public.permission_grants (user_id);

create table public.club_invites (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  club_id uuid not null references public.clubs (id) on delete restrict,
  club_role text not null default 'staff' check (club_role in ('admin', 'staff')),
  -- optional: also join a team with this role
  team_id uuid references public.teams (id) on delete restrict,
  team_role text check (team_role in ('coach', 'assistant_coach', 'instructor', 'team_manager')),
  note text not null default '' check (char_length(note) <= 80),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check ((team_id is null) = (team_role is null))
);
create index club_invites_club_idx on public.club_invites (club_id);

-- --------------------------------------------------------------- helpers

-- Default access a team role gives inside its own team.
create function public.role_default_level(p_role text, p_domain text)
returns smallint language sql immutable as $$
  select (case p_role
    when 'admin' then 4
    when 'coach' then case p_domain
      when 'roster' then 3 when 'training' then 4 when 'matches' then 4 when 'attendance' then 4
      when 'metrics' then 4 when 'communication' then 4 when 'staff' then 3
      when 'finance' then 1 when 'equipment' then 1 when 'medical' then 1 when 'reports' then 1
      else 0 end
    when 'assistant_coach' then case p_domain
      when 'roster' then 1 when 'training' then 3 when 'matches' then 3 when 'attendance' then 3
      when 'metrics' then 3 when 'communication' then 2 when 'medical' then 1
      else 0 end
    when 'instructor' then case p_domain
      when 'roster' then 1 when 'training' then 3 when 'attendance' then 3 when 'metrics' then 3
      when 'communication' then 2 when 'medical' then 1
      else 0 end
    when 'team_manager' then case p_domain
      when 'roster' then 3 when 'training' then 3 when 'matches' then 1 when 'attendance' then 3
      when 'communication' then 4 when 'finance' then 3 when 'equipment' then 3 when 'medical' then 3
      when 'staff' then 2 when 'reports' then 1
      else 0 end
    else 0 end)::smallint;
$$;

-- The caller's level in one domain of one team (0 = none).
create function public.my_level(p_team uuid, p_domain text)
returns smallint language sql stable security definer set search_path = public as $$
  with t as (select id, club_id, program_id from teams where id = p_team)
  select greatest(
    -- 1. club owner / admin
    coalesce((select 4 from t join club_staff s on s.club_id = t.club_id
              where s.user_id = auth.uid() and s.role in ('owner', 'admin') limit 1), 0),
    -- 2. explicit grants on the club, the team's program, or the team
    coalesce((select max(g.level) from t join permission_grants g on g.club_id = t.club_id
              where g.user_id = auth.uid() and g.domain = p_domain
                and (g.team_id = t.id
                     or (g.team_id is null and g.program_id = t.program_id)
                     or (g.team_id is null and g.program_id is null))), 0),
    -- 3. role in the team
    coalesce((select max(role_default_level(m.role, p_domain)) from team_members m
              where m.team_id = p_team and m.user_id = auth.uid()), 0)
  )::smallint;
$$;

create function public.can(p_team uuid, p_domain text, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select my_level(p_team, p_domain) >= p_level;
$$;

-- Any access at all to a team (to read the team row and its members).
create function public.can_see_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_member(p_team)
      or exists (select 1 from teams t join club_staff s on s.club_id = t.club_id
                 where t.id = p_team and s.user_id = auth.uid() and s.role in ('owner', 'admin'))
      or exists (select 1 from teams t join permission_grants g on g.club_id = t.club_id
                 where t.id = p_team and g.user_id = auth.uid()
                   and (g.team_id = t.id or (g.team_id is null and (g.program_id = t.program_id or g.program_id is null))));
$$;

-- Club-level permission (club admin, or a club-wide grant).
create function public.can_club(p_club uuid, p_domain text, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select is_club_admin(p_club)
      or exists (select 1 from permission_grants g
                 where g.club_id = p_club and g.user_id = auth.uid() and g.domain = p_domain
                   and g.program_id is null and g.team_id is null and g.level >= p_level);
$$;

-- People the caller may see the name of because they work in / with the same club.
create function public.is_club_colleague(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_staff a join club_staff b on a.club_id = b.club_id
    where a.user_id = auth.uid() and b.user_id = p_user
  ) or exists (
    select 1 from club_staff a
    join teams t on t.club_id = a.club_id
    join team_members m on m.team_id = t.id
    where a.user_id = auth.uid() and a.role in ('owner', 'admin') and m.user_id = p_user
  );
$$;

-- Keep the old helper meaningful for any code that still calls it:
-- "staff" = anyone with edit access to the team's roster or trainings.
create or replace function public.is_team_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select my_level(p_team, 'roster') >= 3 or my_level(p_team, 'training') >= 3;
$$;

-- can_view_player: also people whose access to a team needs player names
-- (roster, attendance or metrics), through grants or club roles.
create or replace function public.can_view_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid())
      or exists (
        select 1 from player_assignments a join team_members m on m.team_id = a.team_id
        where a.player_id = p_player and m.user_id = auth.uid()
          and (a.ended_on is null or m.role <> 'parent')
      )
      or exists (
        select 1 from player_assignments a
        where a.player_id = p_player and a.ended_on is null
          and (my_level(a.team_id, 'roster') >= 1 or my_level(a.team_id, 'attendance') >= 1
               or my_level(a.team_id, 'metrics') >= 1)
      )
      or exists (select 1 from players p where p.id = p_player and p.team_id is not null and is_team_member(p.team_id)
                 and not exists (select 1 from player_assignments a where a.player_id = p.id));
$$;

create or replace function public.is_player_staff(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from player_assignments a
    where a.player_id = p_player and a.ended_on is null and my_level(a.team_id, 'attendance') >= 1
  );
$$;

-- Moving players needs roster "manage" on the teams involved.
create or replace function public.can_manage_team_roster(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from teams t where t.id = p_team and t.club_id is not null and my_level(t.id, 'roster') >= 4)
      or exists (select 1 from teams t where t.id = p_team and t.club_id is null and is_team_admin(t.id));
$$;

create function public.new_club_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text;
begin
  loop
    result := '';
    for i in 1..8 loop
      result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from club_invites where code = result);
  end loop;
  return result;
end;
$$;

-- ------------------------------------------------------------------ RPCs

-- Club admin: give / change one grant. Level 0 removes it.
create function public.set_permission(
  p_club uuid, p_user uuid, p_domain text, p_level int,
  p_program uuid default null, p_team uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin(p_club) then
    raise exception 'only a club admin can change permissions' using errcode = '42501';
  end if;
  if p_program is not null and not exists (select 1 from club_programs where id = p_program and club_id = p_club) then
    raise exception 'program not in this club' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team and club_id = p_club) then
    raise exception 'team not in this club' using errcode = '22023';
  end if;
  if not exists (select 1 from club_staff where club_id = p_club and user_id = p_user)
     and not exists (select 1 from team_members m join teams t on t.id = m.team_id
                     where t.club_id = p_club and m.user_id = p_user and m.role <> 'parent') then
    raise exception 'user is not on the club staff' using errcode = '22023';
  end if;

  delete from permission_grants
  where club_id = p_club and user_id = p_user and domain = p_domain
    and program_id is not distinct from p_program and team_id is not distinct from p_team;
  if p_level > 0 then
    insert into permission_grants (club_id, user_id, program_id, team_id, domain, level)
    values (p_club, p_user, p_program, p_team, p_domain, least(p_level, 4));
  end if;
  perform write_audit('permission.set', p_club, 'user', p_user,
    jsonb_build_object('domain', p_domain, 'level', p_level, 'program_id', p_program, 'team_id', p_team));
end;
$$;

-- Club admin: invite someone to the club staff (and optionally to a team).
create function public.create_club_invite(
  p_club uuid, p_club_role text default 'staff', p_team uuid default null, p_team_role text default null, p_note text default ''
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not is_club_admin(p_club) then
    raise exception 'only a club admin can invite staff' using errcode = '42501';
  end if;
  if p_club_role = 'admin' and not exists (
    select 1 from club_staff where club_id = p_club and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'only the club owner can invite club admins' using errcode = '42501';
  end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team and club_id = p_club) then
    raise exception 'team not in this club' using errcode = '22023';
  end if;
  v_code := new_club_invite_code();
  insert into club_invites (code, club_id, club_role, team_id, team_role, note)
  values (v_code, p_club, p_club_role, p_team, case when p_team is not null then coalesce(p_team_role, 'coach') end, coalesce(p_note, ''));
  perform write_audit('club.invite', p_club, 'invite', null,
    jsonb_build_object('club_role', p_club_role, 'team_id', p_team, 'team_role', p_team_role));
  return v_code;
end;
$$;

-- Accept a club invite after signing in. One use per code.
create function public.accept_club_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv club_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_inv from club_invites where code = upper(trim(p_code)) for update;
  if not found or v_inv.expires_at < now() or (v_inv.used_by is not null and v_inv.used_by <> auth.uid()) then
    raise exception 'invalid or expired invite code' using errcode = 'P0002';
  end if;
  insert into club_staff (club_id, user_id, role, added_by)
  values (v_inv.club_id, auth.uid(), v_inv.club_role, v_inv.created_by)
  on conflict (club_id, user_id) do nothing;
  if v_inv.team_id is not null then
    insert into team_members (team_id, user_id, role) values (v_inv.team_id, auth.uid(), v_inv.team_role)
    on conflict (team_id, user_id) do update set role = excluded.role where team_members.role = 'parent';
  end if;
  update club_invites set used_by = auth.uid(), used_at = now() where code = v_inv.code;
  perform write_audit('club.join', v_inv.club_id, 'user', auth.uid(),
    jsonb_build_object('club_role', v_inv.club_role, 'team_id', v_inv.team_id, 'team_role', v_inv.team_role));
  return v_inv.club_id;
end;
$$;

-- Club admin: change someone's role in one of the club's teams (or remove
-- them from the team's staff by passing 'parent').
create function public.set_team_role(p_team uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
begin
  select club_id into v_club from teams where id = p_team;
  if not (my_level(p_team, 'staff') >= 4) then
    raise exception 'not allowed to change team roles' using errcode = '42501';
  end if;
  insert into team_members (team_id, user_id, role) values (p_team, p_user, p_role)
  on conflict (team_id, user_id) do update set role = excluded.role;
  perform write_audit('team.set_role', v_club, 'user', p_user, jsonb_build_object('team_id', p_team, 'role', p_role));
end;
$$;

-- Club staff list for the permissions screen (club admins only).
create function public.club_people(p_club uuid)
returns table (user_id uuid, full_name text, club_role text, team_roles jsonb)
language sql stable security definer set search_path = public as $$
  with people as (
    select s.user_id from club_staff s where s.club_id = p_club
    union
    select m.user_id from team_members m join teams t on t.id = m.team_id
    where t.club_id = p_club and m.role <> 'parent'
  )
  select p.user_id,
         coalesce(nullif(pr.full_name, ''), 'ללא שם'),
         (select s.role from club_staff s where s.club_id = p_club and s.user_id = p.user_id),
         coalesce((select jsonb_agg(jsonb_build_object('team_id', m.team_id, 'role', m.role))
                   from team_members m join teams t on t.id = m.team_id
                   where t.club_id = p_club and m.user_id = p.user_id and m.role <> 'parent'), '[]'::jsonb)
  from people p left join profiles pr on pr.id = p.user_id
  where is_club_admin(p_club)
  order by 2;
$$;

-- The caller's own effective access in a team, for showing / hiding UI.
create function public.my_permissions(p_team uuid)
returns table (domain text, level smallint)
language sql stable security definer set search_path = public as $$
  select d.domain, my_level(p_team, d.domain) from permission_domains d order by d.sort;
$$;

-- ---------------------------------------------- existing functions, re-scoped

create or replace function public.create_invite(p_team uuid, p_role text default 'parent')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not can(p_team, 'staff', case when p_role = 'parent' then 2 else 4 end) then
    raise exception 'only team staff can create invites' using errcode = '42501';
  end if;
  v_code := new_invite_code();
  insert into invites (code, team_id, role, created_by) values (v_code, p_team, p_role, auth.uid());
  return v_code;
end;
$$;

-- ----------------------------------------------------------------- grants

revoke all on function public.set_permission, public.create_club_invite, public.accept_club_invite,
  public.set_team_role, public.club_people, public.my_permissions, public.can, public.can_club,
  public.my_level, public.can_see_team
from public, anon;
grant execute on function public.set_permission, public.create_club_invite, public.accept_club_invite,
  public.set_team_role, public.club_people, public.my_permissions, public.can, public.can_club,
  public.my_level, public.can_see_team
to authenticated;
revoke all on function public.new_club_invite_code from public, anon, authenticated;

-- -------------------------------------------------------------------- RLS

alter table public.permission_domains enable row level security;
alter table public.permission_grants enable row level security;
alter table public.club_invites enable row level security;

create policy domains_select on public.permission_domains for select to authenticated using (true);
create policy grants_select on public.permission_grants for select to authenticated
  using (user_id = auth.uid() or is_club_admin(club_id));
create policy club_invites_select on public.club_invites for select to authenticated
  using (is_club_admin(club_id));
create policy club_invites_delete on public.club_invites for delete to authenticated
  using (is_club_admin(club_id));

grant select on public.permission_domains, public.permission_grants to authenticated;
grant select, delete on public.club_invites to authenticated;

-- profiles: also club colleagues
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or shares_team_with(id) or is_club_colleague(id));

-- teams
drop policy teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (can_see_team(id) or is_platform_admin());
drop policy teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (can(id, 'roster', 3)) with check (can(id, 'roster', 3));

-- team members
drop policy members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'staff', 1));
drop policy members_delete on public.team_members;
create policy members_delete on public.team_members for delete to authenticated
  using (user_id = auth.uid() or can(team_id, 'staff', 3));
drop policy members_update on public.team_members;
create policy members_update on public.team_members for update to authenticated
  using (can(team_id, 'staff', 4)) with check (can(team_id, 'staff', 4));

-- invites
drop policy invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated using (can(team_id, 'staff', 2));
drop policy invites_delete on public.invites;
create policy invites_delete on public.invites for delete to authenticated using (can(team_id, 'staff', 2));

-- players (roster)
drop policy players_insert on public.players;
create policy players_insert on public.players for insert to authenticated with check (can(team_id, 'roster', 2));
drop policy players_update on public.players;
create policy players_update on public.players for update to authenticated
  using (can(team_id, 'roster', 3) or is_player_guardian(id))
  with check (can(team_id, 'roster', 3) or is_player_guardian(id));

-- assignments
drop policy assignments_select on public.player_assignments;
create policy assignments_select on public.player_assignments for select to authenticated
  using (is_player_guardian(player_id)
         or (can_view_player(player_id) and (is_team_member(team_id) or can(team_id, 'roster', 1))));

-- trainings
drop policy sessions_select on public.training_sessions;
create policy sessions_select on public.training_sessions for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'training', 1));
drop policy sessions_insert on public.training_sessions;
create policy sessions_insert on public.training_sessions for insert to authenticated with check (can(team_id, 'training', 2));
drop policy sessions_update on public.training_sessions;
create policy sessions_update on public.training_sessions for update to authenticated
  using (can(team_id, 'training', 3)) with check (can(team_id, 'training', 3));
drop policy sessions_delete on public.training_sessions;
create policy sessions_delete on public.training_sessions for delete to authenticated using (can(team_id, 'training', 3));

-- announcements
drop policy announcements_select on public.team_announcements;
create policy announcements_select on public.team_announcements for select to authenticated
  using (is_team_member(team_id) or can(team_id, 'communication', 1));
drop policy announcements_insert on public.team_announcements;
create policy announcements_insert on public.team_announcements for insert to authenticated
  with check (can(team_id, 'communication', 2) and author_id = auth.uid());
drop policy announcements_update on public.team_announcements;
create policy announcements_update on public.team_announcements for update to authenticated
  using (can(team_id, 'communication', 3)) with check (can(team_id, 'communication', 3));
drop policy announcements_delete on public.team_announcements;
create policy announcements_delete on public.team_announcements for delete to authenticated
  using (can(team_id, 'communication', 3));

-- absences
drop policy absences_select on public.player_absences;
create policy absences_select on public.player_absences for select to authenticated
  using (can(team_id, 'attendance', 1) or is_player_staff(player_id) or is_player_guardian(player_id));
drop policy absences_insert on public.player_absences;
create policy absences_insert on public.player_absences for insert to authenticated
  with check (reported_by = auth.uid() and (is_player_guardian(player_id) or can(team_id, 'attendance', 2)));
drop policy absences_update on public.player_absences;
create policy absences_update on public.player_absences for update to authenticated
  using (can(team_id, 'attendance', 3) or is_player_guardian(player_id))
  with check (can(team_id, 'attendance', 3) or is_player_guardian(player_id));
drop policy absences_delete on public.player_absences;
create policy absences_delete on public.player_absences for delete to authenticated
  using (can(team_id, 'attendance', 3) or is_player_guardian(player_id));

do $$
begin
  raise notice 'iplays M3: permissions installed (% domains)', (select count(*) from public.permission_domains);
end;
$$;

commit;
