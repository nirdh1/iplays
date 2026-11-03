-- Rollback of 20261103800000_league_table_snapshots.sql.
-- Drops the screenshot league tables and their functions (the saved
-- screenshot tables are lost). The table computed from IFA results is not
-- touched. The app keeps working: it simply stops showing screenshot tables.

begin;

drop function if exists public.delete_league_snapshot(uuid);
drop function if exists public.team_league_snapshot(uuid);
drop function if exists public.save_league_snapshot(uuid, jsonb, date);
drop function if exists public.team_ifa_league(uuid);
drop table if exists public.league_table_snapshots;

commit;

notify pgrst, 'reload schema';
