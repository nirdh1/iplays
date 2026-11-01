-- Rollback for 20261101990000_team_fund.sql.
-- WARNING: drops the fund tables and every collection, payment, expense and family cost in them.
begin;
drop function if exists public.fund_summary(uuid);
drop function if exists public.set_payment_status(uuid, uuid, text, text, numeric);
drop function if exists public.report_payment(uuid, uuid, text, text);
drop function if exists public.remove_treasurer(uuid, uuid);
drop function if exists public.appoint_treasurer(uuid, uuid);
drop table if exists public.child_costs;
drop table if exists public.fund_expenses;
drop table if exists public.fund_payments;
drop table if exists public.fund_collections;
drop table if exists public.fund_treasurers;
drop function if exists public.is_my_child(uuid);
drop function if exists public.collection_team(uuid);
drop function if exists public.team_has_fund_manager(uuid);
drop function if exists public.can_manage_fund(uuid);
drop function if exists public.is_fund_treasurer(uuid);
commit;
