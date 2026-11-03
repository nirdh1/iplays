-- iplays — team contacts directory ("אלפון הקבוצה") and the player's
-- "אנשי קשר" area.
--
-- Run after 20261103200000_platform_admin_view_all.sql (any order relative to
-- the gallery / parents-edit-events / club-roles migrations). Needs only
-- migrations the project already runs: init, clubs and assignments,
-- permissions, family members, platform admin.
-- Rollback: supabase/rollback/20261103500000_team_contacts.down.sql
--
-- Built on the existing records, no second contact system:
--   * a parent's name and phone stay in profiles (full_name, phone); the
--     login e-mail stays in profiles.email.
--   * who is a parent / family member of which child stays in
--     player_guardians (relation 'parent' / 'family', kinship אמא / סבתא ...).
-- New, only what did not exist:
--   * contact_details:   per user (one row, used for all of their children):
--                        WhatsApp number (when not the phone), contact e-mail
--                        (when not the login e-mail), home address, and the
--                        four sharing switches. All switches start OFF.
--   * player_contacts:   the child's own phone + its sharing switch (OFF).
--   * player_extra_contacts: more people for a child (nanny, grandparent with
--                        no app account ...), entered by the child's parents.
--
-- Who sees what:
--   * full details of every family of a team: the team's managers
--     (team role admin / coach / team_manager), the club's owner / admin
--     (club_staff) for every team of the club, and the platform admin
--     (read only, owner decision 2026-11-02). Hiding a detail from other
--     parents never hides it from them.
--   * a parent of the team (team member who is not only a follower) sees the
--     names, and only the details each family switched on.
--   * a person always sees their own details; a child's family sees the
--     child's phone and the extra contacts of their child. The other parent
--     of the same child sees only what was shared (two homes are common).
--   * anyone else (another team, a follower of one child) sees nothing.
-- Enforced in the database: the three tables have RLS (own rows / managers
-- only) and no write grants; every other parent reads through
-- team_directory() / player_contact_book(), which leave hidden fields out
-- (null) instead of sending them to the app.
--
-- Also closes an old gap: profiles.phone and profiles.email were readable
-- by every team mate through the profiles table. From now on only the id,
-- name and account types columns are readable directly; a user reads their
-- own phone / e-mail with my_contact_card(). (Server functions that already
-- use them, e.g. a ride's driver phone for the ride's passengers or the
-- requester's e-mail on a join request for staff, are unchanged.)
--
-- Editing: a person edits only their own details; only a parent of the child
-- (relation 'parent') edits the child's phone, its sharing and the extra
-- contacts. Managers get no edit rights from this file.
-- Nothing here sends messages or e-mails: the app opens the phone's own
-- dialer / WhatsApp / mail app / Waze / Google Maps.

begin;

-- ------------------------------------------------------------- validation

-- '' or a phone number: digits, optional leading +, spaces / dashes inside.
create or replace function public.contact_phone_ok(p text)
returns boolean language sql immutable as $$
  select p = '' or (char_length(p) <= 20 and p ~ '^\+?[0-9][0-9 -]{5,18}[0-9]$');
$$;

-- '' or a plain e-mail address (no spaces, quotes, angle brackets).
create or replace function public.contact_email_ok(p text)
returns boolean language sql immutable as $$
  select p = '' or (char_length(p) <= 120 and p ~ '^[^@[:space:]<>"''(),;:\\]+@[^@[:space:]<>"''(),;:\\]+\.[^@[:space:]<>"''(),;:\\]+$');
$$;

-- ------------------------------------------------------------- tables

create table if not exists public.contact_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- null = the phone in profiles
  whatsapp_phone text check (whatsapp_phone is null or contact_phone_ok(whatsapp_phone)),
  -- null = the login e-mail in profiles
  contact_email text check (contact_email is null or contact_email_ok(contact_email)),
  street text not null default '' check (char_length(street) <= 80),
  house_number text not null default '' check (char_length(house_number) <= 10),
  city text not null default '' check (char_length(city) <= 40),
  share_phone boolean not null default false,
  share_whatsapp boolean not null default false,
  share_email boolean not null default false,
  share_address boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.player_contacts (
  player_id uuid primary key references public.players (id) on delete cascade,
  phone text not null default '' check (contact_phone_ok(phone)),
  share_phone boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_extra_contacts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 80),
  kinship text not null default '' check (char_length(kinship) <= 30),
  phone text not null default '' check (contact_phone_ok(phone)),
  email text not null default '' check (contact_email_ok(email)),
  share_phone boolean not null default false,
  share_whatsapp boolean not null default false,
  share_email boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists player_extra_contacts_player_idx on public.player_extra_contacts (player_id, created_at);

-- ------------------------------------------------------------- helpers

-- The child's current teams (assignments; players.team_id for an old row with none).
create or replace function public.contacts_player_teams(p_player uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.team_id from player_assignments a where a.player_id = p_player and a.ended_on is null
  union
  select p.team_id from players p
  where p.id = p_player and p.team_id is not null
    and not exists (select 1 from player_assignments a where a.player_id = p.id);
$$;

-- Sees the full details of every family of the team.
create or replace function public.contacts_full_access(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from team_members m where m.team_id = p_team and m.user_id = auth.uid()
                 and m.role in ('admin', 'coach', 'team_manager'))
      or exists (select 1 from teams t join club_staff s on s.club_id = t.club_id
                 where t.id = p_team and s.user_id = auth.uid() and s.role in ('owner', 'admin'));
$$;

-- Opens the team's directory: a parent / staff member of the team, or a manager.
create or replace function public.contacts_can_view_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select contacts_full_access(p_team) or is_team_participant(p_team);
$$;

create or replace function public.contacts_full_for_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from contacts_player_teams(p_player) t(team_id) where contacts_full_access(t.team_id));
$$;

-- A manager of a team where p_user is a parent / family member of a child.
create or replace function public.contacts_full_for_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from player_guardians g
                 where g.user_id = p_user and g.relation in ('parent', 'family')
                   and contacts_full_for_player(g.player_id));
