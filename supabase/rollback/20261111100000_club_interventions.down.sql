-- Rollback of 20261111100000_club_interventions.sql.
-- WARNING: drops the interventions and their log. Take a copy first if any
-- real interventions were recorded (select * from club_interventions / _log).
begin;
drop table if exists public.club_intervention_log;
drop policy if exists club_interventions_read on public.club_interventions;
drop function if exists public.cancel_intervention(uuid, text);
drop function if exists public.close_intervention(uuid, text, text);
drop function if exists public.intervention_act(uuid, text, text);
drop function if exists public.measure_intervention(uuid);
drop function if exists public.open_intervention(uuid, uuid, text, text, text, text, uuid, date, jsonb);
drop function if exists public.club_today_sessions(uuid);
drop function if exists public.intervention_detail(uuid);
drop function if exists public.club_interventions_list(uuid);
drop function if exists public.intervention_json(public.club_interventions);
drop function if exists public.intervention_owner_options(uuid, uuid);
drop function if exists public.intervention_metric_value(uuid, uuid, text, jsonb);
drop function if exists public.intervention_sessions(uuid, uuid, boolean);
drop function if exists public.intervention_metric_of(text);
drop function if exists public.can_work_intervention(uuid);
drop function if exists public.can_see_intervention(uuid);
drop table if exists public.club_interventions;
drop function if exists public.is_team_pro_staff(uuid);
drop function if exists public.can_manage_interventions(uuid);
commit;
