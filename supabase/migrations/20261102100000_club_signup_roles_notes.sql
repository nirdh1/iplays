-- iplays — club sign-up by city, custom club roles, confidential coach notes.
--
-- Run after 20261101999000_team_ifa_link.sql (needs the inbox notifications,
-- IFA import and permissions migrations).
-- Rollback: supabase/rollback/20261102100000_club_signup_roles_notes.down.sql
--
-- Additive only: new columns with defaults, new tables, new functions. The
-- existing functions my_level / can_see_team / can_club / role_default_level /
-- accept_club_invite are replaced with versions that keep every old rule and
-- add the new ones. No row is deleted or changed except:
--   * every existing club gets the default role templates (new rows);
--   * clubs.status may also be 'catalog' (constraint widened).
--
-- Product spec (2026-11-02, project owner), sections 3, 4 and 9:
--
-- 3. Club sign-up. A user types a city, sees every known club there, ticks
--    one or more clubs, then ticks teams of those clubs. Clubs and academies
--    that are not in the IFA can be opened by hand. Picking a club gives no
--    rights: it sends a request that the club's admin approves, or a platform
--    admin when the club has no admin yet (ownership check, so nobody can take
--    over an existing club). Clubs built from IFA data have status 'catalog'
--    (listed, no owner) until someone is approved.
--
-- 4. Dynamic roles. Each club has roles (templates + custom), each role has a
--    level per permission domain (1 view, 2 create, 3 edit, 4 manage /
--    archive). A role is assigned to a user for the whole club, one program or
--    one team. my_level() / can() — already used by every RLS policy — now
--    also read role assignments, so roles are enforced in the database.
--    Club owner / admin keep full access. Someone with "permissions" manage
--    club-wide may manage roles, but cannot hand out the "permissions" domain
--    or give roles to themselves (only owner / admin can).
--    One account, many clubs: my_workspaces() lists every club the user works
--    in; access is always per club, so nothing leaks between clubs.
--
-- 9. Confidential coach notes (player_pro_notes). Owned by the club, not by
--    the coach: kept when the coach leaves (author name is stored), visible to
--    any staff of that club with "pro_notes" access to a team the player is in
--    now, and to club-wide holders. Never visible to the player's parents /
--    family (player_guardians) through the app, never to another club.
--    Archive instead of delete.
--
-- Inbox: requests use the existing 'join_request' / 'join_decision' kinds, so
-- the notification_outbox kind check does not need to change.

begin;

-- ============================================================ 3. catalog

alter table public.clubs add column if not exists kind text not null default 'club';
alter table public.clubs drop constraint if exists clubs_kind_check;
alter table public.clubs add constraint clubs_kind_check check (kind in ('club', 'academy'));
alter table public.clubs add column if not exists ifa_registered boolean not null default false;
alter table public.clubs add column if not exists source text not null default 'manual';
alter table public.clubs drop constraint if exists clubs_source_check;
alter table public.clubs add constraint clubs_source_check check (source in ('manual', 'ifa'));

alter table public.clubs drop constraint if exists clubs_status_check;
alter table public.clubs add constraint clubs_status_check
  check (status in ('catalog', 'draft', 'pending_verification', 'verified', 'suspended'));

create index if not exists clubs_city_idx on public.clubs (lower(city));

-- catalog clubs are listed like verified ones
drop policy if exists clubs_select on public.clubs;
create policy clubs_select on public.clubs for select to authenticated
  using (status in ('verified', 'catalog') or is_club_member(id) or is_platform_admin());

drop policy if exists programs_select on public.club_programs;
create policy programs_select on public.club_programs for select to authenticated
  using (is_club_member(club_id) or is_platform_admin()
         or exists (select 1 from clubs c where c.id = club_id and c.status in ('verified', 'catalog')));

