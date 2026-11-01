-- Rollback of 20261101999000_team_ifa_link.sql (drops the function; no data involved).
drop function if exists public.team_ifa_link(uuid);
