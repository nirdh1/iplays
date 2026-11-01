-- iplays — IFA local agent (pilot): on-demand "run a check" from the admin panel,
-- carried out by a collector running on the owner's own computer.
--
-- Run after 20261101997000_ifa_roster_sync.sql. Additive only.
-- Rollback: supabase/rollback/20261101998000_ifa_agent.down.sql (drops the
-- functions and policies; keeps the tables and every row).
--
-- Why a local agent: the IFA site returns 403 to cloud servers, but a plain
-- browser on the owner's home connection loads the pages normally (checked
-- 2026-11-01, no challenge). The agent never gets around a block: on 403 / 429
-- / a challenge it stops and reports. The web app cannot reach the Mac, so:
--
--   panel "הרץ בדיקה"  -> request_ifa_sync()        (row in ifa_sync_requests)
--   agent on the Mac    -> agent_claim_ifa_requests() (polls; signs with its key)
--                       -> loads the roster page, parses, validates
--                       -> agent_submit_ifa_roster()  (stores payload + dry run)
--   panel "ייבוא"       -> apply_ifa_request()        (only a platform admin)
--
-- The agent authenticates with its own key (stored hashed here), not with
-- service_role and not as a user. The key can only claim requests, submit a
-- payload for a claimed request (dry run) and report a failure: it cannot
-- apply changes or read anything else.

begin;

create extension if not exists pgcrypto;

create table if not exists public.ifa_agent_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  key_hash text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.ifa_sync_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'roster' check (kind in ('roster')),
  ifa_team_id int not null check (ifa_team_id > 0),
  ifa_season_id int not null check (ifa_season_id > 0),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'checked', 'applied', 'failed', 'canceled')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  agent_id uuid references public.ifa_agent_keys (id) on delete set null,
  claimed_at timestamptz,
  finished_at timestamptz,
  payload jsonb,
  result jsonb,
  error text,
  fetch_info jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  applied_result jsonb
);
create index if not exists ifa_sync_requests_open_idx on public.ifa_sync_requests (requested_at) where status in ('pending', 'claimed');

alter table public.ifa_agent_keys enable row level security;
alter table public.ifa_sync_requests enable row level security;
drop policy if exists ifa_agent_keys_admin on public.ifa_agent_keys;
drop policy if exists ifa_sync_requests_admin on public.ifa_sync_requests;
create policy ifa_agent_keys_admin on public.ifa_agent_keys for select to authenticated using (is_platform_admin());
create policy ifa_sync_requests_admin on public.ifa_sync_requests for select to authenticated using (is_platform_admin());
revoke all on public.ifa_agent_keys, public.ifa_sync_requests from anon;
revoke insert, update, delete on public.ifa_agent_keys, public.ifa_sync_requests from authenticated;
grant select on public.ifa_sync_requests to authenticated;
-- the hash never leaves the database: no column grant for key_hash
revoke select on public.ifa_agent_keys from authenticated;
grant select (id, name, created_by, created_at, last_seen_at, revoked_at) on public.ifa_agent_keys to authenticated;

-- ------------------------------------------------------------ admin side

