-- iplays — a player owns their own profile.
--
-- Run after 20261103000000_guardian_removal.sql.
-- Rollback: supabase/rollback/20261103100000_player_owns_profile.down.sql
-- Additive: one new table, a new relation value and account type, new
-- functions, and a few functions replaced with the same signatures (except
-- my_children, which gets one more column). No data is deleted.
--
-- Owner decisions (2026-11-02):
--   * A player can sign up ("שחקן/ית"), find themselves in a roster and ask
--     "זה אני". After approval the player owns their profile, next to the
--     parents. There is NO minimum age (a child of 8 can own their profile).
--   * Who approves, by the birth year in the profile:
--       - under 18 (or no birth year): the child's declared parent. If the
--         child has no declared parent, the staff of a current team.
--       - 18 and over: the staff of a current team.
--       - nobody of the above exists: a platform admin.
--   * The player can leave a team and move to another team with all their
--     data (career, history, kit), like a parent can for a child.
--
-- What owning means here:
--   * a player_guardians row with relation 'self' (one per profile, and one
--     profile per user). The player sees the profile, the team, schedule,
--     matches and messages like family does, reports absences, edits
--     positions, outside clubs and self-reported goals/assists, leaves a
--     team, and asks a new team to take them with the profile.
--   * in the team the player is a member like a follower: sees everything,
--     does not add / change / delete trainings.
--   * NOT for the player: body metrics, BMI, goals, nutrition (parents only,
--     unchanged: they check relation = 'parent'), the coach's fitness tests
--     and assessments, payments, inviting or managing family members.
--   * A parent can disconnect the player's login (remove_family_member), and
--     the player can leave by themselves (leave_child).

begin;

-- ------------------------------------------------------------ relation 'self'

alter table public.player_guardians drop constraint if exists player_guardians_relation_check;
alter table public.player_guardians add constraint player_guardians_relation_check
  check (relation in ('parent', 'family', 'self'));

-- one owner-player per profile, one profile per player login
create unique index if not exists player_guardians_one_self_per_player
  on public.player_guardians (player_id) where relation = 'self';
create unique index if not exists player_guardians_one_self_per_user
  on public.player_guardians (user_id) where relation = 'self';

-- ------------------------------------------------------------ account type

alter table public.profiles drop constraint if exists profiles_account_types_check;
alter table public.profiles add constraint profiles_account_types_check
  check (account_types <@ array['parent', 'club', 'player']::text[] and cardinality(account_types) between 1 and 3);

-- ------------------------------------------------------------ helpers

create or replace function public.is_player_self(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid() and relation = 'self');
$$;

-- The child's parent, or the player themselves.
create or replace function public.is_player_owner(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid()
                 and relation in ('parent', 'self'));
$$;

-- Under 18 by birth year; no birth year counts as a minor.
create or replace function public.player_is_minor(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select extract(year from current_date)::int - birth_year < 18 from players where id = p_player), true);
$$;

-- Family members (parents too, and now the player) join the child's teams.
-- Only a parent is a full participant; everyone else is a follower.
create or replace function public.family_join_child_teams(p_player uuid, p_user uuid, p_relation text)
returns void language sql security definer set search_path = public as $$
  insert into team_members (team_id, user_id, role, is_follower)
  select a.team_id, p_user, 'parent', p_relation <> 'parent'
  from player_assignments a where a.player_id = p_player and a.ended_on is null
  on conflict (team_id, user_id) do update
    set is_follower = team_members.is_follower and excluded.is_follower;
$$;

-- Same as 20261102960000, but the player (relation 'self') joins as a follower too.
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
    values (p_team, g.user_id, 'parent', g.relation <> 'parent')
    on conflict (team_id, user_id) do update
      set is_follower = team_members.is_follower and excluded.is_follower;
  end loop;
  perform write_audit('player.join_with_profile', (select club_id from teams where id = p_team), 'player', p_player,
                      jsonb_build_object('team', p_team, 'request', p_request));
end;
$$;

