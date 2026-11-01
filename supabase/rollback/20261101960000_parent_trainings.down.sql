-- Rollback of 20261101960000_parent_trainings.sql. Keeps every training parents added.
begin;
drop policy if exists sessions_insert_no_staff on public.training_sessions;
drop policy if exists sessions_update_no_staff on public.training_sessions;
drop policy if exists sessions_delete_no_staff on public.training_sessions;
commit;
