-- iplays — team photo & video gallery (link-only albums).
--
-- Run after 20261103300000_parents_edit_events.sql. Works with or without the
-- unified calendar migration (20261102500000) installed.
-- Rollback: supabase/rollback/20261103400000_team_gallery.down.sql
-- Additive only: two new tables, helpers, RPCs and notification kinds.
--
-- iplays stores NO photos or videos. A parent creates an album / folder in
-- their own cloud (Google Drive, Google Photos, iCloud, OneDrive, Dropbox),
-- turns on link sharing there and pastes the share link here. We keep only
-- the link and a few details: team, publisher, title, cloud service, linked
-- calendar event, timestamps and the publisher's consent (who + when +
-- which text version). Nothing here touches Supabase Storage and nothing
-- downloads media from the link.
--
-- Who can do what:
--   * see the gallery: members of the team (parents, followers, coaches),
--     team / club staff with access to the team, the platform admin.
--   * publish an album: any participant of the team (a parent, or staff), no
--     approval needed. Followers (grandparents etc.) only view.
--   * edit title / link / event, or delete: the publisher only. A new link
--     needs the sharing consent again.
--   * take an album off the gallery (inappropriate content, privacy): team
--     staff (coach / team admin / club admin with access) and the platform
--     admin. Removal hides the album; the files in the cloud are untouched.
--   * report an album (privacy, a minor, inappropriate, broken link): any
--     viewer. The team staff (or the platform admin when the team has no
--     staff) and the publisher are told; the reporter's name is shown only to
--     the staff.
-- Removing an album from iplays never deletes anything in the parent's cloud.
--
-- Note: the gallery's permissions do not limit the cloud link itself. Anyone
-- the link is forwarded to may open it if the parent made it public; the app
-- says so before publishing.

begin;

-- ------------------------------------------------------------- link check

-- true when p_url is a plain https share link of p_provider's own domains:
-- no user:password@, no port, no spaces / quotes / angle brackets, <= 600 chars.
create or replace function public.gallery_link_ok(p_provider text, p_url text)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v_host text;
begin
  if p_url is null or char_length(p_url) > 600 then return false; end if;
  if p_url !~* '^https://[a-z0-9.-]+(?:[/?#][^[:space:][:cntrl:]<>"''\\`{}|^]*)?$' then return false; end if;
  v_host := lower(substring(p_url from '^https://([^/?#]+)'));
  return case p_provider
    when 'google_drive' then v_host = 'drive.google.com'
    when 'google_photos' then v_host in ('photos.google.com', 'photos.app.goo.gl')
    when 'icloud' then v_host in ('www.icloud.com', 'icloud.com', 'share.icloud.com')
    when 'onedrive' then v_host in ('1drv.ms', 'onedrive.live.com') or v_host ~ '^[a-z0-9-]+\.sharepoint\.com$'
    when 'dropbox' then v_host in ('www.dropbox.com', 'dropbox.com')
    else false
  end;
end;
$$;

-- ------------------------------------------------------------- tables

