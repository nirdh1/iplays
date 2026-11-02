-- Minimal stand-in for the Supabase platform so migrations and RLS tests can
-- run on a plain local Postgres (tests only; never run this on Supabase).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  phone text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'
  )::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Storage: just the bucket and object tables the migrations touch.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
