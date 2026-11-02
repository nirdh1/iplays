-- iplays — a child's profile moves with them between teams.
--
-- Run after 20261102900000_ifa_repeat_pairings.sql. Additive: one column,
-- three new functions, two functions replaced (same signatures). Nothing is
-- deleted.
--
-- Owner decision 2026-11-02: rosters come from the IFA once; afterwards
-- coaches and parents add and remove children themselves, and a child's data
-- (profile, career, history) stays with the child.
--
--  * end_player_assignment (staff "remove from team") now tells the child's
--    parents. The notification opens the child's career page, where a parent
--    records where the child moved (a club outside the app) or finds the new
--    team in the app.
--  * my_children(): every child the caller is a declared parent of, also a
--    child who is in no team right now (so the career stays reachable).
--  * request_join_with_child(): a parent asks a new team to take their child
--    WITH the existing profile, instead of creating a new child. Approved by
--    the team's staff (or right away when the team has no staff, as for any
--    declared parent). On approval the child gets an assignment in the new
--    team (in parallel to any current team; history kept) and the child's
--    family members join the team the way they joined the old one.
--  * review_join_request: such a request ("brings_player") is approved only by
--    staff (or a platform admin for a team with no staff), never by the
--    requesting parent themselves.

begin;

-- ------------------------------------------------- notification kind

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'notification_outbox_kind_check' and conrelid = 'public.notification_outbox'::regclass;
  select coalesce(array_agg(distinct m[1]), '{}') into v_kinds
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  v_kinds := v_kinds || array['player_removed'];
  select array_agg(distinct k order by k) into v_kinds from unnest(v_kinds) k;
  alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
  execute format('alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind = any (%L::text[])) not valid',
                 v_kinds);
end;
$$;

-- ------------------------------------------------- staff removes a child

