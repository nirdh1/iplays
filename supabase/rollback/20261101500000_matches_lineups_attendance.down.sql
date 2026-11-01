-- iplays — rollback for 20261101500000_matches_lineups_attendance.sql
-- Removes the M4 functions, triggers and access policies. No data is deleted:
-- team_matches, match_lineups, match_lineup_players and attendance_records
-- stay (with no policies nobody can read them through the API) and are
-- reused if the migration is run again.

begin;

drop policy if exists matches_select on public.team_matches;
drop policy if exists matches_insert on public.team_matches;
drop policy if exists matches_update on public.team_matches;
drop policy if exists lineups_select on public.match_lineups;
drop policy if exists lineup_players_select on public.match_lineup_players;
drop policy if exists attendance_select on public.attendance_records;
revoke all on public.team_matches, public.match_lineups, public.match_lineup_players, public.attendance_records
  from authenticated;

drop trigger if exists team_matches_before on public.team_matches;
drop function if exists public.team_matches_before();
drop function if exists public.add_lineup(uuid, text);
drop function if exists public.save_lineup(uuid, jsonb, text);
drop function if exists public.publish_lineup(uuid, boolean);
drop function if exists public.remove_lineup(uuid);
drop function if exists public.mark_attendance(text, uuid, uuid, text, int, text);
drop function if exists public.event_attendance(text, uuid);
drop function if exists public.team_attendance_summary(uuid, date, date);
drop function if exists public.event_team_and_date(text, uuid);

do $$
begin
  raise notice 'iplays M4 rolled back (data kept)';
end;
$$;

commit;
