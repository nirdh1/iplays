-- Rollback of 20261103900000_ifa_team_coaches.sql: drops the two functions and
-- the two columns (the stored coach names are lost; nothing else changes).
begin;
drop function if exists public.set_ifa_team_coaches(int, int, jsonb);
drop function if exists public.team_ifa_coaches(uuid);
alter table public.ifa_teams drop column if exists coaches_seen_at;
alter table public.ifa_teams drop column if exists coaches;
commit;
notify pgrst, 'reload schema';
