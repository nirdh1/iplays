-- Rollback of 20261103600000_app_feedback.sql.
-- Drops the feedback messages table and its functions (the messages are lost).
-- The notification kinds stay allowed (old feedback notifications remain in the bell).

begin;

drop function if exists public.admin_update_feedback(uuid, text, text);
drop function if exists public.admin_feedback_list(text);
drop function if exists public.submit_feedback(text, text, text, text, text);
drop table if exists public.app_feedback;

commit;

notify pgrst, 'reload schema';
