-- Rollback of 20261102400000_league_table.sql: removes the two functions.
-- No table or row was created by it, so nothing else changes.
begin;
drop function if exists public.team_league_table(uuid);
drop function if exists public.league_table(int, int);
commit;
