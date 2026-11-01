-- iplays — family members and their permissions (second parent, grandparents, ...).
--
-- Run after 20261101995000_inbox_notifications.sql.
-- Rollback: supabase/rollback/20261101996000_family_members.down.sql
-- Additive only: new columns with defaults, one new table, new functions,
-- and a few replaced policies/functions. No data is deleted.
--
-- Until now a child's family was only "parents" and "followers" (relation
-- 'parent' / 'family' in player_guardians), a relative could only get in by
-- searching for the child and asking, and an approved follower became a
-- regular team member ('parent' role), so they could also add or delete
-- trainings (20261101960000).
--
-- From now on:
--   * Every family member of a child has a kinship label (אמא, סבתא, ...) and,
--     for non-parents, three permissions the child's parents switch on or off:
--       can_report: report absences for the child
--       can_rides:  take part in rides for the child (rides feature, later)
--       can_pay:    pay team payments for the child (payments feature, later)
--     Parents always have all of them. Seeing the child, the team schedule,
--     matches and results needs no permission.
--   * A parent invites family members with a one-time link (14 days), for one
--     or more of their children, as a parent or as a family member with
--     permissions chosen up front. Opening the link and accepting is enough;
--     no team staff approval.
--   * A request from someone who declares they are a parent of a child that
--     already has a parent can also be approved by that parent (staff still can).
--   * Followers stay in the team's member list but are marked is_follower:
--     they see the team, and cannot add / change / delete trainings.
--   * A parent can change a family member's permissions and remove them.
--     A parent cannot limit or remove the other parent; each person can
--     leave by themselves.

begin;

-- ------------------------------------------------------------ columns

alter table public.player_guardians
  add column if not exists kinship text not null default '' check (char_length(kinship) <= 30),
  add column if not exists can_report boolean not null default false,
  add column if not exists can_rides boolean not null default false,
  add column if not exists can_pay boolean not null default false,
  add column if not exists added_by uuid references auth.users (id) on delete set null;

alter table public.team_members
  add column if not exists is_follower boolean not null default false;

-- Existing followers: a 'parent' member whose only children in the team are
-- followed children (no child of theirs as parent there).
update public.team_members m set is_follower = true
where m.role = 'parent' and not m.is_follower
  and exists (select 1 from player_guardians g join player_assignments a on a.player_id = g.player_id and a.ended_on is null
              where g.user_id = m.user_id and a.team_id = m.team_id and g.relation = 'family')
  and not exists (select 1 from player_guardians g join player_assignments a on a.player_id = g.player_id and a.ended_on is null
                  where g.user_id = m.user_id and a.team_id = m.team_id and g.relation = 'parent');

-- ------------------------------------------------------------ helpers

-- A member of the team who is not only following a child there.
create or replace function public.is_team_participant(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where team_id = p_team and user_id = auth.uid()
                 and (role <> 'parent' or not is_follower));
$$;

-- What the caller may do for a child as family: 'view' | 'report' | 'rides' | 'pay'.
create or replace function public.family_can(p_player uuid, p_what text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from player_guardians g
    where g.player_id = p_player and g.user_id = auth.uid()
      and (g.relation = 'parent'
           or p_what = 'view'
           or (p_what = 'report' and g.can_report)
           or (p_what = 'rides' and g.can_rides)
           or (p_what = 'pay' and g.can_pay))
  );
$$;

-- Becoming a parent of a child clears the follower mark in the child's teams.
create or replace function public.guardian_sync_follower()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.relation = 'parent' then
    update team_members m set is_follower = false
    where m.user_id = new.user_id and m.is_follower
      and m.team_id in (select a.team_id from player_assignments a where a.player_id = new.player_id and a.ended_on is null);
  end if;
  return new;
end;
$$;
drop trigger if exists player_guardians_sync_follower on public.player_guardians;
create trigger player_guardians_sync_follower after insert or update of relation on public.player_guardians
  for each row execute function public.guardian_sync_follower();

-- Adds the caller as a member of the child's current teams.
create or replace function public.family_join_child_teams(p_player uuid, p_user uuid, p_relation text)
returns void language sql security definer set search_path = public as $$
  insert into team_members (team_id, user_id, role, is_follower)
  select a.team_id, p_user, 'parent', p_relation = 'family'
  from player_assignments a where a.player_id = p_player and a.ended_on is null
  on conflict (team_id, user_id) do update
    set is_follower = team_members.is_follower and excluded.is_follower;
$$;

-- ------------------------------------------------------------ policies

