-- iplays — growth metrics for the Super Admin panel (#adminmetrics).
--
-- Rollback: supabase/rollback/20261103700000_admin_growth_metrics.down.sql
-- Additive only: two tracking tables + functions. Nothing existing is changed
-- or removed. Safe to run more than once. Depends only on the base schema
-- (platform_admins / is_platform_admin, clubs, teams, players,
-- player_guardians, team_members, ifa_players). Optional features (gallery,
-- contacts, feedback, rides, absences…) are counted only if their tables exist.
--
-- Activity tracking: while the app is open and visible it calls
-- touch_presence() about once a minute. That stores only the user id, the last
-- time seen, and one row per user per (Israel) day. DAU / WAU / MAU and
-- retention are computed from those daily rows. History before this migration
-- is seeded from what Supabase already has (sign-up time, last sign-in, open
-- sessions and the auth audit log where present), so early numbers undercount.
--
-- Everything is read through admin_growth_metrics(), which refuses anyone who
-- is not a platform admin. The tables have RLS on and no policies.

begin;

-- ------------------------------------------------------------ tracking tables

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at desc);
alter table public.user_presence enable row level security;

create table if not exists public.user_activity_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
create index if not exists user_activity_days_day_idx on public.user_activity_days (day);
alter table public.user_activity_days enable row level security;

-- Today's date in Israel.
create or replace function public.il_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

-- Heartbeat. Replaces the earlier version (if any) and also records the day.
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
  insert into user_activity_days (user_id, day) values (auth.uid(), il_today())
  on conflict do nothing;
end;
$$;
revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

-- ------------------------------------------------------------ seed history

insert into public.user_activity_days (user_id, day)
select id, (created_at at time zone 'Asia/Jerusalem')::date from auth.users
where deleted_at is null and created_at is not null
on conflict do nothing;

insert into public.user_activity_days (user_id, day)
select id, (last_sign_in_at at time zone 'Asia/Jerusalem')::date from auth.users
where deleted_at is null and last_sign_in_at is not null
on conflict do nothing;

do $$
begin
  -- open sessions: when each was started and last refreshed
  insert into public.user_activity_days (user_id, day)
  select s.user_id, (t at time zone 'Asia/Jerusalem')::date
  from auth.sessions s
  cross join lateral (values (s.created_at), (s.updated_at)) v(t)
  where t is not null and exists (select 1 from auth.users u where u.id = s.user_id)
  on conflict do nothing;
exception when others then
  raise notice 'auth.sessions not readable, skipped (%)', sqlerrm;
end;
$$;

do $$
begin
  -- auth audit log: login events
  insert into public.user_activity_days (user_id, day)
  select (a.payload ->> 'actor_id')::uuid, (a.created_at at time zone 'Asia/Jerusalem')::date
  from auth.audit_log_entries a
  where a.payload ->> 'action' in ('login', 'token_refreshed')
    and a.payload ->> 'actor_id' ~ '^[0-9a-f-]{36}$'
    and exists (select 1 from auth.users u where u.id = (a.payload ->> 'actor_id')::uuid)
  on conflict do nothing;
exception when others then
  raise notice 'auth.audit_log_entries not readable, skipped (%)', sqlerrm;
end;
$$;

-- ------------------------------------------------------------ helpers

-- A count from a table that may not exist in this database (optional feature).
create or replace function public.admin_metric_count(p_sql text)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  v bigint;
begin
  execute p_sql into v;
  return coalesce(v, 0);
exception when undefined_table or undefined_column or undefined_function then
  return null;
end;
$$;
revoke all on function public.admin_metric_count(text) from public, anon, authenticated;

-- ------------------------------------------------------------ the report

