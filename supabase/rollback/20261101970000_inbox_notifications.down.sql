-- Rollback of 20261101970000_inbox_notifications.sql.
-- Removes the triggers and functions. The added columns (read_at, ref_id,
-- team_updates) are kept so no data is lost; the kind check is put back only
-- if no row uses a new kind (otherwise it is left wide, with a notice).

begin;

drop trigger if exists training_notify_insert on public.training_sessions;
drop trigger if exists training_notify_delete on public.training_sessions;
drop trigger if exists training_notify_update on public.training_sessions;
drop trigger if exists team_match_notify on public.team_matches;
drop trigger if exists announcement_notify on public.team_announcements;
drop trigger if exists absence_notify on public.player_absences;
drop trigger if exists join_request_notify on public.join_requests;
drop trigger if exists join_decision_notify on public.join_requests;
drop trigger if exists team_claim_notify on public.team_claims;

drop function if exists public.notify_training_insert(), public.notify_training_delete(), public.notify_training_update(),
  public.notify_team_match(), public.notify_announcement(), public.notify_absence(),
  public.notify_join_request(), public.notify_join_decision(), public.notify_team_claim(),
  public.mark_notifications_read(uuid[]),
  public.notify_users(uuid[], uuid, text, text, text, text, uuid, text),
  public.team_member_ids(uuid), public.team_staff_ids(uuid), public.il_time(timestamptz);

do $$
begin
  if not exists (select 1 from public.notification_outbox where kind not in ('match_change', 'match_result')) then
    alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
    alter table public.notification_outbox add constraint notification_outbox_kind_check
      check (kind in ('match_change', 'match_result'));
  else
    raise notice 'notification_outbox has team notifications; kind check left as is';
  end if;
end $$;

commit;
