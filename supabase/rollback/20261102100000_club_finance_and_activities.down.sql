-- Rollback for 20261102100000_club_finance_and_activities.sql.
-- WARNING: drops every fee plan, charge, payment, reminder, activity and
-- registration. Notifications already sent of the new kinds are deleted too
-- (the old kind list cannot hold them).
begin;
drop function if exists public.club_people(uuid, uuid[]);
drop function if exists public.cancel_registration(uuid);
drop function if exists public.register_for_activity(uuid, uuid, text);
drop function if exists public.activity_charge_for(uuid);
drop function if exists public.activity_counts(uuid[]);
drop function if exists public.send_payment_reminders(uuid, uuid[]);
drop function if exists public.review_club_payment(uuid, text);
drop function if exists public.report_club_payment(uuid, text, text, numeric);
drop function if exists public.record_club_payment(uuid, numeric, text, date, text);
drop function if exists public.set_charge_status(uuid, text);
drop function if exists public.add_club_charge(uuid, uuid, text, numeric, date, uuid);
drop function if exists public.assign_fee_plan(uuid, uuid[]);
drop view if exists public.club_charge_balances;
drop table if exists public.activity_registrations;
drop table if exists public.club_reminders;
drop table if exists public.club_payments;
drop function if exists public.charge_row(uuid);
drop table if exists public.club_charges;
drop table if exists public.club_activities;
drop table if exists public.club_fee_plans;
drop function if exists public.player_in_club(uuid, uuid);
drop function if exists public.guardian_ids(uuid);
drop function if exists public.activity_club(uuid);
drop function if exists public.can_club_activities(uuid, int);
drop function if exists public.can_club_finance(uuid, uuid, int);
delete from public.permission_grants where domain = 'activities';
delete from public.permission_domains where domain = 'activities';
delete from public.notification_outbox where kind in ('payment_reminder', 'payment', 'activity');
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'match_change', 'match_result', 'training', 'announcement', 'absence',
  'join_request', 'join_decision', 'team_claim', 'team_claim_decision'));
commit;