create or replace function public.admin_growth_metrics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 7), 120);
  v_today date := il_today();
  v_from date;
  v_staff text[] := array['admin', 'coach', 'assistant_coach', 'instructor', 'team_manager'];
  v_out jsonb;
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
  v_from := v_today - (v_days - 1);

  with
  -- parents = users who declared themselves parent/family of a child
  _gm_parent_first as (
    select g.user_id, min((g.created_at at time zone 'Asia/Jerusalem')::date) as first_day
    from player_guardians g
    join auth.users u on u.id = g.user_id and u.deleted_at is null
    where g.relation in ('parent', 'family')
    group by g.user_id
  ),
  -- players linked to a real user (parent, family or the player themself)
  _gm_player_first as (
    select g.player_id, min((g.created_at at time zone 'Asia/Jerusalem')::date) as first_day
    from player_guardians g
    join players p on p.id = g.player_id and p.archived_at is null
    group by g.player_id
  ),
  -- players that came from the IFA roster import
  _gm_imported as (
    select distinct i.player_id from ifa_players i
    join players p on p.id = i.player_id and p.archived_at is null
    where i.player_id is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'today', v_today,
    'days', v_days,
    'tracking_since', (select min(day) from user_activity_days),

    -- ---------------------------------------------------------- totals
    'totals', jsonb_build_object(
      'users', (select count(*) from auth.users where deleted_at is null),
      'parents', (select count(*) from _gm_parent_first),
      'staff', (select count(distinct user_id) from team_members where role = any(v_staff)),
      'self_players', (select count(distinct user_id) from player_guardians where relation = 'self'),
      'players', (select count(*) from players where archived_at is null),
      'players_imported', (select count(*) from _gm_imported),
      'players_imported_linked', (select count(*) from _gm_imported i join _gm_player_first f using (player_id)),
      'players_added_in_app', (select count(*) from players p where p.archived_at is null
                                 and not exists (select 1 from _gm_imported i where i.player_id = p.id)),
      'players_linked', (select count(*) from _gm_player_first),
      'teams', (select count(*) from teams where archived_at is null),
      'teams_with_parent', (select count(distinct t.id) from teams t
                              join team_members m on m.team_id = t.id and m.role = 'parent'
                             where t.archived_at is null),
      'teams_with_active_parent_7d', (select count(distinct t.id) from teams t
                              join team_members m on m.team_id = t.id and m.role = 'parent'
                              join user_activity_days d on d.user_id = m.user_id and d.day > v_today - 7
                             where t.archived_at is null),
      'teams_with_staff', (select count(distinct t.id) from teams t
                              join team_members m on m.team_id = t.id and m.role = any(v_staff)
                             where t.archived_at is null),
      'clubs', (select count(*) from clubs where archived_at is null),
      'clubs_verified', (select count(*) from clubs where archived_at is null and status = 'verified'),
      'clubs_with_admin', (select count(distinct c.id) from clubs c
                             join club_staff s on s.club_id = c.id and s.role in ('owner', 'admin')
                            where c.archived_at is null),
      'clubs_with_teams', (select count(distinct c.id) from clubs c
                             join teams t on t.club_id = c.id and t.archived_at is null
                            where c.archived_at is null)
    ),

    -- ---------------------------------------------------------- activity
    'activity', jsonb_build_object(
      'online_now', (select count(*) from user_presence where last_seen_at > now() - interval '5 minutes'),
      'dau', (select count(distinct user_id) from user_activity_days where day = v_today),
      'dau_yesterday', (select count(distinct user_id) from user_activity_days where day = v_today - 1),
      'wau', (select count(distinct user_id) from user_activity_days where day > v_today - 7),
      'wau_prev', (select count(distinct user_id) from user_activity_days where day > v_today - 14 and day <= v_today - 7),
      'mau', (select count(distinct user_id) from user_activity_days where day > v_today - 30),
      'signed_in_today', (select count(*) from auth.users where deleted_at is null
                            and (last_sign_in_at at time zone 'Asia/Jerusalem')::date = v_today),
      'signed_in_7d', (select count(*) from auth.users where deleted_at is null and last_sign_in_at > now() - interval '7 days')
    ),

    -- ---------------------------------------------------------- daily series
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'new_users', (select count(*) from auth.users u where u.deleted_at is null
                        and (u.created_at at time zone 'Asia/Jerusalem')::date = d.day),
        'users', (select count(*) from auth.users u where u.deleted_at is null
                    and (u.created_at at time zone 'Asia/Jerusalem')::date <= d.day),
        'new_parents', (select count(*) from _gm_parent_first f where f.first_day = d.day),
        'parents', (select count(*) from _gm_parent_first f where f.first_day <= d.day),
        'new_linked_players', (select count(*) from _gm_player_first f where f.first_day = d.day),
        'linked_players', (select count(*) from _gm_player_first f where f.first_day <= d.day),
        'active', (select count(*) from user_activity_days a where a.day = d.day)
      ) order by d.day), '[]'::jsonb)
      from generate_series(v_from, v_today, interval '1 day') as d0(ts)
      cross join lateral (select d0.ts::date as day) d
    ),

    -- ---------------------------------------------------------- retention
    -- of users who signed up 8-90 days ago: came back on days 1-7 after sign-up;
    -- of users who signed up 29-120 days ago: came back on days 22-28.
    'retention', jsonb_build_object(
      'w1_cohort', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date between v_today - 90 and v_today - 8),
      'w1_returned', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date between v_today - 90 and v_today - 8
                      and exists (select 1 from user_activity_days a where a.user_id = u.id
                                    and a.day between (u.created_at at time zone 'Asia/Jerusalem')::date + 1
                                                  and (u.created_at at time zone 'Asia/Jerusalem')::date + 7)),
      'w4_cohort', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date between v_today - 120 and v_today - 29),
      'w4_returned', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date between v_today - 120 and v_today - 29
                      and exists (select 1 from user_activity_days a where a.user_id = u.id
                                    and a.day between (u.created_at at time zone 'Asia/Jerusalem')::date + 22
                                                  and (u.created_at at time zone 'Asia/Jerusalem')::date + 28))
    ),

    -- ---------------------------------------------------------- funnel (last N days' sign-ups)
    'funnel', jsonb_build_object(
      'signed_up', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date >= v_from),
      'joined_team', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date >= v_from
                      and exists (select 1 from team_members m where m.user_id = u.id)),
      'linked_child', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date >= v_from
                      and exists (select 1 from player_guardians g where g.user_id = u.id)),
      'active_7d', (select count(*) from auth.users u where u.deleted_at is null
                      and (u.created_at at time zone 'Asia/Jerusalem')::date >= v_from
                      and exists (select 1 from user_activity_days a where a.user_id = u.id and a.day > v_today - 7)),
      'team_invites_created', admin_metric_count(format(
          'select count(*) from invites where (created_at at time zone ''Asia/Jerusalem'')::date >= %L', v_from)),
      'family_invites_created', admin_metric_count(format(
          'select count(*) from family_invites where (created_at at time zone ''Asia/Jerusalem'')::date >= %L', v_from)),
      'family_invites_used', admin_metric_count(format(
          'select count(*) from family_invites where used_at is not null and (created_at at time zone ''Asia/Jerusalem'')::date >= %L', v_from))
    ),

    -- ---------------------------------------------------------- feature use (distinct users, last 30 days)
    'features', jsonb_build_object(
      'contacts', admin_metric_count('select count(*) from contact_details where updated_at > now() - interval ''30 days'''),
      'gallery', admin_metric_count('select count(distinct created_by) from team_albums where created_at > now() - interval ''30 days'''),
      'feedback', admin_metric_count('select count(distinct user_id) from app_feedback where created_at > now() - interval ''30 days'''),
      'rides', admin_metric_count('select count(distinct driver_id) from rides where created_at > now() - interval ''30 days'''),
      'trainings', admin_metric_count('select count(distinct created_by) from training_sessions where created_at > now() - interval ''30 days'''),
      'absences', admin_metric_count('select count(distinct reported_by) from player_absences where created_at > now() - interval ''30 days'''),
      'self_stats', admin_metric_count('select count(distinct created_by) from player_self_stats where created_at > now() - interval ''30 days''')
    ),

    -- ---------------------------------------------------------- top teams by parents
    'top_teams', (
      select coalesce(jsonb_agg(x order by (x->>'parents')::int desc, x->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'club', coalesce(c.name, nullif(t.club, '')),
          'parents', count(distinct m.user_id),
          'active_7d', count(distinct m.user_id) filter (where exists (
              select 1 from user_activity_days a where a.user_id = m.user_id and a.day > v_today - 7)),
          'players', (select count(*) from players p where p.team_id = t.id and p.archived_at is null),
          'players_linked', (select count(*) from players p join _gm_player_first f on f.player_id = p.id
                              where p.team_id = t.id and p.archived_at is null)
        ) as x
        from teams t
        join team_members m on m.team_id = t.id and m.role = 'parent'
        left join clubs c on c.id = t.club_id
        where t.archived_at is null
        group by t.id, t.name, c.name, t.club
        order by count(distinct m.user_id) desc, t.name
        limit 10
      ) s
    ),

    -- ---------------------------------------------------------- clubs
    'clubs', (
      select coalesce(jsonb_agg(x order by (x->>'parents')::int desc, x->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'city', c.city,
          'status', c.status,
          'admins', (select count(*) from club_staff s where s.club_id = c.id and s.role in ('owner', 'admin')),
          'teams', (select count(*) from teams t where t.club_id = c.id and t.archived_at is null),
          'parents', (select count(distinct m.user_id) from teams t
                        join team_members m on m.team_id = t.id and m.role = 'parent'
                       where t.club_id = c.id and t.archived_at is null),
          'created_at', c.created_at
        ) as x
        from clubs c
        where c.archived_at is null
          and (exists (select 1 from club_staff s where s.club_id = c.id)
               or exists (select 1 from teams t where t.club_id = c.id and t.archived_at is null
                            and exists (select 1 from team_members m where m.team_id = t.id)))
        limit 50
      ) s
    ),

    -- ---------------------------------------------------------- recent sign-ins
    'recent_users', (
      select coalesce(jsonb_agg(x order by x->>'last_seen' desc nulls last), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', u.id,
          'name', coalesce(nullif(p.full_name, ''), ''),
          'email', u.email,
          'created_at', u.created_at,
          'last_sign_in_at', u.last_sign_in_at,
          'last_seen', greatest(u.last_sign_in_at, pr.last_seen_at),
          'kids', (select count(*) from player_guardians g where g.user_id = u.id and g.relation in ('parent', 'family')),
          'is_staff', exists (select 1 from team_members m where m.user_id = u.id and m.role = any(v_staff))
        ) as x
        from auth.users u
        left join profiles p on p.id = u.id
        left join user_presence pr on pr.user_id = u.id
        where u.deleted_at is null and (u.last_sign_in_at is not null or pr.last_seen_at is not null)
        order by greatest(u.last_sign_in_at, pr.last_seen_at) desc nulls last
        limit 40
      ) s
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.admin_growth_metrics(int) from public, anon;
grant execute on function public.admin_growth_metrics(int) to authenticated;