$$;

-- Only a parent manages the child's phone, its sharing and the extra contacts.
create or replace function public.contacts_is_parent(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid() and relation = 'parent');
$$;

-- The people of one child, with hidden fields left out (null).
-- p_full = the caller manages one of the child's teams. Internal: not callable
-- from the app (it trusts p_full).
create or replace function public.contacts_people(p_player uuid, p_full boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  with fam as (select family_can(p_player, 'view') as yes),
  g as (
    select g.user_id, g.relation, g.kinship, g.created_at,
           nullif(btrim(pr.full_name), '') as full_name,
           nullif(btrim(coalesce(pr.phone, '')), '') as phone,
           coalesce(nullif(cd.whatsapp_phone, ''), nullif(btrim(coalesce(pr.phone, '')), '')) as whatsapp,
           coalesce(nullif(cd.contact_email, ''), nullif(btrim(coalesce(pr.email, '')), '')) as email,
           coalesce(cd.street, '') as street, coalesce(cd.house_number, '') as house_number, coalesce(cd.city, '') as city,
           coalesce(cd.share_phone, false) as s_phone, coalesce(cd.share_whatsapp, false) as s_whatsapp,
           coalesce(cd.share_email, false) as s_email, coalesce(cd.share_address, false) as s_address,
           g.user_id = auth.uid() as is_me,
           (p_full or g.user_id = auth.uid()) as see
    from player_guardians g
    join profiles pr on pr.id = g.user_id
    left join contact_details cd on cd.user_id = g.user_id
    where g.player_id = p_player and g.relation in ('parent', 'family')
  ),
  rows as (
    select case when relation = 'parent' then 0 else 1 end as ord, created_at,
      jsonb_build_object(
        'kind', relation,
        'user_id', user_id,
        'id', null,
        'name', coalesce(full_name, case when relation = 'parent' then 'הורה' else 'בן/בת משפחה' end),
        'kinship', kinship,
        'is_me', is_me,
        'phone', case when see or s_phone then phone end,
        'whatsapp', case when see or s_whatsapp then whatsapp end,
        'email', case when see or s_email then email end,
        'address', case when (see or s_address) and (street <> '' or city <> '')
                        then jsonb_build_object('street', street, 'house_number', house_number, 'city', city) end,
        'sharing', case when is_me then jsonb_build_object('phone', s_phone, 'whatsapp', s_whatsapp, 'email', s_email, 'address', s_address) end
      ) as j
    from g
    union all
    select 2, e.created_at,
      jsonb_build_object(
        'kind', 'extra',
        'user_id', null,
        'id', e.id,
        'name', e.full_name,
        'kinship', e.kinship,
        'is_me', false,
        'phone', case when (p_full or fam.yes or e.share_phone) then nullif(e.phone, '') end,
        'whatsapp', case when (p_full or fam.yes or e.share_whatsapp) then nullif(e.phone, '') end,
        'email', case when (p_full or fam.yes or e.share_email) then nullif(e.email, '') end,
        'address', null,
        'sharing', case when fam.yes then jsonb_build_object('phone', e.share_phone, 'whatsapp', e.share_whatsapp, 'email', e.share_email) end
      )
    from player_extra_contacts e, fam
    where e.player_id = p_player
  )
  select coalesce(jsonb_agg(j order by ord, created_at), '[]'::jsonb) from rows;
$$;

-- ------------------------------------------------------------- RLS

alter table public.contact_details enable row level security;
alter table public.player_contacts enable row level security;
alter table public.player_extra_contacts enable row level security;

drop policy if exists contact_details_select on public.contact_details;
create policy contact_details_select on public.contact_details for select to authenticated
  using (user_id = auth.uid() or contacts_full_for_user(user_id));

drop policy if exists player_contacts_select on public.player_contacts;
create policy player_contacts_select on public.player_contacts for select to authenticated
  using (family_can(player_id, 'view') or contacts_full_for_player(player_id));

drop policy if exists player_extra_contacts_select on public.player_extra_contacts;
create policy player_extra_contacts_select on public.player_extra_contacts for select to authenticated
  using (family_can(player_id, 'view') or contacts_full_for_player(player_id));

-- read only from the app; every change goes through the functions below
revoke all on public.contact_details, public.player_contacts, public.player_extra_contacts from anon, authenticated;
grant select on public.contact_details, public.player_contacts, public.player_extra_contacts to authenticated;

-- profiles: phone and e-mail are no longer readable by team mates directly.
-- (Add new profiles columns to this list when they should be readable.)
revoke select on public.profiles from authenticated;
grant select (id, full_name, created_at, account_types) on public.profiles to authenticated;

-- ------------------------------------------------------------- reads

-- The signed-in user's own card (also how the app reads its own phone / e-mail).
create or replace function public.my_contact_card()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'full_name', coalesce(pr.full_name, ''),
    'phone', coalesce(pr.phone, ''),
    'login_email', coalesce(pr.email, ''),
    'whatsapp_phone', coalesce(cd.whatsapp_phone, ''),
    'contact_email', coalesce(cd.contact_email, ''),
    'street', coalesce(cd.street, ''),
    'house_number', coalesce(cd.house_number, ''),
    'city', coalesce(cd.city, ''),
    'sharing', jsonb_build_object(
      'phone', coalesce(cd.share_phone, false), 'whatsapp', coalesce(cd.share_whatsapp, false),
      'email', coalesce(cd.share_email, false), 'address', coalesce(cd.share_address, false)))
  from profiles pr left join contact_details cd on cd.user_id = pr.id
  where pr.id = auth.uid();
