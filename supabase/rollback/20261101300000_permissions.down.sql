-- iplays — rollback for 20261101300000_permissions.sql
-- Restores the access rules of 20261101200000_clubs_and_assignments.sql.
-- Removed: permission grants, club invites, permission domains.
-- Team members with the new roles (assistant coach, instructor, team
-- manager) become 'coach', so nobody is removed from a team.

begin;

-- ------------------------------------------------------------- policies

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or shares_team_with(id));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (is_team_member(id) or (club_id is not null and is_club_admin(club_id)) or is_platform_admin());
drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (is_team_staff(id)) with check (is_team_staff(id));

drop policy if exists members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated using (is_team_member(team_id));
drop policy if exists members_delete on public.team_members;
create policy members_delete on public.team_members for delete to authenticated
  using (user_id = auth.uid() or is_team_staff(team_id));
drop policy if exists members_update on public.team_members;
create policy members_update on public.team_members for update to authenticated
  using (is_team_staff(team_id)) with check (is_team_staff(team_id));

drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites for select to authenticated using (is_team_staff(team_id));
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete to authenticated using (is_team_staff(team_id));

drop policy if exists players_insert on public.players;
create policy players_insert on public.players for insert to authenticated with check (is_team_staff(team_id));
drop policy if exists players_update on public.players;
create policy players_update on public.players for update to authenticated
  using (
    is_team_staff(team_id)
    or exists (select 1 from public.player_guardians g where g.player_id = id and g.user_id = auth.uid())
  )
  with check (is_team_member(team_id));

drop policy if exists assignments_select on public.player_assignments;
create policy assignments_select on public.player_assignments for select to authenticated
  using (can_view_player(player_id) and (is_team_member(team_id) or is_player_guardian(player_id)
         or exists (select 1 from teams t where t.id = team_id and t.club_id is not null and is_club_admin(t.club_id))));

drop policy if exists sessions_select on public.training_sessions;
create policy sessions_select on public.training_sessions for select to authenticated using (is_team_member(team_id));
drop policy if exists sessions_insert on public.training_sessions;
create policy sessions_insert on public.training_sessions for insert to authenticated with check (is_team_staff(team_id));
drop policy if exists sessions_update on public.training_sessions;
create policy sessions_update on public.training_sessions for update to authenticated
  using (is_team_staff(team_id)) with check (is_team_staff(team_id));
drop policy if exists sessions_delete on public.training_sessions;
create policy sessions_delete on public.training_sessions for delete to authenticated using (is_team_staff(team_id));

drop policy if exists announcements_select on public.team_announcements;
create policy announcements_select on public.team_announcements for select to authenticated using (is_team_member(team_id));
drop policy if exists announcements_insert on public.team_announcements;
create policy announcements_insert on public.team_announcements for insert to authenticated
  with check (is_team_staff(team_id) and author_id = auth.uid());
drop policy if exists announcements_update on public.team_announcements;
create policy announcements_update on public.team_announcements for update to authenticated
  using (is_team_staff(team_id)) with check (is_team_staff(team_id));
drop policy if exists announcements_delete on public.team_announcements;
create policy announcements_delete on public.team_announcements for delete to authenticated using (is_team_staff(team_id));

drop policy if exists absences_select on public.player_absences;
create policy absences_select on public.player_absences for select to authenticated
  using (is_team_staff(team_id) or is_player_staff(player_id) or is_player_guardian(player_id));
drop policy if exists absences_insert on public.player_absences;
create policy absences_insert on public.player_absences for insert to authenticated
  with check (reported_by = auth.uid() and (is_player_guardian(player_id) or is_team_staff(team_id)));
drop policy if exists absences_update on public.player_absences;
create policy absences_update on public.player_absences for update to authenticated
  using (is_team_staff(team_id) or is_player_guardian(player_id))
  with check (is_team_staff(team_id) or is_player_guardian(player_id));
drop policy if exists absences_delete on public.player_absences;
create policy absences_delete on public.player_absences for delete to authenticated
  using (is_team_staff(team_id) or is_player_guardian(player_id));

-- ------------------------------------------------------------ functions

create or replace function public.is_team_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = p_team and user_id = auth.uid() and role in ('admin', 'coach')
  );
$$;

create or replace function public.can_view_player(p_player uuid)
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
      or exists (select 1 from players p where p.id = p_player and p.team_id is not null and is_team_member(p.team_id)
                 and not exists (select 1 from player_assignments a where a.player_id = p.id));
$$;

create or replace function public.is_player_staff(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from player_assignments a join team_members m on m.team_id = a.team_id
    where a.player_id = p_player and a.ended_on is null and m.user_id = auth.uid() and m.role in ('admin', 'coach')
  );
$$;

create or replace function public.can_manage_team_roster(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from teams t where t.id = p_team and t.club_id is not null and is_club_admin(t.club_id))
      or exists (select 1 from teams t where t.id = p_team and t.club_id is null and is_team_admin(t.id));
$$;

create or replace function public.create_invite(p_team uuid, p_role text default 'parent')
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

drop function if exists public.my_permissions(uuid);
drop function if exists public.club_people(uuid);
drop function if exists public.set_team_role(uuid, uuid, text);
drop function if exists public.accept_club_invite(text);
drop function if exists public.create_club_invite(uuid, text, uuid, text, text);
drop function if exists public.set_permission(uuid, uuid, text, int, uuid, uuid);
drop function if exists public.new_club_invite_code();
drop function if exists public.is_club_colleague(uuid);
drop function if exists public.can_club(uuid, text, int);
drop function if exists public.can_see_team(uuid);
drop function if exists public.can(uuid, text, int);
drop function if exists public.my_level(uuid, text);
drop function if exists public.role_default_level(text, text);

-- ---------------------------------------------------------------- tables

drop table if exists public.club_invites;
drop table if exists public.permission_grants;
drop table if exists public.permission_domains;

-- ------------------------------------------------------------ team roles

update public.team_members set role = 'coach' where role in ('assistant_coach', 'instructor', 'team_manager');
alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check check (role in ('admin', 'coach', 'parent'));

update public.invites set role = 'coach' where role in ('assistant_coach', 'instructor', 'team_manager');
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('coach', 'parent'));

commit;