-- Users who marked themselves parent / relative of more than one child, with
-- each child's details. Platform admins only.
create or replace function public.admin_multi_child_users()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(x order by (x->>'kids_count')::int desc, x->>'name'), '[]'::jsonb) from (
      select jsonb_build_object(
        'user_id', u.id,
        'name', coalesce(pr.full_name, ''),
        'email', u.email,
        'last_sign_in_at', u.last_sign_in_at,
        'kids_count', count(*),
        'kids', jsonb_agg(jsonb_build_object(
            'player_id', p.id,
            'name', btrim(p.first_name || ' ' || p.last_name),
            'birth_year', p.birth_year,
            'relation', g.relation,
            'kinship', g.kinship,
            'team', t.name,
            'club', coalesce(c.name, nullif(t.club, '')),
            'imported', exists (select 1 from ifa_players i where i.player_id = p.id),
            'linked_at', g.created_at
          ) order by p.birth_year nulls last, p.first_name)
      ) as x
      from player_guardians g
      join auth.users u on u.id = g.user_id and u.deleted_at is null
      join players p on p.id = g.player_id and p.archived_at is null
      left join teams t on t.id = p.team_id
      left join clubs c on c.id = t.club_id
      left join profiles pr on pr.id = u.id
      where g.relation in ('parent', 'family')
      group by u.id, pr.full_name, u.email, u.last_sign_in_at
      having count(*) > 1
      limit 500
    ) s
  );
end;
$$;
revoke all on function public.admin_multi_child_users() from public, anon;
grant execute on function public.admin_multi_child_users() to authenticated;

commit;
