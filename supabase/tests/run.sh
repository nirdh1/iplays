#!/usr/bin/env bash
# Runs the migrations and RLS tests on a throwaway local Postgres database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=iplays_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -q -v ON_ERROR_STOP=1 -o /dev/null -d $DB -f "$1"; }
for r in anon authenticated service_role; do psql -q -d postgres -c "drop role if exists $r" 2>/dev/null || true; done
run supabase/tests/supabase_shim.sql
run supabase/migrations/20261031000000_init.sql
run supabase/migrations/20261101100000_coach.sql
run supabase/tests/seed_before_m1.sql
run supabase/migrations/20261101200000_clubs_and_assignments.sql
run supabase/migrations/20261101300000_permissions.sql
run supabase/migrations/20261101400000_search_and_join_requests.sql
run supabase/migrations/20261101500000_matches_lineups_attendance.sql
run supabase/migrations/20261101600000_open_teams.sql
run supabase/migrations/20261101700000_team_claims.sql
run supabase/migrations/20261101800000_ifa_import.sql
run supabase/migrations/20261101900000_ifa_games_sync.sql
run supabase/migrations/20261101950000_join_no_staff_parent.sql
run supabase/migrations/20261101960000_parent_trainings.sql
run supabase/migrations/20261101970000_rides.sql
run supabase/migrations/20261101971000_match_events.sql
run supabase/migrations/20261101980000_account_types.sql
run supabase/migrations/20261101990000_team_fund.sql
run supabase/migrations/20261101996000_family_members.sql
run supabase/migrations/20261101997000_ifa_roster_sync.sql
run supabase/migrations/20261101998000_ifa_agent.sql
# team contacts early, so every test below runs with profiles.phone / email closed to team mates
run supabase/migrations/20261103500000_team_contacts.sql
echo "== M1+M2 tests (with M3 installed)"
run supabase/tests/test_m1_m2.sql
echo "== M3 tests"
run supabase/tests/test_m3.sql
echo "== search and join requests tests"
run supabase/tests/test_search.sql
echo "== M4 tests"
run supabase/tests/test_m4.sql
echo "== open teams tests"
run supabase/tests/test_open_teams.sql
echo "== team claims tests"
run supabase/tests/test_team_claims.sql
echo "== IFA import tests"
run supabase/tests/test_ifa.sql
echo "== IFA games sync tests"
run supabase/tests/test_ifa_games.sql
echo "== IFA roster sync tests"
run supabase/tests/test_ifa_roster_sync.sql
echo "== IFA local agent tests"
run supabase/tests/test_ifa_agent.sql
echo "== team page IFA link"
run supabase/migrations/20261101999000_team_ifa_link.sql
run supabase/tests/test_team_ifa_link.sql
echo "== IFA roster review"
run supabase/migrations/20261102100000_ifa_roster_review.sql
run supabase/tests/test_ifa_roster_review.sql
echo "== coach overrides on IFA games"
run supabase/migrations/20261102200000_match_overrides.sql
run supabase/tests/test_match_overrides.sql
echo "== load a game schedule from a file"
run supabase/migrations/20261103100000_schedule_import.sql
run supabase/tests/test_schedule_import.sql
run supabase/rollback/20261103100000_schedule_import.down.sql
run supabase/migrations/20261103100000_schedule_import.sql
echo "== IFA agent sends games"
run supabase/migrations/20261102300000_ifa_agent_games.sql
run supabase/tests/test_ifa_agent_games.sql
echo "== find a player by name"
run supabase/migrations/20261102710000_find_players_by_name.sql
run supabase/rollback/20261102710000_find_players_by_name.down.sql
run supabase/migrations/20261102710000_find_players_by_name.sql
echo "== smarter search (find_players tests run against the new version)"
run supabase/migrations/20261102720000_smarter_search.sql
run supabase/tests/test_find_players.sql
run supabase/tests/test_smarter_search.sql
run supabase/rollback/20261102720000_smarter_search.down.sql
run supabase/migrations/20261102720000_smarter_search.sql
echo "== family members tests (with inbox notifications installed; applied here because their triggers change the IFA notification counts above)"
run supabase/migrations/20261101995000_inbox_notifications.sql
run supabase/tests/test_family.sql
echo "== guardian removal tests"
run supabase/migrations/20261103000000_guardian_removal.sql
run supabase/tests/test_guardian_removal.sql
run supabase/rollback/20261103000000_guardian_removal.down.sql
run supabase/migrations/20261103000000_guardian_removal.sql
echo "== live match tests"
run supabase/migrations/20261102600000_live_match_session.sql
run supabase/tests/test_live_match.sql
echo "== goal alerts"
run supabase/migrations/20261109300000_goal_alerts.sql
run supabase/tests/test_goal_alerts.sql
run supabase/rollback/20261109300000_goal_alerts.down.sql
run supabase/migrations/20261109300000_goal_alerts.sql
echo "== rollback live match, re-apply"
run supabase/rollback/20261102600000_live_match_session.down.sql
psql -q -d $DB -tc "select 'after live rollback: ' || count(*) || ' reports kept' from match_reports"
run supabase/migrations/20261102600000_live_match_session.sql
echo "== body metrics, goals and nutrition (parent-only)"
run supabase/migrations/20261101985000_player_career.sql
run supabase/tests/test_body_private.sql
echo "== rollback body metrics, goals and nutrition"
run supabase/rollback/20261102500000_body_goals_nutrition.down.sql
psql -q -d $DB -tc "select 'after body rollback: ' || count(*) || ' goals, ' || (select count(*) from player_measurements) || ' measurements kept' from child_goals"
run supabase/migrations/20261102500000_body_goals_nutrition.sql
run supabase/rollback/20261102500000_body_goals_nutrition.down.sql
run supabase/rollback/20261101985000_player_career.down.sql
echo "== club sign-up, custom roles and coach notes"
run supabase/migrations/20261102400000_club_signup_roles_notes.sql
run supabase/tests/test_club_signup_roles_notes.sql
echo "== unified calendar, absences and medical documents"
run supabase/migrations/20261101985000_player_career.sql
run supabase/migrations/20261102500000_calendar_absences.sql
run supabase/tests/test_calendar.sql
echo "== parents edit trainings and games, everyone told who changed what"
run supabase/migrations/20261103300000_parents_edit_events.sql
run supabase/tests/test_parents_edit_events.sql
run supabase/rollback/20261103300000_parents_edit_events.down.sql
run supabase/migrations/20261103300000_parents_edit_events.sql
run supabase/rollback/20261103300000_parents_edit_events.down.sql
echo "== rollback unified calendar (and re-apply / roll back again: idempotent)"
run supabase/rollback/20261102500000_calendar_absences.down.sql
run supabase/migrations/20261102500000_calendar_absences.sql
run supabase/rollback/20261102500000_calendar_absences.down.sql
psql -q -d $DB -tc "select 'after calendar rollback: ' || count(*) || ' trainings kept, ' || (select count(*) from training_participants) || ' participants kept' from training_sessions"
echo "== self-reported goals and assists (career)"
run supabase/migrations/20261102800000_player_self_stats.sql
run supabase/tests/test_self_stats.sql
echo "== IFA numbers from a file"
run supabase/migrations/20261103200000_player_ifa_stats.sql
run supabase/tests/test_ifa_stats.sql
run supabase/rollback/20261103200000_player_ifa_stats.down.sql
run supabase/migrations/20261103200000_player_ifa_stats.sql
run supabase/rollback/20261102800000_player_self_stats.down.sql
run supabase/migrations/20261102800000_player_self_stats.sql
run supabase/rollback/20261102800000_player_self_stats.down.sql
echo "== rollback club sign-up, roles and notes (keeps data; tables dropped here so the older rollbacks below can run)"
run supabase/rollback/20261102400000_club_signup_roles_notes.down.sql
psql -q -d $DB -c "select 'kept after rollback: ' || (select count(*) from club_roles) || ' roles, ' || (select count(*) from player_pro_notes) || ' notes'"
psql -q -d $DB -c "alter table club_invites drop column role_id, drop column role_program_id, drop column role_team_id" -c "drop table player_pro_notes, club_role_assignments, club_role_permissions, club_roles, club_access_requests" -c "delete from permission_grants where domain in ('permissions','pro_notes','camps')" -c "delete from permission_domains where domain in ('permissions','pro_notes','camps')"
echo "== rollback smarter search, find players"
run supabase/rollback/20261102720000_smarter_search.down.sql
run supabase/rollback/20261102710000_find_players_by_name.down.sql
echo "== rollback IFA agent games"
run supabase/rollback/20261102300000_ifa_agent_games.down.sql
echo "== rollback coach overrides"
run supabase/rollback/20261102200000_match_overrides.down.sql
echo "== rollback IFA roster review"
run supabase/rollback/20261102100000_ifa_roster_review.down.sql
echo "== rollback team page IFA link"
run supabase/rollback/20261101999000_team_ifa_link.down.sql
echo "== rollback IFA local agent"
run supabase/rollback/20261101998000_ifa_agent.down.sql
echo "== rollback IFA roster sync"
run supabase/rollback/20261101997000_ifa_roster_sync.down.sql
echo "== rollback team contacts (re-apply / roll back again: idempotent)"
run supabase/rollback/20261103500000_team_contacts.down.sql
run supabase/migrations/20261103500000_team_contacts.sql
run supabase/rollback/20261103500000_team_contacts.down.sql
echo "== rollback family members"
run supabase/rollback/20261101996000_family_members.down.sql
run supabase/rollback/20261101995000_inbox_notifications.down.sql
echo "== rollback team fund, match events, rides"
run supabase/rollback/20261101990000_team_fund.down.sql
run supabase/rollback/20261109300000_goal_alerts.down.sql
run supabase/rollback/20261102600000_live_match_session.down.sql
run supabase/rollback/20261101971000_match_events.down.sql
run supabase/rollback/20261101970000_rides.down.sql
# the match-events rollback keeps its table and read policy (uses can()); drop the policy so the M3 rollback below can run
psql -q -d $DB -c "drop policy if exists match_events_select on public.match_events"
psql -q -d $DB -c "drop policy if exists match_live_select on public.match_live" -c "drop policy if exists match_reporter_queue_select on public.match_reporter_queue" -c "drop policy if exists match_reports_select on public.match_reports"
echo "== account types tests (re-apply: backfill club staff created by the tests above)"
run supabase/migrations/20261101980000_account_types.sql
run supabase/tests/test_account_types.sql
echo "== rollback account types"
run supabase/rollback/20261101980000_account_types.down.sql
echo "== rollback parent trainings"
run supabase/rollback/20261101960000_parent_trainings.down.sql
echo "== rollback join no-staff parent"
run supabase/rollback/20261101950000_join_no_staff_parent.down.sql
echo "== rollback IFA games sync"
run supabase/rollback/20261101900000_ifa_games_sync.down.sql
echo "== rollback IFA import"
run supabase/rollback/20261101800000_ifa_import.down.sql
echo "== rollback team claims"
run supabase/rollback/20261101700000_team_claims.down.sql
echo "== rollback open teams"
run supabase/rollback/20261101600000_open_teams.down.sql
echo "== rollback M4"
run supabase/rollback/20261101500000_matches_lineups_attendance.down.sql
echo "== rollback search"
run supabase/rollback/20261101400000_search_and_join_requests.down.sql
echo "== rollback M3"
run supabase/rollback/20261101300000_permissions.down.sql
echo "== rollback M1+M2"
run supabase/rollback/20261101200000_clubs_and_assignments.down.sql
psql -q -d $DB -tc "select 'after rollback: ' || count(*) || ' players, ' || (select count(*) from player_absences) || ' absences' from players"
echo "== re-apply after rollback"
run supabase/migrations/20261101200000_clubs_and_assignments.sql
run supabase/migrations/20261101300000_permissions.sql
run supabase/migrations/20261101400000_search_and_join_requests.sql
run supabase/migrations/20261101500000_matches_lineups_attendance.sql
run supabase/migrations/20261101600000_open_teams.sql
run supabase/migrations/20261101700000_team_claims.sql
run supabase/migrations/20261101800000_ifa_import.sql
run supabase/migrations/20261101900000_ifa_games_sync.sql
run supabase/migrations/20261101950000_join_no_staff_parent.sql
run supabase/migrations/20261101960000_parent_trainings.sql
run supabase/migrations/20261101996000_family_members.sql
run supabase/migrations/20261101997000_ifa_roster_sync.sql
run supabase/migrations/20261101998000_ifa_agent.sql
psql -q -d $DB -tc "select 'after re-apply: ' || count(*) || ' requests kept, ' || (select count(*) from team_matches) || ' matches kept' from join_requests"
echo "ALL TESTS PASSED"
