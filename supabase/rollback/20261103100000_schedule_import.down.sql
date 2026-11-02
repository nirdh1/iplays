-- Rollback of 20261103100000_schedule_import.sql. Imported games stay.
begin;
drop trigger if exists team_matches_time_confirm on public.team_matches;
drop function if exists public.team_matches_time_confirm();
drop function if exists public.import_team_matches(uuid, jsonb);
drop function if exists public.can_import_matches(uuid);
commit;
