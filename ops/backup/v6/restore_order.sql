-- iplays restore into an EMPTY Supabase project. Run with: psql --single-transaction -v ON_ERROR_STOP=1
\set ON_ERROR_STOP on
create extension if not exists pg_trgm with schema public;   -- must match the extension list in the fingerprint
\i schema_public.restore.sql
\i storage_policies.sql
set session_replication_role = replica;   -- no trigger fires while loading
\i data_auth.sql
\i data_storage.sql
\i data_public.sql
set session_replication_role = origin;