-- Trainings: followers don't edit the schedule (they still see it).
drop policy if exists sessions_insert_member on public.training_sessions;
create policy sessions_insert_member on public.training_sessions for insert to authenticated
  with check (is_team_participant(team_id) and created_by = auth.uid());
drop policy if exists sessions_update_member on public.training_sessions;
create policy sessions_update_member on public.training_sessions for update to authenticated
  using (is_team_participant(team_id)) with check (is_team_participant(team_id));
drop policy if exists sessions_delete_member on public.training_sessions;
create policy sessions_delete_member on public.training_sessions for delete to authenticated
  using (is_team_participant(team_id));

-- Absences: parents, and family members a parent allowed to report.
drop policy absences_select on public.player_absences;
create policy absences_select on public.player_absences for select to authenticated
  using (can(team_id, 'attendance', 1) or is_player_staff(player_id) or family_can(player_id, 'report'));
drop policy absences_insert on public.player_absences;
create policy absences_insert on public.player_absences for insert to authenticated
  with check (reported_by = auth.uid() and (family_can(player_id, 'report') or can(team_id, 'attendance', 2)));
drop policy absences_update on public.player_absences;
create policy absences_update on public.player_absences for update to authenticated
  using (can(team_id, 'attendance', 3) or family_can(player_id, 'report'))
  with check (can(team_id, 'attendance', 3) or family_can(player_id, 'report'));
drop policy absences_delete on public.player_absences;
create policy absences_delete on public.player_absences for delete to authenticated
  using (can(team_id, 'attendance', 3) or family_can(player_id, 'report'));

-- ------------------------------------------------------------ join requests

-- Same as 20261101950000, plus: the child's parent may approve another
-- declared parent on any team, and an approved follower joins the team as a
-- follower.
create or replace function public.review_join_request(p_id uuid, p_approve boolean)
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
  if r.relation = 'parent' and not (
       can(r.team_id, 'staff', 2)
       or (r.player_id is not null and is_player_parent(r.player_id))
       or (not team_has_staff(r.team_id) and is_platform_admin())
     ) then
    raise exception 'not allowed to approve requests for this team' using errcode = '42501';
  end if;
  if r.relation = 'family' and not is_player_parent(r.player_id) then
    raise exception 'only the child''s parent can approve followers' using errcode = '42501';
  end if;

  if p_approve then
    insert into team_members (team_id, user_id, role, is_follower) values (r.team_id, r.user_id, 'parent', r.relation = 'family')
    on conflict (team_id, user_id) do update set is_follower = team_members.is_follower and excluded.is_follower;
    v_player := r.player_id;
    if v_player is null then
      insert into players (team_id, first_name, last_name, birth_year, created_by)
      values (r.team_id, left(r.child_first, 40), left(r.child_last, 40), r.birth_year, r.user_id)
      returning id into v_player;
    end if;
    insert into player_guardians (player_id, user_id, relation, kinship, added_by)
    values (v_player, r.user_id, r.relation, case when r.relation = 'family' then left(r.message, 30) else '' end, auth.uid())
    on conflict (player_id, user_id) do update
      set relation = case when excluded.relation = 'parent' then 'parent' else player_guardians.relation end;
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

-- Requests waiting for the caller as the child's parent: followers, and
-- anyone else who declared they are a parent of the child.
create or replace function public.my_follow_requests()
returns table (id uuid, requester text, player_id uuid, child_name text, message text, created_at timestamptz, relation text)
language sql stable security definer set search_path = public as $$
  select r.id, coalesce(nullif(pr.full_name, ''), coalesce(pr.email, pr.phone, '')), r.player_id,
         trim(p.first_name || ' ' || p.last_name), r.message, r.created_at, r.relation
  from join_requests r
  join players p on p.id = r.player_id
  left join profiles pr on pr.id = r.user_id
  where r.status = 'pending'
    and r.user_id <> auth.uid()
    and exists (select 1 from player_guardians g where g.player_id = r.player_id and g.user_id = auth.uid() and g.relation = 'parent')
  order by r.created_at;
$$;

-- ------------------------------------------------------------ family list

-- Everyone in the family of the caller's children (the caller included).
create or replace function public.my_family()
returns table (player_id uuid, child_name text, user_id uuid, member_name text, relation text, kinship text,
               can_report boolean, can_rides boolean, can_pay boolean, is_me boolean, since timestamptz)
