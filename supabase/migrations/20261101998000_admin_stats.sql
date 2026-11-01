-- iplays — usage stats for the Super Admin panel (#admin).
--
-- Run after 20261101996000_family_members.sql.
-- Rollback: supabase/rollback/20261101998000_admin_stats.down.sql
-- Additive only: one new table + three functions. Nothing is changed or removed.
--
-- "Online now" comes from a real heartbeat: while the app is open and visible,
-- it calls touch_presence() about once a minute, which stores only the user id
-- and the time. A user counts as online if seen in the last 5 minutes.
-- admin_stats() returns aggregate counts only (no names, no minors' details)
-- and only to platform admins.

begin;

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at desc);

-- No policies: the table is reached only through the functions below.
alter table public.user_presence enable row level security;

create or replace function public.touch_presence()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into user_presence (user_id, last_seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at
  -- at most one write per user every 30 seconds
  where user_presence.last_seen_at < now() - interval '30 seconds';
end;
$$;

-- Count from a table that may not exist yet in this database (optional features).
create or replace function public.admin_stats_count(p_sql text)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  v bigint;
begin
  execute p_sql into v;
  return coalesce(v, 0);
exception when undefined_table or undefined_column then
  return null;
end;
$$;
revoke all on function public.admin_stats_count(text) from public, anon, authenticated;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_staff_roles text[] := array['admin', 'coach', 'assistant_coach', 'instructor', 'team_manager'];
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'online_window_minutes', 5,
    -- users
    'users_total', (select count(*) from auth.users where deleted_at is null),
    'users_new_7d', (select count(*) from auth.users where deleted_at is null and created_at > now() - interval '7 days'),
    -- sign-ins (auth.users.last_sign_in_at: an actual login, not a token refresh)
    'signed_in_today', (select count(*) from auth.users where last_sign_in_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'),
    'signed_in_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'signed_in_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
    'signed_in_ever', (select count(*) from auth.users where last_sign_in_at is not null),
    -- presence (app opened)
    'online_now', (select count(*) from user_presence where last_seen_at > now() - interval '5 minutes'),
    'active_today', (select count(*) from user_presence where last_seen_at >= date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem'),
    'active_7d', (select count(*) from user_presence where last_seen_at > now() - interval '7 days'),
    -- teams
    'teams_total', (select count(*) from teams where archived_at is null),
    'teams_with_members', (select count(*) from teams t where t.archived_at is null
                             and exists (select 1 from team_members m where m.team_id = t.id)),
    'teams_with_staff', (select count(*) from teams t where t.archived_at is null
                           and exists (select 1 from team_members m where m.team_id = t.id and m.role = any(v_staff_roles))),
    'teams_in_club', (select count(*) from teams where archived_at is null and club_id is not null),
    'teams_linked_ifa', admin_stats_count('select count(distinct team_id) from ifa_teams where team_id is not null'),
    -- clubs
    'clubs_total', (select count(*) from clubs where archived_at is null),
    'clubs_verified', (select count(*) from clubs where archived_at is null and status = 'verified'),
    -- coaches / team staff
    'coaches_total', (select count(distinct m.user_id) from team_members m where m.role = any(v_staff_roles)),
    'coaches_active_7d', (select count(distinct m.user_id) from team_members m
                            join user_presence p on p.user_id = m.user_id
                           where m.role = any(v_staff_roles) and p.last_seen_at > now() - interval '7 days'),
    'coaches_online_now', (select count(distinct m.user_id) from team_members m
                             join user_presence p on p.user_id = m.user_id
                            where m.role = any(v_staff_roles) and p.last_seen_at > now() - interval '5 minutes'),
    'parents_total', (select count(distinct user_id) from team_members where role = 'parent'),
    -- carpools
    'rides_users', admin_stats_count($q$
        select count(distinct u) from (
          select driver_id as u from rides
          union select added_by from ride_passengers where added_by is not null
          union select created_by from ride_needs where created_by is not null
        ) x$q$),
    'rides_drivers', admin_stats_count('select count(distinct driver_id) from rides'),
    'rides_offered', admin_stats_count('select count(*) from rides'),
    'rides_seats_taken', admin_stats_count('select count(*) from ride_passengers'),
    'rides_teams', admin_stats_count('select count(distinct team_id) from rides')
  );
end;
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

commit;
