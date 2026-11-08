-- Rollback of 20261106300000_session_plans.sql (drops plans and assignments; training_sessions untouched).
drop function if exists public.session_plan_summary(uuid);
drop function if exists public.unassign_session_plan(uuid);
drop function if exists public.assign_session_plan(uuid, uuid);
drop function if exists public.delete_session_plan(uuid);
drop function if exists public.save_session_plan(uuid, uuid, jsonb);
drop function if exists public.team_session_plans(uuid);
drop function if exists public.session_plan_json(uuid);
drop function if exists public.plan_block_minutes(text, int, int, int, int);
drop table if exists public.session_plan_assignments;
drop table if exists public.session_plan_stations;
drop table if exists public.session_plan_blocks;
drop table if exists public.session_plans;
drop function if exists public.can_read_plans(uuid);
