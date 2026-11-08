#!/bin/bash
# Builds the Production SQL parts for iPlays 2.0 (Club OS) from the migrations.
# Each part: one guard block (refuses Staging, refuses a database that does not
# look like iPlays Production, refuses out of order or a second run), then the
# migration text unchanged, then a one-line result. The SQL editor runs the
# whole file as one transaction, so a failed guard or statement changes nothing.
# Usage: ops/production/build_prod_parts.sh <out_dir>
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${1:-ops/production/parts}
mkdir -p "$out"
M=supabase/migrations

part() { # n label requires_sql already_sql migrations...
  local n=$1 label=$2 req=$3 done=$4; shift 4
  local f="$out/prod-part-$n-$label.sql"
  local need="part $((n-1)) to run first. Nothing changed."
  [ "$n" = 1 ] && need="the iPlays V1 permission and training tables, which were not found. Nothing changed."
  {
    echo "-- iPlays 2.0 PRODUCTION part $n of 6: $label"
    echo "-- Run ONLY in the Production SQL editor, ONLY after: backup PASSED + your approval of this part."
    echo "-- Additive. Rollback files: supabase/rollback/<same name>.down.sql"
    echo "-- Built from: $*"
    echo "do \$guard\$ begin"
    echo "  if to_regnamespace('staging') is not null then raise exception 'ABORT: this is the Staging database. Use the staging parts there.'; end if;"
    echo "  if to_regclass('public.ifa_players') is null or (select count(*) from public.ifa_players) < 1000 then raise exception 'ABORT: this does not look like iPlays Production.'; end if;"
    echo "  if not ($req) then raise exception 'ABORT: part $n needs $need'; end if;"
    echo "  if ($done) then raise exception 'ABORT: part $n already ran here. Nothing changed.'; end if;"
    echo "end \$guard\$;"
    echo
    for m in "$@"; do echo "-- ===== $m"; cat "$M/$m"; echo; done
    echo "select $n as part_done, '$label' as label;"
  } > "$f"
  echo "$f"
}

base="to_regprocedure('public.can_club(uuid,text,integer)') is not null and to_regprocedure('public.can(uuid,text,integer)') is not null and to_regprocedure('public.is_club_admin(uuid)') is not null and to_regclass('public.training_sessions') is not null and to_regclass('public.attendance_records') is not null and to_regclass('public.clubs') is not null"
part 1 exercise-library "$base" "to_regclass('public.exercises') is not null" \
  20261106200000_exercise_library.sql 20261106200100_iplays_base_exercises.sql
part 2 session-plans "to_regclass('public.exercises') is not null" "to_regclass('public.session_plans') is not null" \
  20261106300000_session_plans.sql
part 3 reports-dashboard "to_regclass('public.session_plans') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'training_sessions' and column_name = 'kind')" "to_regclass('public.training_reports') is not null" \
  20261106400000_training_reports_dashboard.sql
part 4 topics-base-25 "to_regclass('public.training_reports') is not null" "to_regclass('public.exercise_topics') is not null" \
  20261106500000_exercise_topics_base_25.sql
part 5 exercise-video "to_regclass('public.exercise_topics') is not null" "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exercises' and column_name = 'video_url')" \
  20261106600000_exercise_video_link.sql
part 6 club-os-pilot "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exercises' and column_name = 'video_url')" "to_regclass('public.os_pilot_users') is not null" \
  20261106700000_club_os_pilot.sql