language sql stable security definer set search_path = public as $$
  select g.player_id, trim(p.first_name || ' ' || p.last_name), g.user_id,
         coalesce(nullif(pr.full_name, ''), pr.email, pr.phone, ''),
         g.relation, g.kinship,
         g.relation = 'parent' or g.can_report, g.relation = 'parent' or g.can_rides, g.relation = 'parent' or g.can_pay,
         g.user_id = auth.uid(), g.created_at
  from player_guardians mine
  join player_guardians g on g.player_id = mine.player_id
  join players p on p.id = g.player_id
  left join profiles pr on pr.id = g.user_id
  where mine.user_id = auth.uid()
  order by p.first_name, (g.relation <> 'parent'), g.created_at;
$$;

-- A parent sets a family member's label and permissions. A person may set
-- their own label. Another parent's permissions can't be limited.
create or replace function public.update_family_member(
  p_player uuid, p_user uuid, p_kinship text, p_report boolean default null, p_rides boolean default null, p_pay boolean default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  g player_guardians%rowtype;
begin
  select * into g from player_guardians where player_id = p_player and user_id = p_user for update;
  if not found then
    raise exception 'family member not found' using errcode = 'P0002';
  end if;
  if p_user <> auth.uid() and not is_player_parent(p_player) then
    raise exception 'only the child''s parent can change family members' using errcode = '42501';
  end if;
  update player_guardians set
    kinship = left(trim(coalesce(p_kinship, kinship)), 30),
    can_report = case when g.relation = 'family' and is_player_parent(p_player) then coalesce(p_report, can_report) else can_report end,
    can_rides  = case when g.relation = 'family' and is_player_parent(p_player) then coalesce(p_rides, can_rides) else can_rides end,
    can_pay    = case when g.relation = 'family' and is_player_parent(p_player) then coalesce(p_pay, can_pay) else can_pay end
  where player_id = p_player and user_id = p_user;
  perform write_audit('family.update', null, 'player', p_player,
                      jsonb_build_object('user_id', p_user, 'report', p_report, 'rides', p_rides, 'pay', p_pay));
end;
$$;

-- A parent removes a family member (not another parent) from one child.
-- The person leaves the child's teams when they no longer follow anyone there.
create or replace function public.remove_family_member(p_player uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can remove family members' using errcode = '42501';
  end if;
  if exists (select 1 from player_guardians where player_id = p_player and user_id = p_user and relation = 'parent') then
    raise exception 'a parent can''t be removed by another parent' using errcode = '42501';
  end if;
  delete from player_guardians where player_id = p_player and user_id = p_user;
  if not found then
    raise exception 'family member not found' using errcode = 'P0002';
  end if;
  delete from team_members m
  where m.user_id = p_user and m.role = 'parent' and m.is_follower
    and m.team_id in (select a.team_id from player_assignments a where a.player_id = p_player and a.ended_on is null)
    and not exists (select 1 from player_guardians g join player_assignments a on a.player_id = g.player_id and a.ended_on is null
                    where g.user_id = p_user and a.team_id = m.team_id);
  perform write_audit('family.remove', null, 'player', p_player, jsonb_build_object('user_id', p_user));
end;
$$;

-- ------------------------------------------------------------ invites

create table if not exists public.family_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  player_ids uuid[] not null check (cardinality(player_ids) between 1 and 10),
  relation text not null check (relation in ('parent', 'family')),
  kinship text not null default '' check (char_length(kinship) <= 30),
  can_report boolean not null default false,
  can_rides boolean not null default false,
  can_pay boolean not null default false,
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists family_invites_creator_idx on public.family_invites (created_by);

alter table public.family_invites enable row level security;
drop policy if exists family_invites_select on public.family_invites;
create policy family_invites_select on public.family_invites for select to authenticated
  using (created_by = auth.uid());
grant select on public.family_invites to authenticated;

create or replace function public.create_family_invite(
  p_players uuid[], p_relation text, p_kinship text default '',
  p_report boolean default false, p_rides boolean default false, p_pay boolean default false
)
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_player uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_relation not in ('parent', 'family') then
    raise exception 'relation must be parent or family' using errcode = '22023';
  end if;
  if p_players is null or cardinality(p_players) = 0 then
    raise exception 'choose at least one child' using errcode = '22023';
  end if;
  foreach v_player in array p_players loop
    if not is_player_parent(v_player) then
      raise exception 'only the child''s parent can invite family' using errcode = '42501';
    end if;
  end loop;
  if (select count(*) from family_invites where created_by = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many invites today' using errcode = '54000';
  end if;
  loop
    v_code := '';
    for i in 1..10 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from family_invites where code = v_code);
  end loop;
  insert into family_invites (code, player_ids, relation, kinship, can_report, can_rides, can_pay)
  values (v_code, (select array_agg(distinct x) from unnest(p_players) x), p_relation, left(trim(coalesce(p_kinship, '')), 30),
          p_relation = 'parent' or coalesce(p_report, false), p_relation = 'parent' or coalesce(p_rides, false),
          p_relation = 'parent' or coalesce(p_pay, false));
  return v_code;
end;
$$;

-- What an invite link offers (for the accept screen).
create or replace function public.family_invite_info(p_code text)
returns table (inviter text, relation text, kinship text, children text[], can_report boolean, can_rides boolean,
               can_pay boolean, status text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(pr.full_name, ''), ''), i.relation, i.kinship,
         array(select p.first_name from players p where p.id = any (i.player_ids) order by p.first_name),
         i.can_report, i.can_rides, i.can_pay,
         case when i.revoked_at is not null then 'revoked'
              when i.used_at is not null then case when i.used_by = auth.uid() then 'accepted' else 'used' end
              when i.expires_at < now() then 'expired'
              else 'valid' end
  from family_invites i
  left join profiles pr on pr.id = i.created_by
  where auth.uid() is not null and i.code = upper(trim(p_code));
$$;

create or replace function public.accept_family_invite(p_code text)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  i family_invites%rowtype;
  v_player uuid;
  v_done uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into i from family_invites where code = upper(trim(p_code)) for update;
  if not found or i.revoked_at is not null or i.expires_at < now() then
    raise exception 'invite not found or expired' using errcode = 'P0002';
  end if;
  if i.used_at is not null then
    if i.used_by = auth.uid() then
      return i.player_ids;
    end if;
    raise exception 'invite already used' using errcode = 'P0002';
  end if;
  if i.created_by = auth.uid() then
    raise exception 'this is your own invite' using errcode = '22023';
  end if;
  foreach v_player in array i.player_ids loop
    -- the inviter must still be the child's parent
    continue when not exists (select 1 from player_guardians where player_id = v_player and user_id = i.created_by and relation = 'parent');
    insert into player_guardians (player_id, user_id, relation, kinship, can_report, can_rides, can_pay, added_by)
    values (v_player, auth.uid(), i.relation, i.kinship, i.can_report, i.can_rides, i.can_pay, i.created_by)
    on conflict (player_id, user_id) do update set
      relation = case when excluded.relation = 'parent' then 'parent' else player_guardians.relation end,
      kinship = case when excluded.kinship <> '' then excluded.kinship else player_guardians.kinship end,
      can_report = player_guardians.can_report or excluded.can_report,
      can_rides = player_guardians.can_rides or excluded.can_rides,
      can_pay = player_guardians.can_pay or excluded.can_pay;
    perform family_join_child_teams(v_player, auth.uid(), i.relation);
    v_done := v_done || v_player;
  end loop;
  if cardinality(v_done) = 0 then
    raise exception 'invite not found or expired' using errcode = 'P0002';
  end if;
  update family_invites set used_by = auth.uid(), used_at = now() where id = i.id;
  perform write_audit('family.invite_accept', null, 'family_invite', i.id,
                      jsonb_build_object('relation', i.relation, 'players', v_done));
  return v_done;
end;
$$;

create or replace function public.revoke_family_invite(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update family_invites set revoked_at = now()
  where id = p_id and created_by = auth.uid() and used_at is null and revoked_at is null;
$$;

revoke all on function public.is_team_participant(uuid), public.family_can(uuid, text), public.guardian_sync_follower(),
  public.family_join_child_teams(uuid, uuid, text), public.my_family(),
  public.update_family_member(uuid, uuid, text, boolean, boolean, boolean), public.remove_family_member(uuid, uuid),
  public.create_family_invite(uuid[], text, text, boolean, boolean, boolean), public.family_invite_info(text),
  public.accept_family_invite(text), public.revoke_family_invite(uuid),
  public.my_follow_requests(), public.review_join_request(uuid, boolean)
from public, anon;
revoke all on function public.guardian_sync_follower(), public.family_join_child_teams(uuid, uuid, text) from authenticated;
grant execute on function public.is_team_participant(uuid), public.family_can(uuid, text), public.my_family(),
  public.update_family_member(uuid, uuid, text, boolean, boolean, boolean), public.remove_family_member(uuid, uuid),
  public.create_family_invite(uuid[], text, text, boolean, boolean, boolean), public.family_invite_info(text),
  public.accept_family_invite(text), public.revoke_family_invite(uuid),
  public.my_follow_requests(), public.review_join_request(uuid, boolean)
to authenticated;

commit;
