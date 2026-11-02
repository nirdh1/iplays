-- Rollback of 20261102710000_find_players_by_name.sql. Only functions; no data.
begin;
drop function if exists public.find_players(text, int);
drop function if exists public.ifa_estimated_birth_year(text, int);
drop function if exists public.ifa_age_group(text);
commit;
