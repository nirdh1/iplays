-- iplays — parents keep the training schedule while a team has no coach.
--
-- Run after 20261101950000_join_no_staff_parent.sql.
-- Rollback: supabase/rollback/20261101960000_parent_trainings.down.sql
-- Adds three policies; no tables or data change.
--
-- Product decision (2026-11-01, project owner): on a team that nobody manages
-- yet (team_has_staff = false, e.g. an IFA-imported team), any member of the
-- team (a parent) can add, cancel and delete trainings, and every member sees
-- them. Once a coach / club admin takes over, only staff edit the schedule
-- again (the existing can(team, 'training', n) policies).

begin;

drop policy if exists sessions_insert_no_staff on public.training_sessions;
create policy sessions_insert_no_staff on public.training_sessions for insert to authenticated
  with check (is_team_member(team_id) and not team_has_staff(team_id) and created_by = auth.uid());

drop policy if exists sessions_update_no_staff on public.training_sessions;
create policy sessions_update_no_staff on public.training_sessions for update to authenticated
  using (is_team_member(team_id) and not team_has_staff(team_id))
  with check (is_team_member(team_id) and not team_has_staff(team_id));

drop policy if exists sessions_delete_no_staff on public.training_sessions;
create policy sessions_delete_no_staff on public.training_sessions for delete to authenticated
  using (is_team_member(team_id) and not team_has_staff(team_id));

commit;
