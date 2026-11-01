-- Rollback of 20261101700000_team_claims.sql. Keeps the team_claims table,
-- its data and every coach membership created by approvals.

begin;

drop function if exists public.pending_team_claims();
drop function if exists public.review_team_claim(uuid, boolean);
drop function if exists public.cancel_team_claim(uuid);
drop function if exists public.request_team_claim(uuid, text);
drop function if exists public.can_review_team_claim(uuid);
drop policy if exists team_claims_select on public.team_claims;
revoke all on public.team_claims from authenticated;

commit;
