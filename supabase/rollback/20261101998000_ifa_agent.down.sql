-- Rollback of 20261101998000_ifa_agent.sql. Drops the functions and policies;
-- keeps ifa_agent_keys, ifa_sync_requests and every row (unreadable from the app
-- until re-applied). Revoking all agent keys first stops a running agent at once:
--   update public.ifa_agent_keys set revoked_at = now() where revoked_at is null;
begin;
drop function if exists public.agent_fail_ifa_request(text, uuid, text, jsonb);
drop function if exists public.agent_submit_ifa_roster(text, uuid, jsonb, jsonb);
drop function if exists public.agent_claim_ifa_requests(text, int);
drop function if exists public.ifa_agent_id(text);
drop function if exists public.apply_ifa_request(uuid, boolean);
drop function if exists public.cancel_ifa_request(uuid);
drop function if exists public.request_ifa_sync(int, int);
drop function if exists public.revoke_ifa_agent_key(uuid);
drop function if exists public.create_ifa_agent_key(text);
drop policy if exists ifa_agent_keys_admin on public.ifa_agent_keys;
drop policy if exists ifa_sync_requests_admin on public.ifa_sync_requests;
commit;
