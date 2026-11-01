-- iplays — the bell in the header: a real in-app inbox.
--
-- Run after 20261101990000_team_fund.sql.
-- Rollback: supabase/rollback/20261101995000_inbox_notifications.down.sql
-- Additive only: two columns on notification_outbox, one on notification_prefs,
-- a wider "kind" list, a helper, triggers and one RPC. No data is changed or
-- removed.
--
-- One queue, no duplicates: every notification (IFA game updates as before,
-- and the new team events below) is one row in notification_outbox. The same
-- row is the bell entry AND the Web Push message (notify-dispatch, push_mode
-- unchanged). read_at is set when the user opens the bell.
--
-- Events (the person who did it is never notified about their own action):
--   * training added (a batch of recurring trainings = one notification),
--     canceled / restored, moved (time or place), deleted  -> team members
--   * a team match added by the team (not IFA), moved, canceled, result
--                                                         -> team members
--   * team announcement                                   -> team members
--   * absence / late report                               -> team coach / admin
--   * new join request (still pending at commit)          -> who can approve it
--   * join request approved / rejected                    -> the requester
--   * coach asks to manage a team                         -> club admins, else platform admins
--   * that request approved / rejected                    -> the requester
-- Preferences: match_changes / match_results (existing) also cover team
-- matches; the new team_updates covers trainings, announcements, absences.
-- Requests and their answers are always delivered.

begin;

-- ------------------------------------------------------------- columns

alter table public.notification_outbox add column if not exists read_at timestamptz;
-- the row this notification is about (training, match, request, ...)
alter table public.notification_outbox add column if not exists ref_id uuid;
create index if not exists notification_outbox_unread_idx on public.notification_outbox (user_id) where read_at is null;

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'match_change', 'match_result', 'training', 'announcement', 'absence',
  'join_request', 'join_decision', 'team_claim', 'team_claim_decision'));

alter table public.notification_prefs add column if not exists team_updates boolean not null default true;

-- ------------------------------------------------------------- helper