$$;

-- The team's directory: players who have family in the app, with their people.
create or replace function public.team_directory(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_full boolean;
  v_players jsonb;
  v_without int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not contacts_can_view_team(p_team) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_full := contacts_full_access(p_team);

  with roster as (
    select a.player_id, a.shirt_number from player_assignments a where a.team_id = p_team and a.ended_on is null
    union
    select p.id, p.shirt_number from players p
    where p.team_id = p_team and not exists (select 1 from player_assignments a where a.player_id = p.id)
  ),
  kids as (
    select p.id, p.first_name, p.last_name, p.birth_year, r.shirt_number,
           exists (select 1 from player_guardians g where g.player_id = p.id and g.user_id = auth.uid()) as mine,
           exists (select 1 from player_guardians g where g.player_id = p.id and g.relation in ('parent', 'family')) as has_family
    from roster r join players p on p.id = r.player_id
    where p.archived_at is null
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'player_id', k.id,
      'first_name', k.first_name,
      'last_name', k.last_name,
      'shirt_number', k.shirt_number,
      'mine', k.mine,
      'phone', case when v_full or k.mine or coalesce(pc.share_phone, false) then nullif(pc.phone, '') end,
      'contacts', contacts_people(k.id, v_full)
    ) order by k.first_name, k.last_name) filter (where k.has_family or k.mine), '[]'::jsonb),
    count(*) filter (where not (k.has_family or k.mine))
  into v_players, v_without
  from kids k left join player_contacts pc on pc.player_id = k.id;

  return jsonb_build_object('full_access', v_full, 'players', v_players, 'without_family', v_without);
