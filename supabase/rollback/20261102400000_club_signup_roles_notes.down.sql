-- iplays — rollback for 20261102400000_club_signup_roles_notes.sql
--
-- Restores the permission functions and club policies as they were, and
-- removes the new functions. Keeps the data: club_access_requests,
-- club_roles (+ permissions, assignments), player_pro_notes, the new clubs
-- columns and permission domains stay (no access is granted through them
-- after this rollback). The clubs.status constraint stays widened because
-- catalog clubs may exist.

begin;

drop trigger if exists clubs_seed_roles on public.clubs;
create or replace function public.role_default_level(p_role text, p_domain text)
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

create or replace function public.my_level(p_team uuid, p_domain text)
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

create or replace function public.can_see_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_member(p_team)
      or exists (select 1 from teams t join club_staff s on s.club_id = t.club_id
                 where t.id = p_team and s.user_id = auth.uid() and s.role in ('owner', 'admin'))
      or exists (select 1 from teams t join permission_grants g on g.club_id = t.club_id
                 where t.id = p_team and g.user_id = auth.uid()
                   and (g.team_id = t.id or (g.team_id is null and (g.program_id = t.program_id or g.program_id is null))));
$$;

create or replace function public.can_club(p_club uuid, p_domain text, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select is_club_admin(p_club)
      or exists (select 1 from permission_grants g
                 where g.club_id = p_club and g.user_id = auth.uid() and g.domain = p_domain
                   and g.program_id is null and g.team_id is null and g.level >= p_level);
$$;

create or replace function public.accept_club_invite(p_code text)
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

drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs for select to authenticated
  using (status = 'verified' or is_club_member(id) or is_platform_admin());
drop policy if exists programs_select on public.club_programs;
create policy programs_select on public.club_programs for select to authenticated
  using (is_club_member(club_id) or is_platform_admin()
         or exists (select 1 from clubs c where c.id = club_id and c.status = 'verified'));

drop policy if exists pro_notes_select on public.player_pro_notes;
drop policy if exists club_access_requests_select on public.club_access_requests;
drop policy if exists club_roles_select on public.club_roles;
drop policy if exists club_role_permissions_select on public.club_role_permissions;
drop policy if exists club_role_assignments_select on public.club_role_assignments;

drop function if exists public.archive_pro_note(uuid);
drop function if exists public.update_pro_note(uuid, text, text);
drop function if exists public.add_pro_note(uuid, uuid, text, text, uuid);
drop function if exists public.pro_notes_level(uuid, uuid);
drop function if exists public.catalog_club_teams(uuid, text, text, uuid[], text);
drop function if exists public.ifa_club_suggestions();
drop function if exists public.create_club_manual(text, text, text, boolean, boolean);
drop function if exists public.my_club_access_requests();
drop function if exists public.pending_club_access_requests();
drop function if exists public.review_club_access(uuid, boolean, text);
drop function if exists public.cancel_club_access(uuid);
drop function if exists public.request_club_access(uuid[], uuid[], text, text, text, text, text);
drop function if exists public.can_review_club_access(uuid);
drop function if exists public.club_access_reviewers(uuid);
drop function if exists public.signup_club_teams(uuid[]);
drop function if exists public.search_clubs_by_city(text);
drop function if exists public.my_club_access(uuid);
drop function if exists public.my_workspaces();
drop function if exists public.create_club_role_invite(uuid, uuid, uuid, uuid, text);
drop function if exists public.club_role_assignment_list(uuid);
drop function if exists public.club_roles_list(uuid);
drop function if exists public.unassign_club_role(uuid);
drop function if exists public.assign_club_role(uuid, uuid, uuid, uuid, uuid);
drop function if exists public.archive_club_role(uuid);
drop function if exists public.save_club_role(uuid, uuid, text, text, jsonb);
drop function if exists public.clubs_after_insert_roles();
drop function if exists public.seed_club_roles(uuid);
drop function if exists public.role_is_sensitive(uuid);
drop function if exists public.can_manage_roles(uuid);

commit;
