-- iplays restore into an EMPTY Supabase project. Run with: psql --single-transaction -v ON_ERROR_STOP=1
\set ON_ERROR_STOP on
-- v6: a new project's default privileges would give anon/authenticated/service_role ALL on every
-- restored object; switch them off so the dump's own GRANT/REVOKE lines rebuild production's exact grants.
-- (The dump's ALTER DEFAULT PRIVILEGES FOR ROLE postgres lines at its end restore production's defaults.)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
-- after the revoke, so extension functions get only the grants the dump itself lists
create extension if not exists pg_trgm with schema public;   -- must match the extension list in the fingerprint
-- v6: leave out default privileges of platform roles (e.g. supabase_admin): not data, postgres may not set them
\! awk '!(/^ALTER DEFAULT PRIVILEGES FOR ROLE / && $6 != "postgres")' schema_public.sql > schema_public.restore.sql
\i schema_public.restore.sql
\i storage_policies.sql
set session_replication_role = replica;   -- no trigger fires while loading
\i data_auth.sql
\i data_storage.sql
\i data_public.sql
set session_replication_role = origin;
-- v6: our own triggers on managed auth/storage tables (e.g. on_auth_user_created) are not in schema_public.sql
\! pg_restore -l iplays.dump | grep -E ' TRIGGER (auth|storage) ' > managed_triggers.list || true
\! pg_restore -L managed_triggers.list -f managed_triggers.sql iplays.dump
\i managed_triggers.sql