end;
$$;

-- One child's contacts for the "אנשי קשר" area of the player's profile.
-- null when the caller is not the child's family or a manager of the child.
create or replace function public.player_contact_book(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_mine boolean := family_can(p_player, 'view');
  v_full boolean := contacts_full_for_player(p_player);
  pc player_contacts;
begin
  if auth.uid() is null or not (v_mine or v_full) then return null; end if;
  select * into pc from player_contacts where player_id = p_player;
  return jsonb_build_object(
    'player_id', p_player,
    'full_access', v_full,
    'mine', v_mine,
    'can_edit', contacts_is_parent(p_player),
    'phone', coalesce(pc.phone, ''),
    'share_phone', case when v_mine then coalesce(pc.share_phone, false) end,
    'contacts', contacts_people(p_player, v_full)
  );
end;
$$;

-- ------------------------------------------------------------- writes

-- The caller's own details (name and phone are kept in profiles).
create or replace function public.save_my_contact_card(
  p_full_name text, p_phone text, p_whatsapp text, p_email text, p_street text, p_house text, p_city text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_wa text := btrim(coalesce(p_whatsapp, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if char_length(v_name) > 80 then raise exception 'name too long'; end if;
  if not contact_phone_ok(v_phone) or not contact_phone_ok(v_wa) then raise exception 'bad phone'; end if;
  if not contact_email_ok(v_email) then raise exception 'bad email'; end if;
  if char_length(btrim(coalesce(p_street, ''))) > 80 or char_length(btrim(coalesce(p_house, ''))) > 10
     or char_length(btrim(coalesce(p_city, ''))) > 40 then raise exception 'address too long'; end if;

  update profiles set phone = nullif(v_phone, ''),
                      full_name = case when v_name <> '' then v_name else full_name end
  where id = auth.uid();
  insert into contact_details (user_id, whatsapp_phone, contact_email, street, house_number, city, updated_at)
  values (auth.uid(), nullif(v_wa, ''), nullif(v_email, ''), btrim(coalesce(p_street, '')), btrim(coalesce(p_house, '')),
          btrim(coalesce(p_city, '')), now())
  on conflict (user_id) do update set
    whatsapp_phone = excluded.whatsapp_phone, contact_email = excluded.contact_email, street = excluded.street,
    house_number = excluded.house_number, city = excluded.city, updated_at = now();
end;
$$;

-- One sharing switch of the caller's own details: phone | whatsapp | email | address.
create or replace function public.set_my_contact_share(p_field text, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_field not in ('phone', 'whatsapp', 'email', 'address') or p_on is null then raise exception 'bad field'; end if;
  insert into contact_details (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update contact_details set
    share_phone = case when p_field = 'phone' then p_on else share_phone end,
    share_whatsapp = case when p_field = 'whatsapp' then p_on else share_whatsapp end,
    share_email = case when p_field = 'email' then p_on else share_email end,
    share_address = case when p_field = 'address' then p_on else share_address end,
    updated_at = now()
  where user_id = auth.uid();
end;
$$;

-- The child's own phone (parents only).
create or replace function public.save_player_phone(p_player uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_phone text := btrim(coalesce(p_phone, ''));
begin
  if not contacts_is_parent(p_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not contact_phone_ok(v_phone) then raise exception 'bad phone'; end if;
  insert into player_contacts (player_id, phone, updated_by, updated_at) values (p_player, v_phone, auth.uid(), now())
  on conflict (player_id) do update set phone = excluded.phone, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- Share the child's phone with the other parents (parents only).
create or replace function public.set_player_phone_share(p_player uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not contacts_is_parent(p_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_on is null then raise exception 'bad field'; end if;
  insert into player_contacts (player_id, share_phone, updated_by, updated_at) values (p_player, p_on, auth.uid(), now())
  on conflict (player_id) do update set share_phone = excluded.share_phone, updated_by = auth.uid(), updated_at = now();
end;
$$;

-- Add (p_id null) or edit an extra contact of a child (parents only).
create or replace function public.save_extra_contact(
  p_id uuid, p_player uuid, p_name text, p_kinship text, p_phone text, p_email text,
  p_share_phone boolean, p_share_whatsapp boolean, p_share_email boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_player uuid := p_player;
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_id is not null then
    select player_id into v_player from player_extra_contacts where id = p_id;
    if v_player is null then raise exception 'not found'; end if;
  end if;
  if v_player is null or not contacts_is_parent(v_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'name required'; end if;
  if char_length(btrim(coalesce(p_kinship, ''))) > 30 then raise exception 'kinship too long'; end if;
  if not contact_phone_ok(v_phone) then raise exception 'bad phone'; end if;
  if not contact_email_ok(v_email) then raise exception 'bad email'; end if;
  if v_id is null then
    insert into player_extra_contacts (player_id, full_name, kinship, phone, email, share_phone, share_whatsapp, share_email)
    values (v_player, v_name, btrim(coalesce(p_kinship, '')), v_phone, v_email,
            coalesce(p_share_phone, false), coalesce(p_share_whatsapp, false), coalesce(p_share_email, false))
    returning id into v_id;
  else
    update player_extra_contacts set full_name = v_name, kinship = btrim(coalesce(p_kinship, '')), phone = v_phone,
      email = v_email, share_phone = coalesce(p_share_phone, false), share_whatsapp = coalesce(p_share_whatsapp, false),
      share_email = coalesce(p_share_email, false), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_extra_contact(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  select player_id into v_player from player_extra_contacts where id = p_id;
  if v_player is null or not contacts_is_parent(v_player) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from player_extra_contacts where id = p_id;
end;
$$;

-- ------------------------------------------------------------- grants

revoke all on function public.contact_phone_ok(text), public.contact_email_ok(text),
  public.contacts_player_teams(uuid), public.contacts_full_access(uuid), public.contacts_can_view_team(uuid),
  public.contacts_full_for_player(uuid), public.contacts_full_for_user(uuid), public.contacts_is_parent(uuid),
  public.contacts_people(uuid, boolean), public.my_contact_card(), public.team_directory(uuid),
  public.player_contact_book(uuid),
  public.save_my_contact_card(text, text, text, text, text, text, text), public.set_my_contact_share(text, boolean),
  public.save_player_phone(uuid, text), public.set_player_phone_share(uuid, boolean),
  public.save_extra_contact(uuid, uuid, text, text, text, text, boolean, boolean, boolean),
  public.remove_extra_contact(uuid)
from public, anon;
-- contacts_people trusts its p_full argument: server use only
revoke all on function public.contacts_people(uuid, boolean), public.contacts_player_teams(uuid) from authenticated;
grant execute on function public.contact_phone_ok(text), public.contact_email_ok(text),
  public.contacts_full_access(uuid), public.contacts_can_view_team(uuid),
  public.contacts_full_for_player(uuid), public.contacts_full_for_user(uuid), public.contacts_is_parent(uuid),
  public.my_contact_card(), public.team_directory(uuid), public.player_contact_book(uuid),
  public.save_my_contact_card(text, text, text, text, text, text, text), public.set_my_contact_share(text, boolean),
  public.save_player_phone(uuid, text), public.set_player_phone_share(uuid, boolean),
  public.save_extra_contact(uuid, uuid, text, text, text, text, boolean, boolean, boolean),
  public.remove_extra_contact(uuid)
to authenticated;

commit;