create table if not exists public.team_albums (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  created_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  category text not null default 'general' check (category in ('match', 'training', 'event', 'general')),
  provider text not null check (provider in ('google_drive', 'google_photos', 'icloud', 'onedrive', 'dropbox')),
  url text not null,
  -- the calendar event the album belongs to (at most one)
  training_id uuid references public.training_sessions (id) on delete set null,
  match_id uuid references public.team_matches (id) on delete set null,
  -- a team event that is not in the calendar (e.g. end-of-season party)
  event_date date,
  -- sharing consent of the publisher (required; renewed when the link changes)
  consent_at timestamptz not null,
  consent_by uuid not null references auth.users (id) on delete cascade,
  consent_version text not null,
  -- taken off the gallery by team staff (the cloud files are untouched)
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  removed_reason text check (char_length(removed_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_albums_link_ok check (gallery_link_ok(provider, url)),
  constraint team_albums_one_event check (training_id is null or match_id is null)
);
create index if not exists team_albums_team_idx on public.team_albums (team_id, created_at desc);
create index if not exists team_albums_creator_idx on public.team_albums (created_by);

create table if not exists public.team_album_reports (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.team_albums (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete restrict,
  reported_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  reason text not null check (reason in ('privacy', 'minor', 'inappropriate', 'broken_link', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists team_album_reports_open_once on public.team_album_reports (album_id, reported_by) where status = 'open';
create index if not exists team_album_reports_team_idx on public.team_album_reports (team_id, status);

-- ------------------------------------------------------------- helpers

create or replace function public.gallery_can_view(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_member(p_team) or is_team_staff(p_team) or can_see_team(p_team) or is_platform_admin();
$$;

-- parents (not followers) and staff of the team
create or replace function public.gallery_can_post(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_participant(p_team);
$$;

create or replace function public.gallery_can_moderate(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team_admin(p_team) or is_team_staff(p_team) or is_platform_admin()
      or exists (select 1 from teams t join club_staff s on s.club_id = t.club_id
                 where t.id = p_team and s.user_id = auth.uid() and s.role in ('owner', 'admin'));
$$;

-- who hears about reports: the team's staff, else the platform admins
create or replace function public.gallery_moderator_ids(p_team uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select case when cardinality(team_staff_ids(p_team)) > 0 then team_staff_ids(p_team)
              else coalesce((select array_agg(user_id) from platform_admins), '{}') end;
$$;

-- the signed-in user's name, or null (own helper: does not need the
-- parents-edit-events migration)
create or replace function public.gallery_actor()
returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(full_name), '') from profiles where id = auth.uid();
$$;

-- The linked event must be a team-wide training / a game of the same team.
-- (to_jsonb: the audience column exists only with the calendar migration)
create or replace function public.gallery_check_event(p_team uuid, p_training uuid, p_match uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_training is not null and p_match is not null then raise exception 'one event only'; end if;
  if p_training is not null and not exists (
    select 1 from training_sessions s where s.id = p_training and s.team_id = p_team
      and coalesce(to_jsonb(s) ->> 'audience', 'team') = 'team') then
    raise exception 'event not in this team';
  end if;
  if p_match is not null and not exists (select 1 from team_matches m where m.id = p_match and m.team_id = p_team) then
    raise exception 'event not in this team';
  end if;
end;
$$;

-- Team, publisher, consent and removal are set only by the RPCs below.
create or replace function public.team_albums_before()
returns trigger language plpgsql set search_path = public as $$
begin
  new.title := btrim(new.title);
  new.url := btrim(new.url);
  if new.training_id is not null then new.category := 'training';
  elsif new.match_id is not null then new.category := 'match';
  end if;
  if new.category <> 'event' then new.event_date := null; end if;
  if tg_op = 'UPDATE' then
    new.team_id := old.team_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists team_albums_before on public.team_albums;
create trigger team_albums_before before insert or update on public.team_albums
  for each row execute function public.team_albums_before();

-- ------------------------------------------------------------- RLS

alter table public.team_albums enable row level security;
alter table public.team_album_reports enable row level security;

-- members see live albums of their team; the publisher and the staff also see removed ones
drop policy if exists team_albums_select on public.team_albums;
create policy team_albums_select on public.team_albums for select to authenticated
  using ((removed_at is null and gallery_can_view(team_id)) or created_by = auth.uid() or gallery_can_moderate(team_id));

drop policy if exists team_album_reports_select on public.team_album_reports;
create policy team_album_reports_select on public.team_album_reports for select to authenticated
  using (reported_by = auth.uid() or gallery_can_moderate(team_id));

-- no direct writes: everything goes through the RPCs (consent, link check, notifications)
revoke all on public.team_albums, public.team_album_reports from anon, authenticated;
grant select on public.team_albums, public.team_album_reports to authenticated;

-- ------------------------------------------------------------- notification kinds

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'notification_outbox_kind_check' and conrelid = 'public.notification_outbox'::regclass;
  select coalesce(array_agg(distinct m[1]), '{}') into v_kinds
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  v_kinds := v_kinds || array['gallery_album', 'gallery_report', 'gallery_removed'];
  select array_agg(distinct k order by k) into v_kinds from unnest(v_kinds) k;
  alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
  execute format('alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind = any (%L::text[])) not valid',
                 v_kinds);
end;
$$;

-- ------------------------------------------------------------- RPCs

-- The gallery of one team, newest first, with the publisher's name and the
-- linked event. Removed albums only for their publisher and the staff.
create or replace function public.team_gallery(p_team uuid)
returns table (
  id uuid, team_id uuid, title text, category text, provider text, url text,
  training_id uuid, match_id uuid, event_date date, event_label text, event_at timestamptz,
  created_by uuid, publisher text, created_at timestamptz, updated_at timestamptz,
  removed_at timestamptz, removed_reason text, is_mine boolean, open_reports int, my_report text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_mod boolean := gallery_can_moderate(p_team);
begin
  if not gallery_can_view(p_team) then raise exception 'not allowed'; end if;
  return query
  select a.id, a.team_id, a.title, a.category, a.provider, a.url,
         a.training_id, a.match_id, a.event_date,
         coalesce(s.title, case when m.id is not null then 'משחק מול ' || m.opponent end),
         coalesce(s.starts_at, m.starts_at),
         a.created_by, coalesce(nullif(btrim(p.full_name), ''), 'הורה בקבוצה'), a.created_at, a.updated_at,
         a.removed_at, case when v_mod or a.created_by = auth.uid() then a.removed_reason end,
         a.created_by = auth.uid(),
         case when v_mod then (select count(*)::int from team_album_reports r where r.album_id = a.id and r.status = 'open') else 0 end,
         (select r.reason from team_album_reports r where r.album_id = a.id and r.reported_by = auth.uid() and r.status = 'open' limit 1)
  from team_albums a
  left join profiles p on p.id = a.created_by
  left join training_sessions s on s.id = a.training_id
  left join team_matches m on m.id = a.match_id
  where a.team_id = p_team and (a.removed_at is null or v_mod or a.created_by = auth.uid())
  order by coalesce(s.starts_at, m.starts_at, a.event_date::timestamptz, a.created_at) desc, a.created_at desc;
end;
$$;

create or replace function public.publish_album(
  p_team uuid, p_title text, p_provider text, p_url text, p_category text,
  p_training uuid, p_match uuid, p_event_date date, p_consent boolean, p_consent_version text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not gallery_can_post(p_team) then raise exception 'not allowed'; end if;
  if p_consent is not true then raise exception 'consent required'; end if;
  if not gallery_link_ok(p_provider, btrim(p_url)) then raise exception 'bad link'; end if;
  perform gallery_check_event(p_team, p_training, p_match);
  insert into team_albums (team_id, created_by, title, category, provider, url, training_id, match_id, event_date,
                           consent_at, consent_by, consent_version)
  values (p_team, auth.uid(), p_title, coalesce(p_category, 'general'), p_provider, p_url, p_training, p_match, p_event_date,
          now(), auth.uid(), left(coalesce(nullif(btrim(p_consent_version), ''), 'v1'), 20))
  returning id into v_id;
  perform notify_users(team_member_ids(p_team), p_team, 'gallery_album',
    coalesce(gallery_actor() || ' פרסם/ה אלבום בגלריה', 'אלבום חדש בגלריה'), btrim(p_title),
    '#myteam/' || p_team || '/gallery', v_id, 'team_updates');
  return v_id;
end;
$$;

-- The publisher edits the title, link, cloud service or event. A different
-- link needs the consent again (p_consent), and its time is saved.
create or replace function public.update_album(
  p_album uuid, p_title text, p_provider text, p_url text, p_category text,
  p_training uuid, p_match uuid, p_event_date date, p_consent boolean, p_consent_version text
) returns void language plpgsql security definer set search_path = public as $$
declare
  a team_albums;
  v_new_link boolean;
begin
  select * into a from team_albums where id = p_album for update;
  if not found or a.created_by is distinct from auth.uid() then raise exception 'not allowed'; end if;
  if not gallery_link_ok(p_provider, btrim(p_url)) then raise exception 'bad link'; end if;
  v_new_link := btrim(p_url) <> a.url or p_provider <> a.provider;
  if v_new_link and p_consent is not true then raise exception 'consent required'; end if;
  perform gallery_check_event(a.team_id, p_training, p_match);
  update team_albums set
    title = p_title, provider = p_provider, url = p_url, category = coalesce(p_category, category),
    training_id = p_training, match_id = p_match, event_date = p_event_date,
    consent_at = case when v_new_link then now() else consent_at end,
    consent_by = case when v_new_link then auth.uid() else consent_by end,
    consent_version = case when v_new_link then left(coalesce(nullif(btrim(p_consent_version), ''), 'v1'), 20) else consent_version end
  where id = p_album;
end;
$$;

-- The publisher deletes their album (the row goes; the cloud files stay).
-- Team staff take an album off the gallery instead (kept hidden, with a reason).
create or replace function public.remove_album(p_album uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a team_albums;
begin
  select * into a from team_albums where id = p_album for update;
  if not found then raise exception 'not allowed'; end if;
  if a.created_by = auth.uid() then
    delete from team_albums where id = p_album;
  elsif gallery_can_moderate(a.team_id) then
    update team_albums set removed_at = now(), removed_by = auth.uid(), removed_reason = left(nullif(btrim(p_reason), ''), 300)
    where id = p_album and removed_at is null;
    update team_album_reports set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where album_id = p_album and status = 'open';
    perform notify_users(array[a.created_by], a.team_id, 'gallery_removed',
      'האלבום "' || left(a.title, 60) || '" הוסר מהגלריה',
      concat_ws(' · ', 'הסיר/ה: ' || gallery_actor(), nullif(btrim(p_reason), ''), 'הקבצים בענן שלך לא נמחקו'),
      '#myteam/' || a.team_id || '/gallery', p_album, null);
  else
    raise exception 'not allowed';
  end if;
end;
$$;

-- Staff put a removed album back.
create or replace function public.restore_album(p_album uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_albums where id = p_album;
  if v_team is null or not gallery_can_moderate(v_team) then raise exception 'not allowed'; end if;
  update team_albums set removed_at = null, removed_by = null, removed_reason = null where id = p_album;
end;
$$;

create or replace function public.report_album(p_album uuid, p_reason text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  a team_albums;
  v_label text;
begin
  select * into a from team_albums where id = p_album and removed_at is null;
  if not found or not gallery_can_view(a.team_id) then raise exception 'not allowed'; end if;
  if exists (select 1 from team_album_reports where album_id = p_album and reported_by = auth.uid() and status = 'open') then
    raise exception 'already reported';
  end if;
  insert into team_album_reports (album_id, team_id, reported_by, reason, note)
  values (p_album, a.team_id, auth.uid(), p_reason, left(coalesce(p_note, ''), 300));
  v_label := case p_reason when 'privacy' then 'פרטיות' when 'minor' then 'תמונות של קטין/ה'
                           when 'inappropriate' then 'תוכן לא מתאים' when 'broken_link' then 'הקישור לא נפתח' else 'אחר' end;
  -- the staff: who reported and why
  perform notify_users(gallery_moderator_ids(a.team_id), a.team_id, 'gallery_report',
    'דיווח על אלבום: ' || left(a.title, 60),
    concat_ws(' · ', v_label, gallery_actor(), nullif(btrim(p_note), '')),
    '#myteam/' || a.team_id || '/gallery', p_album, null);
  -- the publisher: why, without the reporter's name
  perform notify_users(array[a.created_by], a.team_id, 'gallery_report',
    case when p_reason = 'broken_link' then 'הורה בקבוצה לא מצליח/ה לפתוח את האלבום "' || left(a.title, 60) || '"'
         else 'התקבל דיווח על האלבום "' || left(a.title, 60) || '"' end,
    case when p_reason = 'broken_link' then 'כדאי לבדוק בשירות הענן שהשיתוף בקישור פעיל לכל מי שמחזיק בקישור'
         else v_label || ' · צוות הקבוצה יבדוק' end,
    '#myteam/' || a.team_id || '/gallery', p_album, null);
end;
$$;

-- Staff close a report without removing the album (removing closes it too).
create or replace function public.resolve_album_reports(p_album uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_albums where id = p_album;
  if v_team is null or not gallery_can_moderate(v_team) then raise exception 'not allowed'; end if;
  update team_album_reports set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  where album_id = p_album and status = 'open';
end;
$$;

-- Reports a moderator should look at (open ones), with the reporter's name.
create or replace function public.album_reports(p_album uuid)
returns table (id uuid, reason text, note text, reporter text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select a.team_id into v_team from team_albums a where a.id = p_album;
  if v_team is null or not gallery_can_moderate(v_team) then raise exception 'not allowed'; end if;
  return query
  select r.id, r.reason, r.note, coalesce(nullif(btrim(p.full_name), ''), 'חבר/ת קבוצה'), r.created_at
  from team_album_reports r left join profiles p on p.id = r.reported_by
  where r.album_id = p_album and r.status = 'open' order by r.created_at;
end;
$$;

-- ------------------------------------------------------------- grants

revoke all on function public.gallery_link_ok(text, text), public.gallery_can_view(uuid), public.gallery_can_post(uuid),
  public.gallery_can_moderate(uuid), public.gallery_moderator_ids(uuid), public.gallery_check_event(uuid, uuid, uuid),
  public.team_albums_before(), public.gallery_actor(),
  public.team_gallery(uuid), public.publish_album(uuid, text, text, text, text, uuid, uuid, date, boolean, text),
  public.update_album(uuid, text, text, text, text, uuid, uuid, date, boolean, text),
  public.remove_album(uuid, text), public.restore_album(uuid), public.report_album(uuid, text, text),
  public.resolve_album_reports(uuid), public.album_reports(uuid)
from public, anon;
revoke all on function public.gallery_moderator_ids(uuid), public.gallery_check_event(uuid, uuid, uuid), public.team_albums_before(),
  public.gallery_actor()
from authenticated;
grant execute on function public.gallery_link_ok(text, text), public.gallery_can_view(uuid), public.gallery_can_post(uuid),
  public.gallery_can_moderate(uuid),
  public.team_gallery(uuid), public.publish_album(uuid, text, text, text, text, uuid, uuid, date, boolean, text),
  public.update_album(uuid, text, text, text, text, uuid, uuid, date, boolean, text),
  public.remove_album(uuid, text), public.restore_album(uuid), public.report_album(uuid, text, text),
  public.resolve_album_reports(uuid), public.album_reports(uuid)
to authenticated;

commit;
