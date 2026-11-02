-- Rollback of 20261101997000_ifa_roster_sync.sql. Drops the function and the read
-- policy, restores ifa_sync_overview; nothing else; keeps ifa_rosters.status / missing_since, ifa_roster_changes and
-- every row (with RLS on and no policy, the change log is then unreadable from the app).
begin;
drop function if exists public.sync_ifa_roster(jsonb, boolean);
drop policy if exists ifa_roster_changes_admin on public.ifa_roster_changes;
create or replace function public.ifa_sync_overview()
returns table (ifa_season_id int, ifa_team_id int, name text, team_id uuid, players int, synced_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.ifa_season_id, t.ifa_team_id, t.name, t.team_id,
         (select count(*)::int from ifa_rosters r where r.ifa_season_id = t.ifa_season_id and r.ifa_team_id = t.ifa_team_id),
         t.synced_at
  from ifa_teams t
  where is_platform_admin()
  order by t.synced_at desc;
$$;
commit;
