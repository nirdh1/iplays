-- iplays — parents can keep the training schedule too.
--
-- Run after 20261101950000_join_no_staff_parent.sql.
-- Rollback: supabase/rollback/20261101960000_parent_trainings.down.sql
-- Adds three policies; no tables or data change.
--
-- Product decision (2026-11-01, project owner): any member of a team (a
-- parent too) can add, cancel and delete trainings, and every member sees
-- them, whether or not the team has a coach. A coach may keep updating
-- parents elsewhere (e.g. WhatsApp); that's their choice. Staff keep their
-- existing can(team, 'training', n) policies.

begin;

drop policy if exists sessions_insert_member on public.training_sessions;
create policy sessions_insert_member on public.training_sessions for insert to authenticated
  with check (is_team_member(team_id) and created_by = auth.uid());

drop policy if exists sessions_update_member on public.training_sessions;
create policy sessions_update_member on public.training_sessions for update to authenticated
  using (is_team_member(team_id)) with check (is_team_member(team_id));

drop policy if exists sessions_delete_member on public.training_sessions;
create policy sessions_delete_member on public.training_sessions for delete to authenticated
  using (is_team_member(team_id));

commit;