-- ------------------------------------------------------------ notification kinds

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'notification_outbox_kind_check' and conrelid = 'public.notification_outbox'::regclass;
  select coalesce(array_agg(distinct m[1]), '{}') into v_kinds
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  v_kinds := v_kinds || array['self_claim', 'self_claim_decision', 'player_left'];
  select array_agg(distinct k order by k) into v_kinds from unnest(v_kinds) k;
  alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
  execute format('alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind = any (%L::text[])) not valid',
                 v_kinds);
end;
$$;

-- ------------------------------------------------------------ claims

create table if not exists public.player_self_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists player_self_claims_one_pending
  on public.player_self_claims (player_id, user_id) where status = 'pending';
create index if not exists player_self_claims_player on public.player_self_claims (player_id) where status = 'pending';

-- No direct access; everything goes through the functions below.
alter table public.player_self_claims enable row level security;

-- Who approves a claim on this profile right now: 'parent' | 'staff' | 'admin'.
create or replace function public.self_claim_approver(p_player uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when player_is_minor(p_player)
         and exists (select 1 from player_guardians where player_id = p_player and relation = 'parent') then 'parent'
    when exists (select 1 from player_assignments a where a.player_id = p_player and a.ended_on is null
                 and team_has_staff(a.team_id)) then 'staff'
    else 'admin'
  end;
$$;

create or replace function public.self_claim_approver_ids(p_player uuid)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare
  v_kind text := self_claim_approver(p_player);
  v_ids uuid[];
begin
  if v_kind = 'parent' then
    select coalesce(array_agg(user_id), '{}') into v_ids from player_guardians where player_id = p_player and relation = 'parent';
  elsif v_kind = 'staff' then
    select coalesce(array_agg(distinct x), '{}') into v_ids
    from player_assignments a, unnest(team_staff_ids(a.team_id)) x
    where a.player_id = p_player and a.ended_on is null;
  else
    select coalesce(array_agg(user_id), '{}') into v_ids from platform_admins;
  end if;
  return v_ids;
end;
$$;

create or replace function public.can_review_self_claim(p_player uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_kind text := self_claim_approver(p_player);
begin
  if v_kind = 'parent' then
    return is_player_parent(p_player);
  elsif v_kind = 'staff' then
    return exists (select 1 from player_assignments a where a.player_id = p_player and a.ended_on is null
                   and can(a.team_id, 'staff', 2));
  end if;
  return is_platform_admin();
end;
$$;

-- The caller says "this is me" about a profile.
create or replace function public.request_player_self(p_player uuid, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text;
  v_me text;
  v_team uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from players where id = p_player) then
    raise exception 'player not found' using errcode = 'P0002';
  end if;
  if is_player_self(p_player) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  if exists (select 1 from player_guardians where player_id = p_player and relation = 'self') then
    raise exception 'this profile already has its player' using errcode = '23505';
  end if;
  if exists (select 1 from player_guardians where user_id = auth.uid() and relation = 'self') then
    raise exception 'you already own a player profile' using errcode = '23505';
  end if;
  if exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid() and relation = 'parent') then
    raise exception 'a parent cannot claim the child''s own profile' using errcode = '42501';
  end if;
  if exists (select 1 from player_self_claims where player_id = p_player and user_id = auth.uid() and status = 'pending') then
    raise exception 'already requested' using errcode = '23505';
  end if;

  insert into player_self_claims (player_id, user_id, message)
  values (p_player, auth.uid(), left(trim(coalesce(p_message, '')), 300))
  returning id into v_id;

  update profiles set account_types = array(select distinct unnest(account_types || array['player']))
  where id = auth.uid() and not ('player' = any(account_types));

  select trim(first_name || ' ' || last_name) into v_name from players where id = p_player;
  select nullif(trim(full_name), '') into v_me from profiles where id = auth.uid();
  select team_id into v_team from player_assignments where player_id = p_player and ended_on is null
  order by is_primary desc limit 1;
  perform notify_users(self_claim_approver_ids(p_player), v_team, 'self_claim',
    coalesce(v_me, 'משתמש') || ' אומר/ת שהוא/היא ' || coalesce(v_name, 'השחקן/ית'),
    'אחרי אישור השחקן/ית יהיה/תהיה בעל/ת הפרופיל: יראה את הקבוצה והלוח ויעדכן את הקריירה. מדדי גוף ותשלומים נשארים להורים.',
    'home', p_player, null);
  perform write_audit('player.self_claim', (select club_id from teams where id = v_team), 'player', p_player,
                      jsonb_build_object('claim', v_id));
  return v_id;
end;
$$;

create or replace function public.cancel_player_self(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update player_self_claims set status = 'cancelled', reviewed_at = now()
  where id = p_id and user_id = auth.uid() and status = 'pending';
$$;

create or replace function public.review_player_self(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  c player_self_claims%rowtype;
  v_name text;
begin
  select * into c from player_self_claims where id = p_id for update;
  if not found or c.status <> 'pending' then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not can_review_self_claim(c.player_id) then
    raise exception 'not allowed to approve this request' using errcode = '42501';
  end if;

  if p_approve then
    if exists (select 1 from player_guardians where player_id = c.player_id and relation = 'self') then
      raise exception 'this profile already has its player' using errcode = '23505';
    end if;
    if exists (select 1 from player_guardians where user_id = c.user_id and relation = 'self') then
      raise exception 'this user already owns a player profile' using errcode = '23505';
    end if;
    insert into player_guardians (player_id, user_id, relation, kinship, can_report, can_rides, can_pay, added_by)
    values (c.player_id, c.user_id, 'self', 'השחקן/ית', true, false, false, auth.uid())
    on conflict (player_id, user_id) do update
      set relation = 'self', kinship = 'השחקן/ית', can_report = true, can_rides = false, can_pay = false;
    perform family_join_child_teams(c.player_id, c.user_id, 'self');
    -- other pending claims on this profile are void now
    update player_self_claims set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where player_id = c.player_id and status = 'pending' and id <> c.id;
  end if;

  update player_self_claims
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;

  select trim(first_name || ' ' || last_name) into v_name from players where id = c.player_id;
  perform notify_users(array[c.user_id], null, 'self_claim_decision',
    case when p_approve then 'אושר: הפרופיל של ' || coalesce(v_name, '') || ' שלך' else 'הבקשה לפרופיל של ' || coalesce(v_name, '') || ' לא אושרה' end,
    case when p_approve then 'אפשר לראות את הקבוצה והלוח ולעדכן את הקריירה.' else 'אפשר לפנות להורה או למאמן.' end,
    case when p_approve then 'career/' || c.player_id else 'home' end, c.player_id, null);
  perform write_audit(case when p_approve then 'player.self_approve' else 'player.self_reject' end, null, 'player', c.player_id,
                      jsonb_build_object('claim', p_id, 'user_id', c.user_id));
end;
$$;

-- Claims the caller can approve.
create or replace function public.pending_self_claims()
returns table (id uuid, player_id uuid, player_name text, birth_year int, team_names text[],
               requester text, requester_email text, message text, approver text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.player_id, trim(p.first_name || ' ' || p.last_name), p.birth_year,
         coalesce((select array_agg(t.name order by a.is_primary desc) from player_assignments a join teams t on t.id = a.team_id
                   where a.player_id = p.id and a.ended_on is null), '{}'),
         coalesce(nullif(trim(pr.full_name), ''), ''), coalesce(pr.email, ''), c.message,
         self_claim_approver(c.player_id), c.created_at
  from player_self_claims c
  join players p on p.id = c.player_id
  left join profiles pr on pr.id = c.user_id
  where c.status = 'pending' and can_review_self_claim(c.player_id)
  order by c.created_at;
$$;

-- The caller's own claims (pending ones, and the last decision).
create or replace function public.my_self_claims()
returns table (id uuid, player_id uuid, player_name text, status text, approver text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.player_id, trim(p.first_name || ' ' || p.last_name), c.status, self_claim_approver(c.player_id), c.created_at
  from player_self_claims c join players p on p.id = c.player_id
  where c.user_id = auth.uid() and c.status in ('pending', 'rejected')
    and c.created_at > now() - interval '30 days'
  order by c.created_at desc;
$$;

-- ------------------------------------------------------------ my children (+ my own profile)

drop function if exists public.my_children();
create function public.my_children()
returns table (player_id uuid, first_name text, last_name text, birth_year int,
               team_ids uuid[], team_names text[], is_self boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.birth_year,
         coalesce(array_agg(t.id order by a.is_primary desc, t.name) filter (where t.id is not null), '{}'),
         coalesce(array_agg(t.name order by a.is_primary desc, t.name) filter (where t.id is not null), '{}'),
         g.relation = 'self'
  from player_guardians g
  join players p on p.id = g.player_id
  left join player_assignments a on a.player_id = p.id and a.ended_on is null
  left join teams t on t.id = a.team_id
  where g.user_id = auth.uid() and g.relation in ('parent', 'self')
  group by p.id, p.first_name, p.last_name, p.birth_year, g.relation
  order by g.relation = 'self' desc, p.first_name;
$$;

-- ------------------------------------------------------------ moving between teams

-- Same as 20261102960000, and the player may ask for themselves.
create or replace function public.request_join_with_child(p_team uuid, p_player uuid, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_self boolean;
  p players%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not is_player_owner(p_player) then
    raise exception 'only the child''s parent or the player can do this' using errcode = '42501';
  end if;
  v_self := not is_player_parent(p_player);
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
          case when v_self then 'אני השחקן/ית ובעל/ת הפרופיל' else 'אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה' end,
          now(), true)
  returning id into v_id;

  -- no one manages the team yet: the profile's owner gets in right away
  if not team_has_staff(p_team) then
    perform attach_child_to_team(p_player, p_team, v_id);
    update join_requests set status = 'approved', reviewed_at = now() where id = v_id;
    perform write_audit('join.auto_approve', (select club_id from teams where id = p_team), 'join_request', v_id,
                        jsonb_build_object('team_id', p_team, 'user_id', auth.uid(), 'brings_player', true, 'self', v_self));
  end if;
  return v_id;
end;
$$;

-- Same as 20261102110000, and the player may say they left. When the player
-- does it, the parents hear about it too.
create or replace function public.parent_end_affiliation(
  p_player uuid, p_team uuid, p_moved_to text default '', p_effective date default current_date
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_a player_assignments%rowtype;
  v_next uuid;
  v_moved text := left(trim(coalesce(p_moved_to, '')), 80);
  v_name text;
  v_team text;
  v_self boolean;
  v_who text;
  v_parents uuid[];
begin
  if not is_player_owner(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_self := not is_player_parent(p_player);
  v_who := case when v_self then 'השחקן/ית' else 'הורה' end;
  if p_effective is null or p_effective > current_date + 60 then
    raise exception 'bad date' using errcode = '22023';
  end if;
  select * into v_a from player_assignments where player_id = p_player and team_id = p_team and ended_on is null for update;
  if v_a.id is null then
    raise exception 'player is not in this team' using errcode = 'P0002';
  end if;
  update player_assignments
  set ended_on = greatest(p_effective, started_on),
      end_reason = case when v_moved <> '' then 'עבר ל' || v_moved else 'עזב (דיווח ' || v_who || ')' end,
      is_primary = false
  where id = v_a.id;
  if v_a.is_primary then
    select id into v_next from player_assignments
    where player_id = p_player and ended_on is null order by started_on, created_at limit 1;
    if v_next is not null then
      update player_assignments set is_primary = true where id = v_next;
    end if;
  end if;
  insert into player_transfers (player_id, kind, from_team_id, from_assignment_id, reason, effective_on)
  values (p_player, 'end', p_team, v_a.id,
          case when v_moved <> '' then v_who || ': עבר ל' || v_moved else v_who || ': עזב' end, p_effective);
  if v_moved <> '' then
    insert into player_external_affiliations (player_id, name, kind, started_on)
    values (p_player, v_moved, 'club', p_effective);
  end if;

  select trim(first_name || ' ' || last_name) into v_name from players where id = p_player;
  select name into v_team from teams where id = p_team;
  perform notify_users(team_staff_ids(p_team), p_team, 'player_left',
    v_name || ' עזב/ה את ' || v_team,
    case when v_moved <> '' then 'לפי ה' || v_who || ': עבר/ה ל' || v_moved || '.' else 'דיווח של ה' || v_who || '.' end
      || ' ההיסטוריה נשמרת. הרישום בהתאחדות לא השתנה.',
    'myteam/' || p_team, p_player, 'team_updates');
  if v_self then
    select coalesce(array_agg(user_id), '{}') into v_parents from player_guardians where player_id = p_player and relation = 'parent';
    perform notify_users(v_parents, p_team, 'player_left',
      coalesce(v_name, 'הילד/ה') || ' סימן/ה שעזב/ה את ' || coalesce(v_team, ''),
      case when v_moved <> '' then 'לפי השחקן/ית: עבר/ה ל' || v_moved || '. ' else '' end || 'הפרופיל וההיסטוריה נשמרים.',
      'career/' || p_player, p_player, null);
  end if;
  perform write_audit('player.end_by_parent', (select club_id from teams where id = p_team), 'player', p_player,
                      jsonb_build_object('team', p_team, 'moved_to', v_moved, 'self', v_self));
end;
$$;

-- ------------------------------------------------------------ career edits by the player

create or replace function public.can_edit_player_profile(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_player_owner(p_player)
      or exists (select 1 from player_assignments a
                 where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'roster', 3));
$$;

-- Same as 20261102110000, plus is_owner / is_self.
create or replace function public.player_profile_extra(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not can_view_player(p_player) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'position', (select position from players where id = p_player),
    'secondary_positions', (select to_jsonb(secondary_positions) from players where id = p_player),
    'position_list', (select to_jsonb(position_list(t.sport)) from player_assignments a join teams t on t.id = a.team_id
                      where a.player_id = p_player and a.ended_on is null order by a.is_primary desc limit 1),
    'can_edit', can_edit_player_profile(p_player),
    'is_parent', is_player_parent(p_player),
    'is_self', is_player_self(p_player),
    'is_owner', is_player_owner(p_player),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', t.id, 'team_name', t.name, 'club', coalesce(c.name, nullif(t.club, '')),
               'program', p.kind, 'sport', t.sport, 'season', t.season,
               'started_on', a.started_on, 'ended_on', a.ended_on, 'end_reason', a.end_reason,
               'is_primary', a.is_primary, 'shirt_number', a.shirt_number)
             order by (a.ended_on is null) desc, a.started_on desc)
      from player_assignments a
      join teams t on t.id = a.team_id
      left join clubs c on c.id = t.club_id
      left join club_programs p on p.id = t.program_id
      where a.player_id = p_player), '[]'::jsonb),
    'external', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'started_on', x.started_on,
               'ended_on', x.ended_on, 'note', x.note)
             order by (x.ended_on is null) desc, x.started_on desc nulls last)
      from player_external_affiliations x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb)
  );
end;
$$;

-- Self-reported goals and assists: the player reports too, and sees them.
drop policy if exists player_self_stats_read on public.player_self_stats;
create policy player_self_stats_read on public.player_self_stats for select to authenticated
  using (deleted_at is null and (can_view_player_metrics(player_id) or is_player_self(player_id)));

create or replace function public.save_self_stat(
  p_player uuid, p_id uuid, p_match uuid, p_date date, p_opponent text,
  p_goals int, p_assists int, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_date date := p_date;
  v_opp text := nullif(btrim(coalesce(p_opponent, '')), '');
  v_match team_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not is_player_owner(p_player) then
    raise exception 'only the child''s parent or the player can report goals and assists';
  end if;
  if coalesce(p_goals, 0) < 0 or coalesce(p_goals, 0) > 30 or coalesce(p_assists, 0) < 0 or coalesce(p_assists, 0) > 30 then
    raise exception 'goals and assists must be between 0 and 30';
  end if;

  if p_match is not null then
    select tm.* into v_match from team_matches tm
    where tm.id = p_match and tm.status <> 'canceled' and tm.starts_at < now()
      and exists (select 1 from player_assignments a
                  where a.player_id = p_player and a.team_id = tm.team_id
                    and (tm.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
                    and (a.ended_on is null or (tm.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on));
    if not found then raise exception 'this game is not one of the child''s past games'; end if;
    v_date := (v_match.starts_at at time zone 'Asia/Jerusalem')::date;
    v_opp := left(v_match.opponent, 80);
  else
    if v_date is null or v_date > current_date then raise exception 'pick a date that is not in the future'; end if;
    if v_opp is null then raise exception 'opponent is required'; end if;
  end if;

  if v_id is null and p_match is not null then
    select id into v_id from player_self_stats
    where player_id = p_player and match_id = p_match and deleted_at is null;
  end if;

  if v_id is null then
    insert into player_self_stats (player_id, match_id, played_on, opponent, goals, assists, note)
    values (p_player, p_match, v_date, left(v_opp, 80), coalesce(p_goals, 0), coalesce(p_assists, 0),
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
    returning id into v_id;
  else
    update player_self_stats set match_id = p_match, played_on = v_date, opponent = left(v_opp, 80),
           goals = coalesce(p_goals, 0), assists = coalesce(p_assists, 0),
           note = nullif(left(btrim(coalesce(p_note, '')), 200), ''), updated_at = now()
    where id = v_id and player_id = p_player and deleted_at is null;
    if not found then raise exception 'report not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.remove_self_stat(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  select player_id into v_player from player_self_stats where id = p_id and deleted_at is null;
  if v_player is null or not is_player_owner(v_player) then raise exception 'report not found'; end if;
  update player_self_stats set deleted_at = now(), updated_at = now() where id = p_id;
end $$;

create or replace function public.player_self_stats_view(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_view_player_metrics(p_player) or is_player_self(p_player)) then return null; end if;
  return jsonb_build_object(
    'can_edit', is_player_owner(p_player),
    'totals', (select jsonb_build_object('games', count(*), 'goals', coalesce(sum(goals), 0), 'assists', coalesce(sum(assists), 0))
               from player_self_stats where player_id = p_player and deleted_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'match_id', s.match_id, 'date', s.played_on,
               'opponent', s.opponent, 'goals', s.goals, 'assists', s.assists, 'note', s.note,
               'team_name', t.name) order by s.played_on desc, s.created_at desc)
      from player_self_stats s
      left join team_matches tm on tm.id = s.match_id
      left join teams t on t.id = tm.team_id
      where s.player_id = p_player and s.deleted_at is null), '[]'::jsonb),
    'recent_games', case when is_player_owner(p_player) then coalesce((
      select jsonb_agg(jsonb_build_object('id', tm.id, 'date', (tm.starts_at at time zone 'Asia/Jerusalem')::date,
               'opponent', tm.opponent, 'team_name', t.name,
               'reported', exists (select 1 from player_self_stats s where s.player_id = p_player
                                   and s.match_id = tm.id and s.deleted_at is null))
             order by tm.starts_at desc)
      from team_matches tm join teams t on t.id = tm.team_id
      where tm.status <> 'canceled' and tm.starts_at < now() and tm.starts_at > now() - interval '200 days'
        and exists (select 1 from player_assignments a
                    where a.player_id = p_player and a.team_id = tm.team_id
                      and (tm.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
                      and (a.ended_on is null or (tm.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on))
      ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

-- ------------------------------------------------------------ grants

revoke all on function public.is_player_self(uuid), public.is_player_owner(uuid), public.player_is_minor(uuid),
  public.self_claim_approver(uuid), public.self_claim_approver_ids(uuid), public.can_review_self_claim(uuid),
  public.request_player_self(uuid, text), public.cancel_player_self(uuid), public.review_player_self(uuid, boolean),
  public.pending_self_claims(), public.my_self_claims(), public.my_children()
from public, anon;
revoke all on function public.self_claim_approver_ids(uuid) from authenticated;
grant execute on function public.is_player_self(uuid), public.is_player_owner(uuid), public.player_is_minor(uuid),
  public.self_claim_approver(uuid), public.can_review_self_claim(uuid),
  public.request_player_self(uuid, text), public.cancel_player_self(uuid), public.review_player_self(uuid, boolean),
  public.pending_self_claims(), public.my_self_claims(), public.my_children()
to authenticated;
revoke all on function public.family_join_child_teams(uuid, uuid, text), public.attach_child_to_team(uuid, uuid, uuid)
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