create or replace function public.end_player_assignment(p_player uuid, p_team uuid, p_reason text default '', p_effective date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_a player_assignments%rowtype;
  v_next uuid;
  v_club uuid;
  v_name text;
  v_team text;
  v_parents uuid[];
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
  select club_id, name into v_club, v_team from teams where id = p_team;
  perform write_audit('player.end', v_club, 'player', p_player, jsonb_build_object('team', p_team));

  -- the child's parents hear about it, and can record where the child moved
  select trim(first_name || ' ' || last_name) into v_name from players where id = p_player;
  select coalesce(array_agg(user_id), '{}') into v_parents
  from player_guardians where player_id = p_player and relation = 'parent';
  perform notify_users(v_parents, p_team, 'player_removed',
    coalesce(v_name, 'הילד/ה') || ' הוצא/ה מהקבוצה ' || coalesce(v_team, ''),
    'הפרופיל, הקריירה וההיסטוריה נשמרים. אפשר לעדכן לאן עבר/ה, או לצרף לקבוצה חדשה עם אותו פרופיל.',
    'career/' || p_player, p_player, null);
end;
$$;

-- ------------------------------------------------- the caller's children

create or replace function public.my_children()
returns table (player_id uuid, first_name text, last_name text, birth_year int,
               team_ids uuid[], team_names text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.birth_year,
         coalesce(array_agg(t.id order by a.is_primary desc, t.name) filter (where t.id is not null), '{}'),
         coalesce(array_agg(t.name order by a.is_primary desc, t.name) filter (where t.id is not null), '{}')
  from player_guardians g
  join players p on p.id = g.player_id
  left join player_assignments a on a.player_id = p.id and a.ended_on is null
  left join teams t on t.id = a.team_id
  where g.user_id = auth.uid() and g.relation = 'parent'
  group by p.id, p.first_name, p.last_name, p.birth_year
  order by p.first_name;
$$;

-- ------------------------------------------------- join a team with the same profile

alter table public.join_requests
  add column if not exists brings_player boolean not null default false;

-- The child gets an assignment in the team (in parallel to any current team),
-- and the child's family joins the team as they joined the child's other teams.
create or replace function public.attach_child_to_team(p_player uuid, p_team uuid, p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_has_primary boolean;
  v_to uuid;
  g record;
begin
  if exists (select 1 from player_assignments where player_id = p_player and team_id = p_team and ended_on is null) then
    return;
  end if;
  perform 1 from player_assignments where player_id = p_player for update;
  select exists (select 1 from player_assignments where player_id = p_player and is_primary and ended_on is null)
  into v_has_primary;
  insert into player_assignments (player_id, team_id, is_primary, started_on)
  values (p_player, p_team, not v_has_primary, current_date)
  returning id into v_to;
  insert into player_transfers (player_id, kind, to_team_id, to_assignment_id, reason, effective_on)
  values (p_player, 'add', p_team, v_to, 'הצטרפות עם פרופיל קיים', current_date);
  for g in select user_id, relation from player_guardians where player_id = p_player loop
    insert into team_members (team_id, user_id, role, is_follower)
    values (p_team, g.user_id, 'parent', g.relation = 'family')
    on conflict (team_id, user_id) do update
      set is_follower = team_members.is_follower and excluded.is_follower;
  end loop;
  perform write_audit('player.join_with_profile', (select club_id from teams where id = p_team), 'player', p_player,
                      jsonb_build_object('team', p_team, 'request', p_request));
end;
$$;

create or replace function public.request_join_with_child(p_team uuid, p_player uuid, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  p players%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from teams where id = p_team and archived_at is null) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from player_assignments where player_id = p_player and team_id = p_team and ended_on is null) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  select * into p from players where id = p_player;
  insert into join_requests (team_id, user_id, player_id, child_first, child_last, birth_year, message,
                             relation, declaration, declared_at, brings_player)
  values (p_team, auth.uid(), p_player, left(p.first_name, 40), left(coalesce(p.last_name, ''), 40), p.birth_year,
          left(trim(coalesce(p_message, '')), 300), 'parent',
          'אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה', now(), true)
  returning id into v_id;

  -- no one manages the team yet: a declared parent gets in right away
  if not team_has_staff(p_team) then
    perform attach_child_to_team(p_player, p_team, v_id);
    update join_requests set status = 'approved', reviewed_at = now() where id = v_id;
    perform write_audit('join.auto_approve', (select club_id from teams where id = p_team), 'join_request', v_id,
                        jsonb_build_object('team_id', p_team, 'user_id', auth.uid(), 'brings_player', true));
  end if;
  return v_id;
end;
$$;

-- Same as 20261101996000_family_members.sql, plus: a request that brings an
-- existing child is approved by staff only, and attaches that child.
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
  if r.brings_player and not (
       can(r.team_id, 'staff', 2)
       or (not team_has_staff(r.team_id) and is_platform_admin())
     ) then
    raise exception 'not allowed to approve requests for this team' using errcode = '42501';
  end if;
  if r.relation = 'parent' and not r.brings_player and not (
       can(r.team_id, 'staff', 2)
       or (r.player_id is not null and is_player_parent(r.player_id))
       or (not team_has_staff(r.team_id) and is_platform_admin())
     ) then
    raise exception 'not allowed to approve requests for this team' using errcode = '42501';
  end if;
  if r.relation = 'family' and not is_player_parent(r.player_id) then
    raise exception 'only the child''s parent can approve followers' using errcode = '42501';
  end if;

  if p_approve and r.brings_player then
    perform attach_child_to_team(r.player_id, r.team_id, r.id);
    v_player := r.player_id;
  elsif p_approve then
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
                      jsonb_build_object('team_id', r.team_id, 'user_id', r.user_id, 'brings_player', r.brings_player));
end;
$$;

revoke all on function public.my_children(), public.attach_child_to_team(uuid, uuid, uuid),
  public.request_join_with_child(uuid, uuid, text) from public, anon;
revoke all on function public.attach_child_to_team(uuid, uuid, uuid) from authenticated;
grant execute on function public.my_children(), public.request_join_with_child(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
