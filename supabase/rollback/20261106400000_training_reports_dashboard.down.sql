-- Rollback of 20261106400000_training_reports_dashboard.sql
drop function if exists public.club_dashboard(uuid, int);
drop function if exists public.my_dashboard_clubs();
drop function if exists public.can_view_club_dashboard(uuid);
drop function if exists public.submit_training_report(uuid, jsonb);
drop table if exists public.training_reports;