-- Queue one notification for each of p_users (deduplicated), except the
-- current user. p_pref = a notification_prefs column, or null = always.
create or replace function public.notify_users(
  p_users uuid[], p_team uuid, p_kind text, p_title text, p_body text, p_url text,
  p_ref uuid default null, p_pref text default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  insert into notification_outbox (user_id, team_id, kind, title, body, url, ref_id)
  select distinct u, p_team, p_kind, left(p_title, 140), left(coalesce(p_body, ''), 300), coalesce(p_url, ''), p_ref
  from unnest(p_users) u
  left join notification_prefs np on np.user_id = u
  where u is not null
    and u is distinct from auth.uid()
    and case p_pref
          when 'match_changes' then coalesce(np.match_changes, true)
          when 'match_results' then coalesce(np.match_results, true)
          when 'team_updates' then coalesce(np.team_updates, true)
          else true
        end;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.team_member_ids(p_team uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from team_members where team_id = p_team;
$$;

-- coach / admin of the team, and owner / admin of its club
create or replace function public.team_staff_ids(p_team uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select m.user_id x from team_members m where m.team_id = p_team and m.role in ('admin', 'coach')
    union
    select s.user_id from teams t join club_staff s on s.club_id = t.club_id
    where t.id = p_team and s.role in ('owner', 'admin')
  ) q;
$$;

create or replace function public.il_time(p timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI');
$$;

-- ------------------------------------------------------------- trainings

-- Inserts are handled per statement, so a weekly series is one notification.
create or replace function public.notify_training_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select n.team_id, count(*) n, min(n.starts_at) first_at, (array_agg(n.id order by n.starts_at))[1] first_id,
           (array_agg(n.location order by n.starts_at))[1] loc
    from new_rows n where n.starts_at > now() and not n.canceled group by n.team_id
  loop
    perform notify_users(team_member_ids(r.team_id), r.team_id, 'training',
      case when r.n = 1 then 'אימון חדש' else 'נוספו ' || r.n || ' אימונים' end,
      concat_ws(' · ', case when r.n > 1 then 'הראשון' end, il_time(r.first_at), nullif(r.loc, '')),
      '#coach/' || r.team_id, r.first_id, 'team_updates');
  end loop;
  return null;
end;
$$;

create or replace function public.notify_training_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select o.team_id, count(*) n, min(o.starts_at) first_at
    from old_rows o where o.starts_at > now() and not o.canceled group by o.team_id
  loop
    perform notify_users(team_member_ids(r.team_id), r.team_id, 'training',
      case when r.n = 1 then 'אימון בוטל' else r.n || ' אימונים בוטלו' end,
      case when r.n = 1 then il_time(r.first_at) else 'החל מ־' || il_time(r.first_at) end,
      '#coach/' || r.team_id, null, 'team_updates');
  end loop;
  return null;
end;
$$;

create or replace function public.notify_training_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  if new.starts_at < now() and old.starts_at < now() then
    return null;
  end if;
  if new.canceled and not old.canceled then
    v_title := 'אימון בוטל';
  elsif old.canceled and not new.canceled then
    v_title := 'אימון חזר לתוכנית';
  elsif not new.canceled and (new.starts_at <> old.starts_at or new.location <> old.location) then
    v_title := 'שינוי באימון';
  else
    return null;
  end if;
  perform notify_users(team_member_ids(new.team_id), new.team_id, 'training', v_title,
    concat_ws(' · ', il_time(new.starts_at), nullif(new.location, '')), '#coach/' || new.team_id, new.id, 'team_updates');
  return null;
end;
$$;

drop trigger if exists training_notify_insert on public.training_sessions;
create trigger training_notify_insert after insert on public.training_sessions
  referencing new table as new_rows for each statement execute function public.notify_training_insert();
drop trigger if exists training_notify_delete on public.training_sessions;
create trigger training_notify_delete after delete on public.training_sessions
  referencing old table as old_rows for each statement execute function public.notify_training_delete();
drop trigger if exists training_notify_update on public.training_sessions;
create trigger training_notify_update after update on public.training_sessions
  for each row execute function public.notify_training_update();

-- ------------------------------------------------------- team matches
-- IFA games (ifa_game set) keep their own pipeline (ifa_enqueue_update).

create or replace function public.notify_team_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_pref text := 'match_changes';
  v_kind text := 'match_change';
  v_vs text;
begin
  if new.ifa_game is not null then
    return null;
  end if;
  v_vs := 'מול ' || new.opponent;
  if tg_op = 'INSERT' then
    if new.starts_at < now() then
      return null;
    end if;
    v_title := 'משחק חדש ' || v_vs;
  elsif new.status = 'canceled' and old.status <> 'canceled' then
    v_title := 'משחק בוטל: ' || v_vs;
  elsif new.status = 'played' and new.score_for is not null
        and (old.status <> 'played' or new.score_for is distinct from old.score_for
             or new.score_against is distinct from old.score_against) then
    v_title := 'תוצאה ' || v_vs || ': ' || new.score_for || '–' || coalesce(new.score_against, 0);
    v_pref := 'match_results';
    v_kind := 'match_result';
  elsif new.status = 'scheduled' and (new.starts_at <> old.starts_at or new.venue <> old.venue or old.status <> 'scheduled') then
    v_title := 'עדכון משחק ' || v_vs;
  else
    return null;
  end if;
  perform notify_users(team_member_ids(new.team_id), new.team_id, v_kind, v_title,
    concat_ws(' · ', il_time(new.starts_at), nullif(new.venue, '')), '#matches/' || new.team_id, new.id, v_pref);
  return null;
end;
$$;

drop trigger if exists team_match_notify on public.team_matches;
create trigger team_match_notify after insert or update on public.team_matches
  for each row execute function public.notify_team_match();

-- ------------------------------------------------------- announcements

create or replace function public.notify_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_users(team_member_ids(new.team_id), new.team_id, 'announcement',
    'הודעה מהקבוצה: ' || new.title, left(new.body, 300), '#coach/' || new.team_id, new.id, 'team_updates');
  return null;
end;
$$;

drop trigger if exists announcement_notify on public.team_announcements;
create trigger announcement_notify after insert on public.team_announcements
  for each row execute function public.notify_announcement();

-- ------------------------------------------------------- absences

create or replace function public.notify_absence()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_child text;
begin
  select trim(first_name || ' ' || last_name) into v_child from players where id = new.player_id;
  perform notify_users(team_staff_ids(new.team_id), new.team_id, 'absence',
    case new.kind when 'late' then v_child || ' יאחר/תאחר' else v_child || ' לא יגיע/תגיע' end,
    case when new.from_date = new.to_date then to_char(new.from_date, 'DD/MM')
         else to_char(new.from_date, 'DD/MM') || '–' || to_char(new.to_date, 'DD/MM') end,
    '#coach/' || new.team_id, new.id, 'team_updates');
  return null;
end;
$$;

drop trigger if exists absence_notify on public.player_absences;
create trigger absence_notify after insert on public.player_absences
  for each row execute function public.notify_absence();

-- ------------------------------------------------------- join requests

-- Deferred to commit: request_join may approve the request in the same
-- transaction (team with no staff); then nobody needs to approve it.
create or replace function public.notify_join_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r join_requests%rowtype;
  v_who text;
  v_child text;
  v_team text;
  v_to uuid[];
  v_url text;
begin
  select * into r from join_requests where id = new.id;
  if not found or r.status <> 'pending' then
    return null;
  end if;
  select coalesce(nullif(full_name, ''), 'משתמש/ת') into v_who from profiles where id = r.user_id;
  select name into v_team from teams where id = r.team_id;
  v_child := coalesce((select trim(first_name || ' ' || last_name) from players where id = r.player_id),
                      trim(r.child_first || ' ' || r.child_last));
  if r.relation = 'parent' and team_has_staff(r.team_id) then
    v_to := team_staff_ids(r.team_id);
    v_url := '#myteam/' || r.team_id;
  else
    -- followers, and parents on a team with no staff: the child's declared parent
    select coalesce(array_agg(user_id), '{}') into v_to
    from player_guardians where player_id = r.player_id and relation = 'parent';
    v_url := '#family';
  end if;
  perform notify_users(v_to, r.team_id, 'join_request',
    'בקשה ממתינה לאישורך',
    coalesce(v_who, 'משתמש/ת') || case r.relation when 'family' then ' רוצה לעקוב אחרי ' else ' (הורה) של ' end
      || v_child || ' · ' || coalesce(v_team, ''),
    v_url, r.id, null);
  return null;
end;
$$;

drop trigger if exists join_request_notify on public.join_requests;
create constraint trigger join_request_notify after insert on public.join_requests
  deferrable initially deferred for each row execute function public.notify_join_request();

create or replace function public.notify_join_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'pending' or new.status not in ('approved', 'rejected') or new.reviewed_by is null then
    return null;
  end if;
  perform notify_users(array[new.user_id], new.team_id, 'join_decision',
    case new.status when 'approved' then 'הבקשה שלך אושרה' else 'הבקשה שלך לא אושרה' end,
    (select name from teams where id = new.team_id),
    case new.status when 'approved' then '#t/' || new.team_id else '#family' end, new.id, null);
  return null;
end;
$$;

drop trigger if exists join_decision_notify on public.join_requests;
create trigger join_decision_notify after update of status on public.join_requests
  for each row execute function public.notify_join_decision();

-- ------------------------------------------------------- team claims

create or replace function public.notify_team_claim()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_to uuid[];
  v_club uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      return null;
    end if;
    select club_id into v_club from teams where id = new.team_id;
    select coalesce(array_agg(user_id), '{}') into v_to from club_staff
    where club_id = v_club and role in ('owner', 'admin');
    if cardinality(v_to) = 0 then
      select coalesce(array_agg(user_id), '{}') into v_to from platform_admins;
    end if;
    perform notify_users(v_to, new.team_id, 'team_claim', 'בקשה לנהל קבוצה',
      coalesce((select nullif(full_name, '') from profiles where id = new.user_id), 'משתמש/ת') || ' · '
        || (select name from teams where id = new.team_id),
      '#family', new.id, null);
  elsif old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform notify_users(array[new.user_id], new.team_id, 'team_claim_decision',
      case new.status when 'approved' then 'אושרת כמאמן/ת הקבוצה' else 'הבקשה לנהל את הקבוצה לא אושרה' end,
      (select name from teams where id = new.team_id),
      case new.status when 'approved' then '#myteam/' || new.team_id else '#family' end, new.id, null);
  end if;
  return null;
end;
$$;

drop trigger if exists team_claim_notify on public.team_claims;
create trigger team_claim_notify after insert or update of status on public.team_claims
  for each row execute function public.notify_team_claim();

-- ------------------------------------------------------- read state

-- Mark the caller's notifications read: the given ids, or all when null.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update notification_outbox set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.notify_users(uuid[], uuid, text, text, text, text, uuid, text),
  public.team_member_ids(uuid), public.team_staff_ids(uuid),
  public.notify_training_insert(), public.notify_training_delete(), public.notify_training_update(),
  public.notify_team_match(), public.notify_announcement(), public.notify_absence(),
  public.notify_join_request(), public.notify_join_decision(), public.notify_team_claim()
from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

commit;
