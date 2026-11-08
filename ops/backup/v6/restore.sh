#!/bin/bash
# Action 7: restore the backup files into the EMPTY temporary project and compare.
# Usage: RESTORE_REF=<new project ref> PROD_REF=<production ref> RESTORE_URL=... ./restore.sh BACKUPDIR
# Needs restore_target.id from make_restore_marker.sh and the marker SQL run in the NEW project.
source "$(dirname "$0")/common.sh"
: "${RESTORE_URL:?}"; : "${PROD_REF:?}"; : "${RESTORE_REF:?}"; DIR="${1:?backup directory}"
IDFILE="${IDFILE:-$HERE/restore_target.id}"
need psql; need "$PY"
[ "$RESTORE_REF" != "$PROD_REF" ] || die "RESTORE_REF equals PROD_REF"
check_url "$RESTORE_URL" "$RESTORE_REF" "$PROD_REF"
check_is_restore_target "$RESTORE_URL" "$RESTORE_REF" "$IDFILE"
cd "$DIR"
cp "$HERE/restore_order.sql" .
(shasum -a 256 -c SHA256SUMS 2>/dev/null || sha256sum -c SHA256SUMS) > sha_check.txt || { cat sha_check.txt; die "checksum mismatch"; }
ok "checksums"
"$PY" -I check_dump.py fingerprint_before.txt data_public.sql data_auth.sql data_storage.sql > /dev/null || die "backup files incomplete"
# v6: a new Supabase project lets postgres set default privileges only for itself.
# Lines "ALTER DEFAULT PRIVILEGES FOR ROLE <other role>" (e.g. supabase_admin) are
# platform settings, not data, so they are left out of the copy that is loaded.
awk '!(/^ALTER DEFAULT PRIVILEGES FOR ROLE / && $6 != "postgres")' schema_public.sql > schema_public.restore.sql
skipped=$(( $(wc -l < schema_public.sql) - $(wc -l < schema_public.restore.sql) ))
ok "schema copy for loading: $skipped platform default-privilege line(s) left out (not data)"
empty=$(psql -X -At -v ON_ERROR_STOP=1 "$RESTORE_URL" -c "select (select count(*) from auth.users)=0 and (select count(*) from pg_tables where schemaname='public')=0")
[ "$empty" = t ] || die "target project is not empty"
ok "target is empty"
confirm_ref "$RESTORE_REF"
start=$SECONDS
psql -X --single-transaction -v ON_ERROR_STOP=1 -f restore_order.sql "$RESTORE_URL" > restore.log 2>&1 || { tail -20 restore.log; die "restore failed (rolled back, target still empty)"; }
ok "loaded in $((SECONDS - start))s"
PGOPTIONS='-c default_transaction_read_only=on' psql_to fingerprint_restore.txt "$RESTORE_URL" fingerprint.sql
"$PY" -I compare_fingerprints.py fingerprint_before.txt fingerprint_restore.txt > compare.txt || { cat compare.txt; die "restored data differs"; }
cat compare.txt
echo "RESTORE PASSED (data identical). Next: post_restore_isolation.sql on this project only."