create table if not exists public.club_access_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- club_admin: manage the whole club; team_staff: coach / staff of the picked teams
  kind text not null check (kind in ('club_admin', 'team_staff')),
  team_ids uuid[] not null default '{}',
  team_role text not null default 'coach' check (team_role in ('coach', 'assistant_coach', 'instructor', 'team_manager')),
  role_title text not null default '' check (char_length(role_title) <= 80),
  message text not null default '' check (char_length(message) <= 1000),
  contact_phone text not null default '' check (char_length(contact_phone) <= 30),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text not null default '' check (char_length(review_note) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists club_access_requests_pending_idx
  on public.club_access_requests (club_id, user_id, kind) where status = 'pending';
create index if not exists club_access_requests_user_idx on public.club_access_requests (user_id);

-- ============================================================ 4. roles

insert into public.permission_domains (domain, label, sort) values
  ('permissions', 'ניהול הרשאות ותפקידים', 12),
  ('pro_notes', 'הערות מקצועיות חסויות', 13),
  ('camps', 'מחנות וקייטנות', 14)
on conflict (domain) do nothing;

create table if not exists public.club_roles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  is_template boolean not null default false,
  sort int not null default 100,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists club_roles_name_idx on public.club_roles (club_id, lower(trim(name))) where archived_at is null;

create table if not exists public.club_role_permissions (
  role_id uuid not null references public.club_roles (id) on delete cascade,
  domain text not null references public.permission_domains (domain),
  level smallint not null check (level between 1 and 4),
  primary key (role_id, domain)
);

create table if not exists public.club_role_assignments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  role_id uuid not null references public.club_roles (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- scope: whole club (both null), one program, or one team
  program_id uuid references public.club_programs (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  assigned_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (program_id is null or team_id is null)
);
create unique index if not exists club_role_assignments_scope_idx on public.club_role_assignments (
  role_id, user_id,
  coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index if not exists club_role_assignments_user_idx on public.club_role_assignments (user_id, club_id);

alter table public.club_invites add column if not exists role_id uuid references public.club_roles (id) on delete restrict;
alter table public.club_invites add column if not exists role_program_id uuid references public.club_programs (id) on delete restrict;
alter table public.club_invites add column if not exists role_team_id uuid references public.teams (id) on delete restrict;

-- ------------------------------------------------- permission core, extended

create or replace function public.role_default_level(p_role text, p_domain text)
returns smallint language sql immutable as $$
  select (case p_role
    when 'admin' then 4
    when 'coach' then case p_domain
      when 'roster' then 3 when 'training' then 4 when 'matches' then 4 when 'attendance' then 4
      when 'metrics' then 4 when 'communication' then 4 when 'staff' then 3
      when 'finance' then 1 when 'equipment' then 1 when 'medical' then 1 when 'reports' then 1
      when 'pro_notes' then 3
      else 0 end
    when 'assistant_coach' then case p_domain
      when 'roster' then 1 when 'training' then 3 when 'matches' then 3 when 'attendance' then 3
      when 'metrics' then 3 when 'communication' then 2 when 'medical' then 1
      when 'pro_notes' then 2
      else 0 end
    when 'instructor' then case p_domain
      when 'roster' then 1 when 'training' then 3 when 'attendance' then 3 when 'metrics' then 3
      when 'communication' then 2 when 'medical' then 1
      when 'pro_notes' then 2
      else 0 end
    when 'team_manager' then case p_domain
      when 'roster' then 3 when 'training' then 3 when 'matches' then 1 when 'attendance' then 3
      when 'communication' then 4 when 'finance' then 3 when 'equipment' then 3 when 'medical' then 3
      when 'staff' then 2 when 'reports' then 1
      else 0 end
    else 0 end)::smallint;
$$;

-- The caller's level in one domain of one team (0 = none). Sources:
-- club owner/admin, explicit grants, club role assignments, role in the team.
create or replace function public.my_level(p_team uuid, p_domain text)
returns smallint language sql stable security definer set search_path = public as $$
  with t as (select id, club_id, program_id from teams where id = p_team)
  select greatest(
    coalesce((select 4 from t join club_staff s on s.club_id = t.club_id
              where s.user_id = auth.uid() and s.role in ('owner', 'admin') limit 1), 0),
    coalesce((select max(g.level) from t join permission_grants g on g.club_id = t.club_id
              where g.user_id = auth.uid() and g.domain = p_domain
                and (g.team_id = t.id
                     or (g.team_id is null and g.program_id = t.program_id)
                     or (g.team_id is null and g.program_id is null))), 0),
    coalesce((select max(rp.level) from t
              join club_role_assignments a on a.club_id = t.club_id
              join club_roles r on r.id = a.role_id and r.archived_at is null
              join club_role_permissions rp on rp.role_id = a.role_id
              where a.user_id = auth.uid() and rp.domain = p_domain
                and (a.team_id = t.id
                     or (a.team_id is null and a.program_id = t.program_id)
                     or (a.team_id is null and a.program_id is null))), 0),
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
                   and (g.team_id = t.id or (g.team_id is null and (g.program_id = t.program_id or g.program_id is null))))
      or exists (select 1 from teams t
                 join club_role_assignments a on a.club_id = t.club_id
                 join club_roles r on r.id = a.role_id and r.archived_at is null
                 where t.id = p_team and a.user_id = auth.uid()
                   and (a.team_id = t.id or (a.team_id is null and (a.program_id = t.program_id or a.program_id is null))));
$$;

-- Club-level permission: owner/admin, a club-wide grant, or a club-wide role.
create or replace function public.can_club(p_club uuid, p_domain text, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select is_club_admin(p_club)
      or exists (select 1 from permission_grants g
                 where g.club_id = p_club and g.user_id = auth.uid() and g.domain = p_domain
                   and g.program_id is null and g.team_id is null and g.level >= p_level)
      or exists (select 1 from club_role_assignments a
                 join club_roles r on r.id = a.role_id and r.archived_at is null
                 join club_role_permissions rp on rp.role_id = a.role_id
                 where a.club_id = p_club and a.user_id = auth.uid() and rp.domain = p_domain
                   and a.program_id is null and a.team_id is null and rp.level >= p_level);
$$;

create or replace function public.can_manage_roles(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_club_admin(p_club) or can_club(p_club, 'permissions', 4);
$$;

-- A role that hands out "permissions" can only be touched by owner / admin.
create or replace function public.role_is_sensitive(p_role uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_role_permissions where role_id = p_role and domain = 'permissions');
$$;

-- ------------------------------------------------------- default templates

create or replace function public.seed_club_roles(p_club uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role uuid;
  r record;
  d record;
begin
  if exists (select 1 from club_roles where club_id = p_club) then
    return;
  end if;
  for r in
    select * from (values
      (1, 'מנהל מועדון', 'כל ההרשאות במועדון, כולל ניהול תפקידים',
       '{"roster":4,"training":4,"matches":4,"attendance":4,"metrics":4,"communication":4,"finance":4,"equipment":4,"medical":4,"staff":4,"reports":4,"permissions":4,"pro_notes":4,"camps":4}'),
      (2, 'גזבר', 'כספים, גבייה ודוחות',
       '{"finance":4,"reports":3,"roster":1}'),
      (3, 'מנהל קבוצה', 'סגל, לוחות זמנים, נוכחות והודעות',
       '{"roster":3,"training":3,"matches":3,"attendance":3,"communication":4,"equipment":3,"staff":2,"reports":1,"finance":1}'),
      (4, 'מאמן ראשי', 'אימונים, משחקים, נוכחות והערות מקצועיות',
       '{"roster":3,"training":4,"matches":4,"attendance":4,"metrics":4,"communication":4,"staff":2,"medical":1,"pro_notes":3,"reports":1}'),
      (5, 'עוזר מאמן', 'עזרה באימונים ובמשחקים',
       '{"roster":1,"training":3,"matches":3,"attendance":3,"metrics":3,"communication":2,"medical":1,"pro_notes":2}'),
      (6, 'מאמן שוערים', 'אימוני שוערים לשחקנים שהוא מורשה להם',
       '{"roster":1,"training":3,"matches":1,"attendance":3,"metrics":3,"pro_notes":2}'),
      (7, 'מאמן כושר', 'אימוני כושר ומדדים',
       '{"roster":1,"training":3,"attendance":2,"metrics":3,"medical":1,"pro_notes":2}'),
      (8, 'אחראי מחנות וקייטנות', 'מחנות, קייטנות והרשמה',
       '{"camps":4,"communication":2,"finance":2,"roster":1}')
    ) as x(sort, name, description, perms)
  loop
    insert into club_roles (club_id, name, description, is_template, sort, created_by)
    values (p_club, r.name, r.description, true, r.sort, null)
    returning id into v_role;
    for d in select key, value::int as lvl from jsonb_each_text(r.perms::jsonb) loop
      insert into club_role_permissions (role_id, domain, level) values (v_role, d.key, d.lvl);
    end loop;
  end loop;
end;
$$;

create or replace function public.clubs_after_insert_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform seed_club_roles(new.id);
  return new;
end;
$$;

drop trigger if exists clubs_seed_roles on public.clubs;
create trigger clubs_seed_roles after insert on public.clubs
  for each row execute function public.clubs_after_insert_roles();

select public.seed_club_roles(id) from public.clubs;

-- ------------------------------------------------------------ role RPCs

-- Create (p_role null) or edit a role. p_perms: {"domain": level, ...}; level 0 / missing = none.
create or replace function public.save_club_role(
  p_club uuid, p_role uuid, p_name text, p_description text, p_perms jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role uuid := p_role;
  v_admin boolean := is_club_admin(p_club);
  d record;
begin
  if not can_manage_roles(p_club) then
    raise exception 'not allowed to manage roles' using errcode = '42501';
  end if;
  if not v_admin and coalesce((p_perms->>'permissions')::int, 0) > 0 then
    raise exception 'only a club admin can give the permissions domain' using errcode = '42501';
  end if;
  if v_role is not null then
    if not exists (select 1 from club_roles where id = v_role and club_id = p_club and archived_at is null) then
      raise exception 'role not in this club' using errcode = '22023';
    end if;
    if not v_admin and role_is_sensitive(v_role) then
      raise exception 'only a club admin can change this role' using errcode = '42501';
    end if;
    update club_roles set name = trim(p_name), description = left(trim(coalesce(p_description, '')), 200) where id = v_role;
    delete from club_role_permissions where role_id = v_role;
  else
    insert into club_roles (club_id, name, description) values (p_club, trim(p_name), left(trim(coalesce(p_description, '')), 200))
    returning id into v_role;
  end if;
  for d in select key, value from jsonb_each_text(coalesce(p_perms, '{}'::jsonb)) loop
    if d.value ~ '^[1-4]$' then
      if not exists (select 1 from permission_domains where domain = d.key) then
        raise exception 'unknown permission domain %', d.key using errcode = '22023';
      end if;
      insert into club_role_permissions (role_id, domain, level) values (v_role, d.key, d.value::smallint);
    end if;
  end loop;
  perform write_audit(case when p_role is null then 'role.create' else 'role.update' end, p_club, 'role', v_role,
                      jsonb_build_object('name', trim(p_name), 'perms', p_perms));
  return v_role;
end;
$$;

-- Archive a role: its assignments stop giving access at once (my_level skips archived roles).
create or replace function public.archive_club_role(p_role uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
begin
  select club_id into v_club from club_roles where id = p_role and archived_at is null;
  if v_club is null or not can_manage_roles(v_club) then
    raise exception 'not allowed to manage roles' using errcode = '42501';
  end if;
  if not is_club_admin(v_club) and role_is_sensitive(p_role) then
    raise exception 'only a club admin can change this role' using errcode = '42501';
  end if;
  update club_roles set archived_at = now() where id = p_role;
  perform write_audit('role.archive', v_club, 'role', p_role);
end;
$$;

create or replace function public.assign_club_role(
  p_club uuid, p_role uuid, p_user uuid, p_program uuid default null, p_team uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not can_manage_roles(p_club) then
    raise exception 'not allowed to manage roles' using errcode = '42501';
  end if;
  if not exists (select 1 from club_roles where id = p_role and club_id = p_club and archived_at is null) then
    raise exception 'role not in this club' using errcode = '22023';
  end if;
  if not is_club_admin(p_club) then
    if role_is_sensitive(p_role) then
      raise exception 'only a club admin can change this role' using errcode = '42501';
    end if;
    if p_user = auth.uid() then
      raise exception 'only a club admin can give roles to themselves' using errcode = '42501';
    end if;
  end if;
  if p_program is not null and p_team is not null then
    raise exception 'pick a program or a team, not both' using errcode = '22023';
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
  insert into club_staff (club_id, user_id, role, added_by) values (p_club, p_user, 'staff', auth.uid())
  on conflict (club_id, user_id) do nothing;
  insert into club_role_assignments (club_id, role_id, user_id, program_id, team_id)
  values (p_club, p_role, p_user, p_program, p_team)
  on conflict do nothing
  returning id into v_id;
  perform write_audit('role.assign', p_club, 'user', p_user,
                      jsonb_build_object('role_id', p_role, 'program_id', p_program, 'team_id', p_team));
  return v_id;
end;
$$;

create or replace function public.unassign_club_role(p_assignment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a club_role_assignments%rowtype;
begin
  select * into a from club_role_assignments where id = p_assignment;
  if not found or not can_manage_roles(a.club_id) then
    raise exception 'not allowed to manage roles' using errcode = '42501';
  end if;
  if not is_club_admin(a.club_id) and (role_is_sensitive(a.role_id) or a.user_id = auth.uid()) then
    raise exception 'only a club admin can change this role' using errcode = '42501';
  end if;
  delete from club_role_assignments where id = p_assignment;
  perform write_audit('role.unassign', a.club_id, 'user', a.user_id,
                      jsonb_build_object('role_id', a.role_id, 'program_id', a.program_id, 'team_id', a.team_id));
end;
$$;

-- Roles of a club with their levels and how many people hold each.
create or replace function public.club_roles_list(p_club uuid)
returns table (id uuid, name text, description text, is_template boolean, perms jsonb, holders int, sensitive boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.name, r.description, r.is_template,
         coalesce((select jsonb_object_agg(rp.domain, rp.level) from club_role_permissions rp where rp.role_id = r.id), '{}'::jsonb),
         (select count(*)::int from club_role_assignments a where a.role_id = r.id),
         role_is_sensitive(r.id)
  from club_roles r
  where r.club_id = p_club and r.archived_at is null
    and (can_manage_roles(p_club) or exists (select 1 from club_staff s where s.club_id = p_club and s.user_id = auth.uid()))
  order by r.sort, r.name;
$$;

create or replace function public.club_role_assignment_list(p_club uuid)
returns table (id uuid, role_id uuid, role_name text, user_id uuid, full_name text, program_id uuid, team_id uuid, scope_label text)
language sql stable security definer set search_path = public as $$
  select a.id, a.role_id, r.name, a.user_id, coalesce(nullif(pr.full_name, ''), 'ללא שם'), a.program_id, a.team_id,
         coalesce(t.name, case when cp.id is not null then 'כל ה' || cp.name end, 'כל המועדון')
  from club_role_assignments a
  join club_roles r on r.id = a.role_id and r.archived_at is null
  left join profiles pr on pr.id = a.user_id
  left join teams t on t.id = a.team_id
  left join club_programs cp on cp.id = a.program_id
  where a.club_id = p_club and (can_manage_roles(p_club) or a.user_id = auth.uid())
  order by r.sort, r.name, 5;
$$;

-- Invite a new person straight into a role.
create or replace function public.create_club_role_invite(
  p_club uuid, p_role uuid, p_program uuid default null, p_team uuid default null, p_note text default ''
)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not can_manage_roles(p_club) then
    raise exception 'not allowed to manage roles' using errcode = '42501';
  end if;
  if not exists (select 1 from club_roles where id = p_role and club_id = p_club and archived_at is null) then
    raise exception 'role not in this club' using errcode = '22023';
  end if;
  if not is_club_admin(p_club) and role_is_sensitive(p_role) then
    raise exception 'only a club admin can change this role' using errcode = '42501';
  end if;
  if p_program is not null and p_team is not null then
    raise exception 'pick a program or a team, not both' using errcode = '22023';
  end if;
  if p_program is not null and not exists (select 1 from club_programs where id = p_program and club_id = p_club) then
    raise exception 'program not in this club' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team and club_id = p_club) then
    raise exception 'team not in this club' using errcode = '22023';
  end if;
  v_code := new_club_invite_code();
  insert into club_invites (code, club_id, club_role, note, role_id, role_program_id, role_team_id)
  values (v_code, p_club, 'staff', left(coalesce(p_note, ''), 80), p_role, p_program, p_team);
  perform write_audit('club.invite', p_club, 'invite', null,
                      jsonb_build_object('role_id', p_role, 'program_id', p_program, 'team_id', p_team));
  return v_code;
end;
$$;

-- Same as before, plus: a role invite assigns the role; the user gets the club tools.
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
  if v_inv.role_id is not null and exists (select 1 from club_roles where id = v_inv.role_id and archived_at is null) then
    insert into club_role_assignments (club_id, role_id, user_id, program_id, team_id, assigned_by)
    values (v_inv.club_id, v_inv.role_id, auth.uid(), v_inv.role_program_id, v_inv.role_team_id, v_inv.created_by)
    on conflict do nothing;
  end if;
  update profiles set account_types = array(select distinct unnest(account_types || array['club']))
  where id = auth.uid() and not ('club' = any(account_types));
  update club_invites set used_by = auth.uid(), used_at = now() where code = v_inv.code;
  perform write_audit('club.join', v_inv.club_id, 'user', auth.uid(),
    jsonb_build_object('club_role', v_inv.club_role, 'team_id', v_inv.team_id, 'team_role', v_inv.team_role, 'role_id', v_inv.role_id));
  return v_inv.club_id;
end;
$$;

-- Every club the caller works in (workspace switcher). One account, many clubs.
create or replace function public.my_workspaces()
returns table (club_id uuid, name text, city text, status text, kind text, club_role text, roles text[], teams int)
language sql stable security definer set search_path = public as $$
  with mine as (
    select s.club_id from club_staff s where s.user_id = auth.uid()
    union
    select t.club_id from team_members m join teams t on t.id = m.team_id
    where m.user_id = auth.uid() and m.role <> 'parent' and t.club_id is not null
    union
    select a.club_id from club_role_assignments a where a.user_id = auth.uid()
  )
  select c.id, c.name, c.city, c.status, c.kind,
         coalesce((select s.role from club_staff s where s.club_id = c.id and s.user_id = auth.uid()), 'staff'),
         coalesce((select array_agg(distinct r.name) from club_role_assignments a join club_roles r on r.id = a.role_id
                   where a.club_id = c.id and a.user_id = auth.uid() and r.archived_at is null), '{}'),
         (select count(*)::int from teams t where t.club_id = c.id and t.archived_at is null)
  from clubs c join mine on mine.club_id = c.id
  where c.archived_at is null
  order by c.name;
$$;

-- What the caller may do club-wide in one club (to show / hide UI; the database still checks).
create or replace function public.my_club_access(p_club uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_admin', is_club_admin(p_club),
    'manage_roles', can_manage_roles(p_club),
    'domains', coalesce((select jsonb_object_agg(d.domain, (
        select max(x) from (values
          (case when is_club_admin(p_club) then 4 else 0 end),
          ((select max(g.level) from permission_grants g where g.club_id = p_club and g.user_id = auth.uid()
             and g.domain = d.domain and g.program_id is null and g.team_id is null)),
          ((select max(rp.level) from club_role_assignments a join club_roles r on r.id = a.role_id and r.archived_at is null
             join club_role_permissions rp on rp.role_id = a.role_id
             where a.club_id = p_club and a.user_id = auth.uid() and rp.domain = d.domain
               and a.program_id is null and a.team_id is null))
        ) v(x))) from permission_domains d), '{}'::jsonb)
  );
$$;

-- ======================================================= 3. sign-up RPCs

-- Clubs in a city (or matching the text), for the sign-up checklist.
create or replace function public.search_clubs_by_city(p_city text)
returns table (club_id uuid, name text, city text, kind text, status text, ifa_registered boolean,
               teams int, managed boolean, my_status text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := regexp_replace(trim(coalesce(p_city, '')), '[-־]+', ' ', 'g');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select c.id, c.name, c.city, c.kind, c.status, c.ifa_registered,
         (select count(*)::int from teams t where t.club_id = c.id and t.archived_at is null),
         exists (select 1 from club_staff s where s.club_id = c.id and s.role in ('owner', 'admin')),
         case
           when exists (select 1 from club_staff s where s.club_id = c.id and s.user_id = auth.uid()) then 'staff'
           when exists (select 1 from club_access_requests q where q.club_id = c.id and q.user_id = auth.uid() and q.status = 'pending') then 'pending'
         end
  from clubs c
  where c.archived_at is null and c.status <> 'suspended'
    and (c.status in ('verified', 'catalog', 'pending_verification')
         or exists (select 1 from club_staff s where s.club_id = c.id and s.user_id = auth.uid()))
    and (regexp_replace(c.city, '[-־]+', ' ', 'g') ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%')
  order by (regexp_replace(c.city, '[-־]+', ' ', 'g') ilike v_q) desc, (c.status = 'verified') desc, c.name
  limit 60;
end;
$$;

-- Teams of the picked clubs.
create or replace function public.signup_club_teams(p_clubs uuid[])
returns table (club_id uuid, team_id uuid, name text, age_group text, league text, program_kind text, has_staff boolean, from_ifa boolean)
language sql stable security definer set search_path = public as $$
  select t.club_id, t.id, t.name, t.age_group, t.league, cp.kind,
         exists (select 1 from team_members m where m.team_id = t.id and m.role in ('admin', 'coach')),
         exists (select 1 from ifa_teams i where i.team_id = t.id)
  from teams t
  join clubs c on c.id = t.club_id and c.archived_at is null and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where auth.uid() is not null
    and t.club_id = any (p_clubs[1:20]) and t.archived_at is null
  order by t.club_id, cp.kind nulls last, t.name;
$$;

-- People who review an access request for a club: its owner/admins, or platform admins if none.
create or replace function public.club_access_reviewers(p_club uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(user_id) from club_staff where club_id = p_club and role in ('owner', 'admin')),
    (select array_agg(user_id) from platform_admins),
    '{}');
$$;

create or replace function public.can_review_club_access(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin() or is_club_admin(p_club);
$$;

-- Ask to manage the picked clubs, or to coach the picked teams. One request per club.
create or replace function public.request_club_access(
  p_clubs uuid[], p_teams uuid[] default '{}', p_kind text default 'club_admin', p_team_role text default 'coach',
  p_role_title text default '', p_message text default '', p_phone text default ''
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
  v_teams uuid[];
  v_name text;
  v_who text;
  v_id uuid;
  v_n int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_kind not in ('club_admin', 'team_staff') then
    raise exception 'invalid request kind' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_clubs), 0) = 0 or cardinality(p_clubs) > 20 then
    raise exception 'pick between 1 and 20 clubs' using errcode = '22023';
  end if;
  select coalesce(nullif(full_name, ''), 'משתמש') into v_who from profiles where id = auth.uid();
  foreach v_club in array p_clubs loop
    select name into v_name from clubs where id = v_club and archived_at is null and status <> 'suspended';
    if v_name is null then
      raise exception 'club not found' using errcode = 'P0002';
    end if;
    select coalesce(array_agg(t.id), '{}') into v_teams
    from teams t where t.club_id = v_club and t.id = any (coalesce(p_teams, '{}')) and t.archived_at is null;
    if p_kind = 'team_staff' and cardinality(v_teams) = 0 then
      raise exception 'pick at least one team in %', v_name using errcode = '22023';
    end if;
    if p_kind = 'club_admin' and is_club_admin(v_club) then
      continue;
    end if;
    insert into club_access_requests (club_id, user_id, kind, team_ids, team_role, role_title, message, contact_phone)
    values (v_club, auth.uid(), p_kind, v_teams, coalesce(p_team_role, 'coach'),
            left(trim(coalesce(p_role_title, '')), 80), left(trim(coalesce(p_message, '')), 1000), left(trim(coalesce(p_phone, '')), 30))
    on conflict (club_id, user_id, kind) where status = 'pending' do update
      set team_ids = excluded.team_ids, team_role = excluded.team_role, role_title = excluded.role_title,
          message = excluded.message, contact_phone = excluded.contact_phone
    returning id into v_id;
    perform notify_users(club_access_reviewers(v_club), null, 'join_request',
      case when p_kind = 'club_admin' then 'בקשה לנהל את ' || v_name else 'בקשה להצטרף לצוות ' || v_name end,
      v_who || coalesce(nullif(' · ' || left(trim(coalesce(p_role_title, '')), 80), ' · '), ''), '#clubrequests', v_id, null);
    perform write_audit('club.access_request', v_club, 'club_access_request', v_id,
                        jsonb_build_object('kind', p_kind, 'teams', v_teams));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.cancel_club_access(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update club_access_requests set status = 'cancelled' where id = p_id and user_id = auth.uid() and status = 'pending';
$$;

create or replace function public.review_club_access(p_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  r club_access_requests%rowtype;
  v_club clubs%rowtype;
  v_team uuid;
  v_role text;
begin
  select * into r from club_access_requests where id = p_id and status = 'pending' for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not can_review_club_access(r.club_id) then
    raise exception 'not allowed to review requests for this club' using errcode = '42501';
  end if;
  if r.user_id = auth.uid() and not is_platform_admin() then
    raise exception 'not allowed to review your own request' using errcode = '42501';
  end if;
  select * into v_club from clubs where id = r.club_id;

  if p_approve then
    if r.kind = 'club_admin' then
      v_role := case when exists (select 1 from club_staff where club_id = r.club_id and role = 'owner') then 'admin' else 'owner' end;
      insert into club_staff (club_id, user_id, role, added_by) values (r.club_id, r.user_id, v_role, auth.uid())
      on conflict (club_id, user_id) do update set role = excluded.role where club_staff.role = 'staff';
      -- a platform admin approving the first owner of a catalog club verifies it
      if v_club.status = 'catalog' and is_platform_admin() then
        update clubs set status = 'verified' where id = r.club_id;
      end if;
    else
      insert into club_staff (club_id, user_id, role, added_by) values (r.club_id, r.user_id, 'staff', auth.uid())
      on conflict (club_id, user_id) do nothing;
      foreach v_team in array r.team_ids loop
        v_role := case when r.team_role = 'coach'
                        and not exists (select 1 from team_members where team_id = v_team and role = 'admin')
                       then 'admin' else r.team_role end;
        insert into team_members (team_id, user_id, role) values (v_team, r.user_id, v_role)
        on conflict (team_id, user_id) do update set role = excluded.role where team_members.role = 'parent';
      end loop;
    end if;
    update profiles set account_types = array(select distinct unnest(account_types || array['club']))
    where id = r.user_id and not ('club' = any(account_types));
  end if;

  update club_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(coalesce(p_note, ''), 300)
  where id = p_id;
  perform notify_users(array[r.user_id], null, 'join_decision',
    case when p_approve then 'הבקשה שלך ב' || v_club.name || ' אושרה' else 'הבקשה שלך ב' || v_club.name || ' לא אושרה' end,
    coalesce(nullif(p_note, ''), ''), case when p_approve then '#club/' || r.club_id else '#club' end, p_id, null);
  perform write_audit(case when p_approve then 'club.access_approve' else 'club.access_reject' end,
                      r.club_id, 'club_access_request', p_id, jsonb_build_object('user_id', r.user_id, 'kind', r.kind));
end;
$$;

create or replace function public.pending_club_access_requests()
returns table (id uuid, club_id uuid, club_name text, club_city text, club_status text, managed boolean,
               user_id uuid, requester text, kind text, teams jsonb, team_role text, role_title text,
               message text, contact_phone text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select q.id, c.id, c.name, c.city, c.status,
         exists (select 1 from club_staff s where s.club_id = c.id and s.role in ('owner', 'admin')),
         q.user_id, coalesce(nullif(p.full_name, ''), 'משתמש'), q.kind,
         coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)) from teams t where t.id = any (q.team_ids)), '[]'::jsonb),
         q.team_role, q.role_title, q.message, q.contact_phone, q.created_at
  from club_access_requests q
  join clubs c on c.id = q.club_id
  left join profiles p on p.id = q.user_id
  where q.status = 'pending'
    and (is_club_admin(q.club_id) or is_platform_admin())
  order by q.created_at;
$$;

create or replace function public.my_club_access_requests()
returns table (id uuid, club_id uuid, club_name text, kind text, teams jsonb, status text, review_note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select q.id, c.id, c.name, q.kind,
         coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)) from teams t where t.id = any (q.team_ids)), '[]'::jsonb),
         q.status, q.review_note, q.created_at
  from club_access_requests q join clubs c on c.id = q.club_id
  where q.user_id = auth.uid()
  order by q.created_at desc
  limit 50;
$$;

-- Open a club or academy by hand (not in the IFA). Refuses an obvious duplicate
-- of a known club in the same city: the user should ask to manage that one.
create or replace function public.create_club_manual(
  p_name text, p_city text, p_kind text default 'club', p_ifa_registered boolean default false, p_force boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_kind not in ('club', 'academy') then
    raise exception 'invalid club kind' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_city, ''))) = 0 then
    raise exception 'city is required' using errcode = '22023';
  end if;
  if not p_force and exists (
    select 1 from clubs where archived_at is null and status <> 'suspended'
      and lower(trim(name)) = lower(trim(p_name)) and lower(trim(city)) = lower(trim(p_city))
  ) then
    raise exception 'club already exists in this city' using errcode = '23505';
  end if;
  insert into clubs (name, city, kind, ifa_registered, source, created_by)
  values (trim(p_name), trim(p_city), p_kind, coalesce(p_ifa_registered, false), 'manual', auth.uid())
  returning id into v_club;
  insert into club_staff (club_id, user_id, role, added_by) values (v_club, auth.uid(), 'owner', auth.uid());
  if p_kind = 'academy' then
    insert into club_programs (club_id, kind, name) values (v_club, 'academy', 'אקדמיה');
  else
    insert into club_programs (club_id, kind, name) values (v_club, 'league', 'ליגה'), (v_club, 'academy', 'אקדמיה');
  end if;
  update profiles set account_types = array(select distinct unnest(account_types || array['club']))
  where id = auth.uid() and not ('club' = any(account_types));
  perform write_audit('club.create', v_club, 'club', v_club, jsonb_build_object('name', trim(p_name), 'kind', p_kind));
  return v_club;
end;
$$;

-- ------------------------------------- platform admin: catalog from IFA teams

-- IFA teams not yet in a club, grouped by the club part of their name.
-- The sponsor tag at the end ("צו פיוס" etc.) is dropped. Preview only.
create or replace function public.ifa_club_suggestions()
returns table (base_name text, venue_hint text, team_ids uuid[], team_names text[], existing_club uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
  return query
  with x as (
    select t.id, t.name, i.ifa_season_id, i.ifa_team_id,
           trim(regexp_replace(i.name, '\s+"[^"]*"\s*$', '')) as base
    from ifa_teams i join teams t on t.id = i.team_id
    where t.club_id is null and t.archived_at is null
  )
  select x.base,
         (select ifa_home_venue(min(x2.ifa_season_id), min(x2.ifa_team_id)) from x x2 where x2.base = x.base),
         array_agg(x.id order by x.name), array_agg(x.name order by x.name),
         (select c.id from clubs c where lower(trim(c.name)) = lower(x.base) and c.archived_at is null limit 1)
  from x
  group by x.base
  order by x.base;
end;
$$;

-- Put IFA teams into a club. p_club null -> create a catalog club (no owner yet).
create or replace function public.catalog_club_teams(
  p_club uuid, p_name text, p_city text, p_team_ids uuid[], p_kind text default 'club'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := p_club;
  v_program uuid;
begin
  if not (is_platform_admin() or is_trusted_context()) then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
  if v_club is null then
    if char_length(trim(coalesce(p_name, ''))) = 0 then
      raise exception 'club name is required' using errcode = '22023';
    end if;
    insert into clubs (name, city, kind, status, ifa_registered, source, ifa_club_name, created_by)
    values (trim(p_name), trim(coalesce(p_city, '')), coalesce(p_kind, 'club'), 'catalog', true, 'ifa', left(trim(p_name), 120), auth.uid())
    returning id into v_club;
    insert into club_programs (club_id, kind, name) values (v_club, 'league', 'ליגה'), (v_club, 'academy', 'אקדמיה');
  elsif not exists (select 1 from clubs where id = v_club) then
    raise exception 'club not found' using errcode = 'P0002';
  end if;
  select id into v_program from club_programs where club_id = v_club and kind = 'league' and archived_at is null order by created_at limit 1;
  update teams set club_id = v_club, program_id = v_program
  where id = any (coalesce(p_team_ids, '{}')) and club_id is null;
  perform write_audit('club.catalog', v_club, 'club', v_club, jsonb_build_object('teams', p_team_ids));
  return v_club;
end;
$$;

-- ============================================================ 9. notes

create table if not exists public.player_pro_notes (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  kind text not null default 'note'
    check (kind in ('note', 'improvement', 'progress', 'training_summary', 'performance')),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  author_id uuid references auth.users (id) on delete set null default auth.uid(),
  -- kept so the note still says who wrote it after the coach leaves
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null
);
create index if not exists player_pro_notes_player_idx on public.player_pro_notes (club_id, player_id, created_at desc);

-- The caller's level on a player's notes in one club. 0 for the player's own
-- parents / family, whatever other role they have.
create or replace function public.pro_notes_level(p_club uuid, p_player uuid)
returns smallint language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 0
    when exists (select 1 from player_guardians g where g.player_id = p_player and g.user_id = auth.uid()) then 0
    else greatest(
      case when is_club_admin(p_club) then 4 else 0 end,
      case when can_club(p_club, 'pro_notes', 4) then 4 when can_club(p_club, 'pro_notes', 3) then 3
           when can_club(p_club, 'pro_notes', 2) then 2 when can_club(p_club, 'pro_notes', 1) then 1 else 0 end,
      coalesce((select max(my_level(a.team_id, 'pro_notes')) from player_assignments a join teams t on t.id = a.team_id
                where a.player_id = p_player and a.ended_on is null and t.club_id = p_club), 0)
    ) end::smallint;
$$;

alter table public.player_pro_notes enable row level security;
drop policy if exists pro_notes_select on public.player_pro_notes;
create policy pro_notes_select on public.player_pro_notes for select to authenticated
  using (pro_notes_level(club_id, player_id) >= 1);
revoke all on public.player_pro_notes from anon, authenticated;
grant select on public.player_pro_notes to authenticated;

create or replace function public.add_pro_note(
  p_club uuid, p_player uuid, p_kind text, p_body text, p_team uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if pro_notes_level(p_club, p_player) < 2 then
    raise exception 'not allowed to write notes for this player' using errcode = '42501';
  end if;
  if not exists (select 1 from player_assignments a join teams t on t.id = a.team_id
                 where a.player_id = p_player and t.club_id = p_club) then
    raise exception 'player is not in this club' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team and club_id = p_club) then
    raise exception 'team not in this club' using errcode = '22023';
  end if;
  insert into player_pro_notes (club_id, player_id, team_id, kind, body, author_id, author_name)
  values (p_club, p_player, p_team, coalesce(p_kind, 'note'), trim(p_body), auth.uid(),
          coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'מאמן'))
  returning id into v_id;
  perform write_audit('pro_note.add', p_club, 'player', p_player, jsonb_build_object('note_id', v_id));
  return v_id;
end;
$$;

create or replace function public.update_pro_note(p_id uuid, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  n player_pro_notes%rowtype;
  v_level smallint;
begin
  select * into n from player_pro_notes where id = p_id and archived_at is null;
  if not found then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  v_level := pro_notes_level(n.club_id, n.player_id);
  if not (v_level >= 3 or (v_level >= 2 and n.author_id = auth.uid())) then
    raise exception 'not allowed to edit this note' using errcode = '42501';
  end if;
  update player_pro_notes set kind = coalesce(p_kind, kind), body = trim(p_body), updated_at = now() where id = p_id;
  perform write_audit('pro_note.update', n.club_id, 'player', n.player_id, jsonb_build_object('note_id', p_id));
end;
$$;

create or replace function public.archive_pro_note(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n player_pro_notes%rowtype;
  v_level smallint;
begin
  select * into n from player_pro_notes where id = p_id and archived_at is null;
  if not found then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  v_level := pro_notes_level(n.club_id, n.player_id);
  if not (v_level >= 4 or (v_level >= 2 and n.author_id = auth.uid())) then
    raise exception 'not allowed to archive this note' using errcode = '42501';
  end if;
  update player_pro_notes set archived_at = now(), archived_by = auth.uid() where id = p_id;
  perform write_audit('pro_note.archive', n.club_id, 'player', n.player_id, jsonb_build_object('note_id', p_id));
end;
$$;

-- ============================================================ grants / RLS

alter table public.club_access_requests enable row level security;
alter table public.club_roles enable row level security;
alter table public.club_role_permissions enable row level security;
alter table public.club_role_assignments enable row level security;

drop policy if exists club_access_requests_select on public.club_access_requests;
create policy club_access_requests_select on public.club_access_requests for select to authenticated
  using (user_id = auth.uid() or can_review_club_access(club_id));
drop policy if exists club_roles_select on public.club_roles;
create policy club_roles_select on public.club_roles for select to authenticated
  using (exists (select 1 from club_staff s where s.club_id = club_roles.club_id and s.user_id = auth.uid()) or is_platform_admin());
drop policy if exists club_role_permissions_select on public.club_role_permissions;
create policy club_role_permissions_select on public.club_role_permissions for select to authenticated
  using (exists (select 1 from club_roles r join club_staff s on s.club_id = r.club_id
                 where r.id = role_id and s.user_id = auth.uid()) or is_platform_admin());
drop policy if exists club_role_assignments_select on public.club_role_assignments;
create policy club_role_assignments_select on public.club_role_assignments for select to authenticated
  using (user_id = auth.uid() or can_manage_roles(club_id) or is_platform_admin());

revoke all on public.club_access_requests, public.club_roles, public.club_role_permissions, public.club_role_assignments
  from anon, authenticated;
grant select on public.club_access_requests, public.club_roles, public.club_role_permissions, public.club_role_assignments
  to authenticated;

revoke all on function
  public.can_manage_roles(uuid), public.role_is_sensitive(uuid),
  public.save_club_role(uuid, uuid, text, text, jsonb), public.archive_club_role(uuid),
  public.assign_club_role(uuid, uuid, uuid, uuid, uuid), public.unassign_club_role(uuid),
  public.club_roles_list(uuid), public.club_role_assignment_list(uuid),
  public.create_club_role_invite(uuid, uuid, uuid, uuid, text), public.my_workspaces(), public.my_club_access(uuid),
  public.search_clubs_by_city(text), public.signup_club_teams(uuid[]), public.can_review_club_access(uuid),
  public.request_club_access(uuid[], uuid[], text, text, text, text, text), public.cancel_club_access(uuid),
  public.review_club_access(uuid, boolean, text), public.pending_club_access_requests(), public.my_club_access_requests(),
  public.create_club_manual(text, text, text, boolean, boolean), public.ifa_club_suggestions(),
  public.catalog_club_teams(uuid, text, text, uuid[], text),
  public.pro_notes_level(uuid, uuid), public.add_pro_note(uuid, uuid, text, text, uuid),
  public.update_pro_note(uuid, text, text), public.archive_pro_note(uuid)
from public, anon;
grant execute on function
  public.can_manage_roles(uuid), public.role_is_sensitive(uuid),
  public.save_club_role(uuid, uuid, text, text, jsonb), public.archive_club_role(uuid),
  public.assign_club_role(uuid, uuid, uuid, uuid, uuid), public.unassign_club_role(uuid),
  public.club_roles_list(uuid), public.club_role_assignment_list(uuid),
  public.create_club_role_invite(uuid, uuid, uuid, uuid, text), public.my_workspaces(), public.my_club_access(uuid),
  public.search_clubs_by_city(text), public.signup_club_teams(uuid[]), public.can_review_club_access(uuid),
  public.request_club_access(uuid[], uuid[], text, text, text, text, text), public.cancel_club_access(uuid),
  public.review_club_access(uuid, boolean, text), public.pending_club_access_requests(), public.my_club_access_requests(),
  public.create_club_manual(text, text, text, boolean, boolean), public.ifa_club_suggestions(),
  public.catalog_club_teams(uuid, text, text, uuid[], text),
  public.pro_notes_level(uuid, uuid), public.add_pro_note(uuid, uuid, text, text, uuid),
  public.update_pro_note(uuid, text, text), public.archive_pro_note(uuid)
to authenticated;
revoke all on function public.seed_club_roles(uuid), public.club_access_reviewers(uuid), public.clubs_after_insert_roles()
  from public, anon, authenticated;

do $$
begin
  raise notice 'iplays: club sign-up, roles and notes installed (% clubs, % roles)',
    (select count(*) from public.clubs), (select count(*) from public.club_roles);
end;
$$;

commit;
