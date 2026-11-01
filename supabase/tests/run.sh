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
echo "== M1+M2 tests (with M3 installed)"
run supabase/tests/test_m1_m2.sql
echo "== M3 tests"
run supabase/tests/test_m3.sql
echo "== rollback M3"
run supabase/rollback/20261101300000_permissions.down.sql
echo "== rollback M1+M2"
run supabase/rollback/20261101200000_clubs_and_assignments.down.sql
psql -q -d $DB -tc "select 'after rollback: ' || count(*) || ' players, ' || (select count(*) from player_absences) || ' absences' from players"
echo "== re-apply after rollback"
run supabase/migrations/20261101200000_clubs_and_assignments.sql
run supabase/migrations/20261101300000_permissions.sql
echo "ALL TESTS PASSED"