-- Returns the key once; only its hash is stored.
create or replace function public.create_ifa_agent_key(p_name text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text := 'ifa_' || encode(gen_random_bytes(24), 'hex');
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into ifa_agent_keys (name, key_hash, created_by)
  values (left(coalesce(nullif(trim(p_name), ''), 'Mac'), 60), encode(digest(v_key, 'sha256'), 'hex'), auth.uid());
  return v_key;
end;
$$;

create or replace function public.revoke_ifa_agent_key(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update ifa_agent_keys set revoked_at = now() where id = p_id and revoked_at is null;
end;
$$;

-- "הרץ בדיקה": one open request per team + season; a second click returns it.
create or replace function public.request_ifa_sync(p_ifa_team_id int, p_ifa_season_id int default 28)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(p_ifa_team_id, 0) <= 0 or coalesce(p_ifa_season_id, 0) <= 0 then
    raise exception 'team and season ids are required' using errcode = '22023';
  end if;
  select id into v_id from ifa_sync_requests
  where ifa_team_id = p_ifa_team_id and ifa_season_id = p_ifa_season_id and status in ('pending', 'claimed')
  limit 1;
  if v_id is null then
    insert into ifa_sync_requests (ifa_team_id, ifa_season_id, requested_by)
    values (p_ifa_team_id, p_ifa_season_id, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_ifa_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update ifa_sync_requests set status = 'canceled', finished_at = now()
  where id = p_request and status in ('pending', 'claimed', 'checked');
end;
$$;

-- Apply a checked request: the same payload the dry run saw, through
-- sync_ifa_roster (no deletes, guards, change log). Platform admin only.
create or replace function public.apply_ifa_request(p_request uuid, p_allow_large_drop boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req ifa_sync_requests;
  v_res jsonb;
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_req from ifa_sync_requests where id = p_request for update;
  if v_req.id is null or v_req.status <> 'checked' or v_req.payload is null then
    raise exception 'only a checked request can be imported' using errcode = '22023';
  end if;
  v_res := sync_ifa_roster(case when p_allow_large_drop then v_req.payload || '{"allow_large_drop": true}' else v_req.payload end, true);
  if (v_res->>'ok')::boolean then
    update ifa_sync_requests set status = 'applied', applied_at = now(), applied_result = v_res where id = p_request;
  end if;
  return v_res;
end;
$$;

-- ------------------------------------------------------------ agent side

create or replace function public.ifa_agent_id(p_key text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  select id into v_id from ifa_agent_keys
  where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if v_id is null then
    raise exception 'invalid agent key' using errcode = '28000';
  end if;
  update ifa_agent_keys set last_seen_at = now() where id = v_id;
  return v_id;
end;
$$;

-- Claim up to p_limit (max 20) open requests. A claim older than 30 minutes
-- (the Mac slept mid-run) is offered again.
create or replace function public.agent_claim_ifa_requests(p_key text, p_limit int default 5)
returns table (id uuid, kind text, ifa_team_id int, ifa_season_id int)
language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := ifa_agent_id(p_key);
begin
  return query
  update ifa_sync_requests r
  set status = 'claimed', claimed_at = now(), agent_id = v_agent
  where r.id in (
    select x.id from ifa_sync_requests x
    where x.status = 'pending' or (x.status = 'claimed' and x.claimed_at < now() - interval '30 minutes')
    order by x.requested_at
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
    for update skip locked)
  returning r.id, r.kind, r.ifa_team_id, r.ifa_season_id;
end;
$$;

-- Submit the parsed roster for a claimed request: stores it and runs the dry
-- run (nothing is imported). The payload must be for the requested team.
create or replace function public.agent_submit_ifa_roster(p_key text, p_request uuid, p_payload jsonb, p_fetch_info jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := ifa_agent_id(p_key);
  v_req ifa_sync_requests;
  v_res jsonb;
begin
  select * into v_req from ifa_sync_requests where id = p_request for update;
  if v_req.id is null or v_req.status <> 'claimed' or v_req.agent_id is distinct from v_agent then
    raise exception 'request is not claimed by this agent' using errcode = '22023';
  end if;
  if p_payload->>'ifa_team_id' is distinct from v_req.ifa_team_id::text
     or p_payload->>'ifa_season_id' is distinct from v_req.ifa_season_id::text then
    raise exception 'payload is for another team or season' using errcode = '22023';
  end if;
  v_res := sync_ifa_roster(p_payload - 'allow_large_drop', false);
  update ifa_sync_requests
  set status = case when (v_res->>'ok')::boolean then 'checked' else 'failed' end,
      payload = p_payload - 'allow_large_drop', result = v_res, error = v_res->>'error',
      fetch_info = coalesce(p_fetch_info, '{}'), finished_at = now()
  where id = p_request;
  return v_res;
end;
$$;

create or replace function public.agent_fail_ifa_request(p_key text, p_request uuid, p_error text, p_fetch_info jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := ifa_agent_id(p_key);
begin
  update ifa_sync_requests
  set status = 'failed', error = left(coalesce(p_error, 'failed'), 500), fetch_info = coalesce(p_fetch_info, '{}'), finished_at = now()
  where id = p_request and status = 'claimed' and agent_id = v_agent;
  if not found then
    raise exception 'request is not claimed by this agent' using errcode = '22023';
  end if;
  insert into ifa_sync_runs (kind, source, status, counts, errors)
  select 'roster', 'local-agent', 'failed', jsonb_build_object('ifa_team_id', r.ifa_team_id, 'request_id', r.id),
         jsonb_build_array(jsonb_build_object('error', r.error))
  from ifa_sync_requests r where r.id = p_request;
end;
$$;

revoke all on function public.create_ifa_agent_key(text), public.revoke_ifa_agent_key(uuid),
  public.request_ifa_sync(int, int), public.cancel_ifa_request(uuid), public.apply_ifa_request(uuid, boolean),
  public.ifa_agent_id(text), public.agent_claim_ifa_requests(text, int),
  public.agent_submit_ifa_roster(text, uuid, jsonb, jsonb), public.agent_fail_ifa_request(text, uuid, text, jsonb)
  from public;
grant execute on function public.create_ifa_agent_key(text), public.revoke_ifa_agent_key(uuid),
  public.request_ifa_sync(int, int), public.cancel_ifa_request(uuid), public.apply_ifa_request(uuid, boolean)
  to authenticated;
-- the agent calls with the public anon key + its own agent key
grant execute on function public.agent_claim_ifa_requests(text, int),
  public.agent_submit_ifa_roster(text, uuid, jsonb, jsonb), public.agent_fail_ifa_request(text, uuid, text, jsonb)
  to anon, authenticated;

commit;
