#!/bin/bash
# v6 one-off: the v5 restore loaded all data but left (a) the new project's extra API grants and
# (b) no copy of our trigger(s) on managed auth/storage tables. Fix both IN THE RESTORE PROJECT only,
# then re-run the comparison. Usage: RESTORE_URL=... RESTORE_REF=... PROD_REF=... ./repair_restore.sh BACKUPDIR
source "$(dirname "$0")/common.sh"
: "${RESTORE_URL:?}"; : "${PROD_REF:?}"; : "${RESTORE_REF:?}"; DIR="${1:?backup directory}"
IDFILE="${IDFILE:-$HERE/restore_target.id}"
[ "$RESTORE_REF" != "$PROD_REF" ] || die "RESTORE_REF equals PROD_REF"
check_url "$RESTORE_URL" "$RESTORE_REF" "$PROD_REF"
check_is_restore_target "$RESTORE_URL" "$RESTORE_REF" "$IDFILE"
cd "$DIR"
grep -E '^(GRANT|REVOKE) ' schema_public.sql > repair_grants.sql
pg_restore -l iplays.dump | grep -E ' TRIGGER (auth|storage) ' > managed_triggers.list || true
pg_restore -L managed_triggers.list -f managed_triggers.sql iplays.dump || die "could not extract managed triggers"
ok "$(wc -l < repair_grants.sql | tr -d ' ') grant lines, $(grep -c '^CREATE TRIGGER' managed_triggers.sql || true) trigger(s) to apply"
cat > repair.sql <<'SQL'
\set ON_ERROR_STOP on
select 1 / (select count(*)::int from iplays_restore_target.marker);   -- aborts anywhere without the marker
revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from anon, authenticated, service_role;
\i repair_grants.sql
\i managed_triggers.sql
SQL
psql -X -q --single-transaction -v ON_ERROR_STOP=1 -f repair.sql "$RESTORE_URL" > repair.log 2>&1 || { tail -20 repair.log; die "repair failed (rolled back)"; }
ok "grants and triggers repaired"
PGOPTIONS='-c default_transaction_read_only=on' psql_to fingerprint_restore.txt "$RESTORE_URL" fingerprint.sql
"$PY" -I compare_fingerprints.py fingerprint_before.txt fingerprint_restore.txt > compare.txt || { cat compare.txt; die "restored copy still differs"; }
cat compare.txt
echo "RESTORE PASSED (data identical after repair). Next: post_restore_isolation.sql on this project only."
