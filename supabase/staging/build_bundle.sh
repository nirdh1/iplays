#!/usr/bin/env bash
# Builds one SQL file with every migration in file order, for a NEW, EMPTY
# Staging Supabase project. It refuses to run on a database that already has
# the iPlays schema (for example Production).
# Usage: supabase/staging/build_bundle.sh > staging_all_migrations.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
cat <<'SQL'
-- iPlays STAGING bundle: all migrations in file order. NEVER run on Production.
do $$
begin
  if to_regclass('public.players') is not null or to_regclass('public.ifa_players') is not null then
    raise exception 'ABORT: this database already has the iPlays schema. This bundle is only for a new, empty Staging project.';
  end if;
end $$;
SQL
for f in supabase/migrations/*.sql; do
  printf '\n-- ==== %s ====\n' "$(basename "$f")"
  cat "$f"
  printf '\n'
done
