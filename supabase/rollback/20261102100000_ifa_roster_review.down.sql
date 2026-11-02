-- Rollback of 20261102100000_ifa_roster_review.sql: drops the functions and the
-- read policy. The ifa_roster_review table and every row in it are kept.
begin;
drop function if exists public.decide_ifa_roster_changes(bigint[], boolean);
drop function if exists public.my_roster_review_counts();
drop function if exists public.team_roster_review(uuid);
drop function if exists public.agent_propose_ifa_roster(text, jsonb);
drop function if exists public.propose_ifa_roster(jsonb);
drop function if exists public.ifa_roster_propose_core(jsonb);
drop policy if exists ifa_roster_review_select on public.ifa_roster_review;
commit;
