#!/usr/bin/env bash
# Builds one add-on Staging part from the given migrations, for a Staging
# project that already ran the base parts. It aborts unless part <requires>
# ran and this part did not run yet, so it can't run on Production or twice.
# Usage: supabase/staging/build_addon.sh <out-file> <part-no> <requires-part> <label> <migration>...
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${1:?out file}; p=${2:?part}; req=${3:?requires}; label=${4:?label}; shift 4
{
  echo "-- iPlays STAGING, add-on part $p ($label). NEVER run on Production."
  echo "-- Run in the SQL Editor of the Staging project, after part $req."
  cat <<SQL
do \$\$
begin
  if to_regclass('staging.bundle_progress') is null then
    raise exception 'ABORT: this database is not a Staging project in progress (run parts 1-$req first).';
  end if;
  if not exists (select 1 from staging.bundle_progress where part = $req) then
    raise exception 'ABORT: run part $req first.';
  end if;
  if exists (select 1 from staging.bundle_progress where part = $p) then
    raise exception 'ABORT: part $p already ran here.';
  end if;
end \$\$;
SQL
  for f in "$@"; do printf '\n-- ==== %s ====\n' "$(basename "$f")"; cat "$f"; printf '\n'; done
  printf '\ninsert into staging.bundle_progress (part) values (%s);\nselect %s as part_done, %s as label;\n' "$p" "$p" "'$label'"
} > "$out"
ls -l "$out" >&2
