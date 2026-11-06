#!/usr/bin/env bash
# Builds the Staging SQL in N parts (default 3), every migration in file order,
# for a NEW, EMPTY Supabase project. Each part checks that it runs in order:
#   part 1 aborts if the database already has the iPlays schema (e.g. Production);
#   part k aborts unless part k-1 finished and part k did not run yet.
# Usage: supabase/staging/build_bundle.sh <out-dir> [parts]
# UNTIL=<timestamp> limits the base parts to migrations up to that file prefix,
# so files already handed out stay identical; later migrations ship as add-on
# parts (build_addon.sh).
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${1:?out dir}; parts=${2:-3}
mkdir -p "$out"
files=()
for f in supabase/migrations/*.sql; do
  if [ -n "${UNTIL:-}" ] && [[ "$(basename "$f")" > "${UNTIL}~" ]]; then continue; fi
  files+=("$f")
done
total=0; for f in "${files[@]}"; do total=$((total + $(wc -c < "$f"))); done
target=$(( (total + parts - 1) / parts ))
part=1; size=0
start_part() {
  local p=$1 f="$out/staging-part-$1-of-$parts.sql"
  {
    echo "-- iPlays STAGING, part $p of $parts: migrations in file order. NEVER run on Production."
    echo "-- Run in the SQL Editor of the NEW Staging project only."
    if [ "$p" -eq 1 ]; then
      cat <<'SQL'
do $$
begin
  if to_regclass('public.players') is not null or to_regclass('public.ifa_players') is not null then
    raise exception 'ABORT: this database already has the iPlays schema. These files are only for a new, empty Staging project.';
  end if;
end $$;
create schema if not exists staging;
create table if not exists staging.bundle_progress (part int primary key, done_at timestamptz not null default now());
SQL
    else
      cat <<SQL
do \$\$
begin
  if to_regclass('staging.bundle_progress') is null or not exists (select 1 from staging.bundle_progress where part = $((p - 1))) then
    raise exception 'ABORT: run part $((p - 1)) first (this database is not a Staging project in progress).';
  end if;
  if exists (select 1 from staging.bundle_progress where part = $p) then
    raise exception 'ABORT: part $p already ran here.';
  end if;
end \$\$;
SQL
    fi
  } > "$f"
}
end_part() { printf '\ninsert into staging.bundle_progress (part) values (%s);\nselect %s as part_done, %s as of_parts;\n' "$1" "$1" "$parts" >> "$out/staging-part-$1-of-$parts.sql"; }
start_part 1
for f in "${files[@]}"; do
  s=$(wc -c < "$f")
  if [ "$size" -gt 0 ] && [ $((size + s)) -gt "$target" ] && [ "$part" -lt "$parts" ]; then
    end_part "$part"; part=$((part + 1)); size=0; start_part "$part"
  fi
  { printf '\n-- ==== %s ====\n' "$(basename "$f")"; cat "$f"; printf '\n'; } >> "$out/staging-part-$part-of-$parts.sql"
  size=$((size + s))
done
end_part "$part"
ls -l "$out"/staging-part-*-of-"$parts".sql >&2
