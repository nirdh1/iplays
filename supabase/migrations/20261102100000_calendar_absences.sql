-- iplays — unified calendar, personal / goalkeeper trainings, absences by
-- activity type, medical documents and attendance reports.
--
-- Run after 20261101999000_team_ifa_link.sql (needs the inbox, family
-- members and player career migrations, which are all installed).
-- Rollback: supabase/rollback/20261102100000_calendar_absences.down.sql
-- Additive only: new columns get defaults, nothing is deleted.
--
-- Trainings (training_sessions) get a type and an audience:
--   kind 'team'       + audience 'team'         the team's training (as before):
--                                               every member of the team sees it.
--   kind 'personal'   + audience 'players'      a parent's personal training for
--                                               their child, optionally with other
--                                               players of the team; only the
--                                               families of the participants (and
--                                               whoever created it) see it.
--   kind 'goalkeeper' + audience 'goalkeepers'  goalkeeper training for all the
--                                               team's goalkeepers (position
--                                               'שוער'); their families see it,
--                                               and team staff.
--   kind 'goalkeeper' + audience 'players'      private goalkeeper training, or a
--                                               goalkeeper coach's session with
--                                               players they picked (any player of
--                                               the team, not only goalkeepers).
-- private: booked by a family (not staff). Staff never see a private
-- training unless they created it; a staff member's session with picked
-- players (goalkeeper coach) is visible to the team's staff and counts in
-- the team's attendance report.
-- series_id groups a weekly series (e.g. every Tuesday 17:00) so it can be
-- canceled / deleted from a date onward.
--
-- Absences (player_absences): new reason 'injury' (sick stays), applies_to
-- ('all' | 'training' | 'match') narrows a date range to one kind of
-- activity. Ranges are evaluated when attendance is read, so trainings and
-- matches added later inside the range are covered automatically.
--
-- Medical documents: private Storage bucket 'medical-docs' + table
-- absence_documents. Visible only to the child's parents (and family
-- members allowed to report) and to people with the 'medical' permission at
-- level 2+ (team manager by default, club admins, or an explicit grant).
--
-- Attendance: event_attendance / mark_attendance / team_attendance_summary
-- respect the audience and applies_to; new attendance_report (staff, per
-- event, for filtering) and player_attendance (parents: their child's stats).

begin;

-- ------------------------------------------------------------ trainings

alter table public.training_sessions
  add column if not exists kind text not null default 'team',
  add column if not exists audience text not null default 'team',
  add column if not exists series_id uuid,
  add column if not exists private boolean not null default false;

alter table public.training_sessions drop constraint if exists training_sessions_kind_check;
alter table public.training_sessions add constraint training_sessions_kind_check check (
  (kind = 'team' and audience = 'team')
  or (kind = 'personal' and audience = 'players')
  or (kind = 'goalkeeper' and audience in ('goalkeepers', 'players'))
);
create index if not exists training_sessions_series_idx on public.training_sessions (series_id) where series_id is not null;

create table if not exists public.training_participants (
  session_id uuid not null references public.training_sessions (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (session_id, player_id)
);
create index if not exists training_participants_player_idx on public.training_participants (player_id);

-- Type, audience, team and creator never change after the training is created.
create or replace function public.training_sessions_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.team_id := old.team_id;
  new.kind := old.kind;
  new.audience := old.audience;
  new.created_by := old.created_by;
  new.series_id := old.series_id;
  new.private := old.private;
  return new;
end;
$$;
drop trigger if exists training_sessions_guard on public.training_sessions;
create trigger training_sessions_guard before update on public.training_sessions
  for each row execute function public.training_sessions_guard();

-- --------------------------------------------------------------- helpers

create or replace function public.try_uuid(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

-- A goalkeeper: the player's position says so (the profile's position list
-- uses 'שוער').
create or replace function public.is_goalkeeper(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where id = p_player
                 and (position ilike '%שוער%' or lower(position) in ('gk', 'goalkeeper')));
$$;

-- Is this player one of the training's players? (team: everyone in the team)
create or replace function public.session_includes(p_session uuid, p_audience text, p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_audience
    when 'team' then true
    when 'goalkeepers' then is_goalkeeper(p_player)
    else exists (select 1 from training_participants where session_id = p_session and player_id = p_player)
  end;
$$;

-- Who may see a goalkeeper / personal training (team trainings are checked
-- inline in the policy). Never reads training_sessions, so the policy
-- doesn't recurse.
create or replace function public.session_visible(p_session uuid, p_team uuid, p_audience text, p_creator uuid, p_private boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    p_creator = auth.uid()
    or case p_audience
      when 'team' then is_team_member(p_team) or can(p_team, 'training', 1)
      when 'goalkeepers' then can(p_team, 'training', 1) or exists (
        select 1 from player_assignments a join player_guardians g on g.player_id = a.player_id
        where a.team_id = p_team and a.ended_on is null and g.user_id = auth.uid() and is_goalkeeper(a.player_id))
      else (not p_private and can(p_team, 'training', 1)) or exists (
        select 1 from training_participants tp join player_guardians g on g.player_id = tp.player_id
        where tp.session_id = p_session and g.user_id = auth.uid())
    end
  );
$$;

-- Families of the team's goalkeepers.
create or replace function public.gk_guardian_ids(p_team uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct g.user_id), '{}')
  from player_assignments a join player_guardians g on g.player_id = a.player_id
  where a.team_id = p_team and a.ended_on is null and is_goalkeeper(a.player_id);
$$;

-- Families of a personal training's participants.
create or replace function public.participant_guardian_ids(p_session uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct g.user_id), '{}')
  from training_participants tp join player_guardians g on g.player_id = tp.player_id
  where tp.session_id = p_session;
$$;

-- ------------------------------------------------------------ policies

drop policy if exists sessions_select on public.training_sessions;
create policy sessions_select on public.training_sessions for select to authenticated
  using (case when audience = 'team' then is_team_member(team_id) or can(team_id, 'training', 1)
              else session_visible(id, team_id, audience, created_by, private) end);

-- staff manage the team's trainings and their own sessions with picked
-- players; a family's private training only its creator
drop policy if exists sessions_update on public.training_sessions;
create policy sessions_update on public.training_sessions for update to authenticated
  using (can(team_id, 'training', 3) and (not private or created_by = auth.uid()))
  with check (can(team_id, 'training', 3) and (not private or created_by = auth.uid()));
drop policy if exists sessions_delete on public.training_sessions;
create policy sessions_delete on public.training_sessions for delete to authenticated
  using (can(team_id, 'training', 3) and (not private or created_by = auth.uid()));

-- parents (2026-11-01 decision): any participant edits the team schedule;
-- a goalkeepers' training its goalkeepers' families; a private one its creator
drop policy if exists sessions_update_member on public.training_sessions;
create policy sessions_update_member on public.training_sessions for update to authenticated
  using (is_team_participant(team_id) and (audience = 'team' or created_by = auth.uid()
         or (audience = 'goalkeepers' and session_visible(id, team_id, audience, created_by, private))))
  with check (is_team_participant(team_id));
drop policy if exists sessions_delete_member on public.training_sessions;
create policy sessions_delete_member on public.training_sessions for delete to authenticated
  using (is_team_participant(team_id) and (audience = 'team' or created_by = auth.uid()
         or (audience = 'goalkeepers' and session_visible(id, team_id, audience, created_by, private))));

alter table public.training_participants enable row level security;
drop policy if exists training_participants_select on public.training_participants;
create policy training_participants_select on public.training_participants for select to authenticated
  using (exists (select 1 from training_sessions s where s.id = session_id));
grant select on public.training_participants to authenticated;

-- ------------------------------------------------------------ create RPC

-- Adds one training or a weekly series (p_starts: one timestamp per date).
-- Personal / goalkeeper-private trainings need p_players (players of this
-- team). A parent must include their own child; staff may pick any player.
create or replace function public.create_trainings(
  p_team uuid, p_kind text, p_audience text, p_starts timestamptz[],
  p_duration int default 90, p_title text default null, p_location text default '', p_note text default '',
  p_players uuid[] default '{}'
)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_staff boolean;
  v_n int := coalesce(cardinality(p_starts), 0);
  v_series uuid := gen_random_uuid();
  v_players uuid[];
  v_ids uuid[];
  v_title text;
  v_first timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not ((p_kind = 'team' and p_audience = 'team') or (p_kind = 'personal' and p_audience = 'players')
          or (p_kind = 'goalkeeper' and p_audience in ('goalkeepers', 'players'))) then
    raise exception 'invalid training type' using errcode = '22023';
  end if;
  if v_n < 1 or v_n > 52 then
    raise exception 'between 1 and 52 dates' using errcode = '22023';
  end if;
  v_staff := can(p_team, 'training', 2);
  if not (v_staff or is_team_participant(p_team)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_players from unnest(coalesce(p_players, '{}')) x where x is not null;
  if p_audience = 'players' then
    if cardinality(v_players) = 0 or cardinality(v_players) > 40 then
      raise exception 'pick 1 to 40 players' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_players) x
               where not exists (select 1 from player_assignments a where a.player_id = x and a.team_id = p_team and a.ended_on is null)) then
      raise exception 'player not in this team' using errcode = '22023';
    end if;
    if not v_staff and not exists (select 1 from unnest(v_players) x where family_can(x, 'report')) then
      raise exception 'include your own child' using errcode = '42501';
    end if;
  else
    v_players := '{}';
  end if;
  if p_audience = 'goalkeepers' and not v_staff and not exists (
    select 1 from player_assignments a
    where a.team_id = p_team and a.ended_on is null and is_goalkeeper(a.player_id) and family_can(a.player_id, 'report')
  ) then
    raise exception 'only for parents of a goalkeeper' using errcode = '42501';
  end if;

  v_title := coalesce(nullif(trim(p_title), ''),
    case p_kind when 'team' then 'אימון קבוצתי' when 'personal' then 'אימון אישי'
      else case p_audience when 'goalkeepers' then 'אימון שוערים קבוצתי' else 'אימון שוערים' end end);

  with ins as (
    insert into training_sessions (team_id, starts_at, duration_min, title, location, note, kind, audience, series_id, private, created_by)
    select p_team, s, coalesce(p_duration, 90), left(v_title, 60), left(trim(coalesce(p_location, '')), 80),
           left(trim(coalesce(p_note, '')), 300), p_kind, p_audience, case when v_n > 1 then v_series end,
           p_audience = 'players' and not v_staff, auth.uid()
    from unnest(p_starts) s
    returning id, starts_at
  )
  select array_agg(id order by starts_at), min(starts_at) into v_ids, v_first from ins;

  insert into training_participants (session_id, player_id, team_id)
  select i, p, p_team from unnest(v_ids) i cross join unnest(v_players) p;

  -- team / goalkeeper trainings notify from the insert trigger; personal
  -- ones here, once the participants exist
  if p_audience = 'players' and v_first > now() then
    perform notify_users(participant_guardian_ids(v_ids[1]), p_team, 'training',
      case when v_n = 1 then v_title || ' חדש' else 'נוספו ' || v_n || ' אימונים: ' || v_title end,
      concat_ws(' · ', case when v_n > 1 then 'הראשון' end, il_time(v_first), nullif(trim(coalesce(p_location, '')), '')),
      '#calendar', v_ids[1], 'team_updates');
  end if;
  return v_ids;
end;
$$;

-- ------------------------------------------------------- notifications

create or replace function public.notify_training_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select n.team_id, n.audience, count(*) n, min(n.starts_at) first_at, (array_agg(n.id order by n.starts_at))[1] first_id,
           (array_agg(n.location order by n.starts_at))[1] loc, (array_agg(n.title order by n.starts_at))[1] title
    from new_rows n where n.starts_at > now() and not n.canceled and n.audience in ('team', 'goalkeepers')
    group by n.team_id, n.audience
  loop
    perform notify_users(case r.audience when 'team' then team_member_ids(r.team_id) else gk_guardian_ids(r.team_id) end,
      r.team_id, 'training',
      case when r.audience = 'goalkeepers' then case when r.n = 1 then 'אימון שוערים חדש' else 'נוספו ' || r.n || ' אימוני שוערים' end
           when r.n = 1 then 'אימון חדש' else 'נוספו ' || r.n || ' אימונים' end,
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
    select o.team_id, o.audience, count(*) n, min(o.starts_at) first_at
    from old_rows o where o.starts_at > now() and not o.canceled and o.audience in ('team', 'goalkeepers')
    group by o.team_id, o.audience
  loop
    perform notify_users(case r.audience when 'team' then team_member_ids(r.team_id) else gk_guardian_ids(r.team_id) end,
      r.team_id, 'training',
      case when r.n = 1 then 'אימון בוטל' else r.n || ' אימונים בוטלו' end,
      case when r.n = 1 then il_time(r.first_at) else 'החל מ־' || il_time(r.first_at) end,
      '#coach/' || r.team_id, null, 'team_updates');
  end loop;
  return null;
end;
$$;

-- personal trainings: before the delete, while the participants still exist
create or replace function public.notify_private_training_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.audience = 'players' and old.starts_at > now() and not old.canceled then
    perform notify_users(participant_guardian_ids(old.id), old.team_id, 'training', 'בוטל: ' || old.title,
      il_time(old.starts_at), '#calendar', null, 'team_updates');
  end if;
  return old;
end;
$$;
drop trigger if exists training_notify_private_delete on public.training_sessions;
create trigger training_notify_private_delete before delete on public.training_sessions
  for each row execute function public.notify_private_training_delete();

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
  perform notify_users(
    case new.audience when 'team' then team_member_ids(new.team_id)
      when 'goalkeepers' then gk_guardian_ids(new.team_id) else participant_guardian_ids(new.id) end,
    new.team_id, 'training', v_title,
    concat_ws(' · ', il_time(new.starts_at), nullif(new.location, '')),
    case when new.audience = 'players' then '#calendar' else '#coach/' || new.team_id end, new.id, 'team_updates');
  return null;
end;
$$;

-- ------------------------------------------------------------- absences

alter table public.player_absences
  add column if not exists applies_to text not null default 'all',
  add column if not exists updated_at timestamptz;
alter table public.player_absences drop constraint if exists player_absences_applies_to_check;
alter table public.player_absences add constraint player_absences_applies_to_check check (applies_to in ('all', 'training', 'match'));
alter table public.player_absences drop constraint if exists player_absences_reason_check;
alter table public.player_absences add constraint player_absences_reason_check
  check (reason in ('family_event', 'vacation', 'sick', 'injury', 'school', 'other'));

create or replace function public.player_absences_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.reported_by := old.reported_by;
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists player_absences_touch on public.player_absences;
create trigger player_absences_touch before update on public.player_absences
  for each row execute function public.player_absences_touch();

-- The parent's report that covers one player at one event, if any.
create or replace function public.absence_at(p_player uuid, p_kind text, p_event uuid, p_date date)
returns table (kind text, reason text, note text, minutes_late int)
language sql stable security definer set search_path = public as $$
  select x.kind, x.reason, x.note, x.minutes_late from player_absences x
  where x.player_id = p_player
    and ((p_kind = 'training' and x.session_id = p_event)
         or (x.session_id is null and p_date between x.from_date and x.to_date and x.applies_to in ('all', p_kind)))
  order by (x.session_id is not null) desc, x.created_at desc
  limit 1;
$$;

-- ------------------------------------------------------ medical documents

-- The child's parents (and family allowed to report), and people with the
-- 'medical' permission at level 2+ in one of the child's teams.
create or replace function public.can_see_medical_docs(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select family_can(p_player, 'report') or exists (
    select 1 from player_assignments a where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'medical', 2));
$$;

create table if not exists public.absence_documents (
  id uuid primary key default gen_random_uuid(),
  absence_id uuid not null references public.player_absences (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid not null references public.teams (id) on delete restrict,
  storage_path text not null unique check (char_length(storage_path) <= 200),
  file_name text not null default '' check (char_length(file_name) <= 120),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists absence_documents_absence_idx on public.absence_documents (absence_id);

create or replace function public.absence_documents_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select x.player_id, x.team_id into new.player_id, new.team_id from player_absences x where x.id = new.absence_id;
  if new.player_id is null then
    raise exception 'absence not found' using errcode = 'P0002';
  end if;
  if split_part(new.storage_path, '/', 1) <> new.absence_id::text then
    raise exception 'file must be stored under its absence' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists absence_documents_before on public.absence_documents;
create trigger absence_documents_before before insert on public.absence_documents
  for each row execute function public.absence_documents_before();

alter table public.absence_documents enable row level security;
drop policy if exists absence_documents_select on public.absence_documents;
create policy absence_documents_select on public.absence_documents for select to authenticated
  using (can_see_medical_docs(player_id));
drop policy if exists absence_documents_insert on public.absence_documents;
create policy absence_documents_insert on public.absence_documents for insert to authenticated
  with check (uploaded_by = auth.uid() and family_can(player_id, 'report'));
drop policy if exists absence_documents_delete on public.absence_documents;
create policy absence_documents_delete on public.absence_documents for delete to authenticated
  using (family_can(player_id, 'report'));
grant select, insert, delete on public.absence_documents to authenticated;

-- Storage: medical-docs/<absence id>/<file>. Private bucket, 10 MB, images / PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medical-docs', 'medical-docs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.medical_doc_player(p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select x.player_id from player_absences x where x.id = try_uuid(split_part(p_name, '/', 1));
$$;

drop policy if exists medical_docs_insert on storage.objects;
create policy medical_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'medical-docs' and family_can(medical_doc_player(name), 'report'));
drop policy if exists medical_docs_select on storage.objects;
create policy medical_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'medical-docs' and can_see_medical_docs(medical_doc_player(name)));
drop policy if exists medical_docs_delete on storage.objects;
create policy medical_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'medical-docs' and family_can(medical_doc_player(name), 'report'));

-- ------------------------------------------------------------ attendance

-- One row per player per past, not-canceled event they were expected at,
-- with the effective status: staff mark, else the parent's report, else
-- present. Internal: the wrappers below check permissions.
--   p_team set   -> that team's current roster (team report)
--   p_player set -> that player's history in all teams
--   p_private    -> include families' private trainings
create or replace function public.attendance_cells(p_team uuid, p_player uuid, p_from date, p_to date, p_private boolean)
returns table (
  player_id uuid, team_id uuid, kind text, event_id uuid, starts_at timestamptz, title text,
  audience text, status text, reason text, source text
)
language sql stable security definer set search_path = public as $$
  with ev as (
    select 'training'::text as kind, s.id, s.team_id, s.starts_at, (s.starts_at at time zone 'Asia/Jerusalem')::date as d,
           s.title, s.audience
    from training_sessions s
    where not s.canceled and s.starts_at < now()
      and (s.starts_at at time zone 'Asia/Jerusalem')::date between p_from and p_to
      and (p_team is null or s.team_id = p_team)
      and (p_player is null or exists (select 1 from player_assignments a where a.player_id = p_player and a.team_id = s.team_id))
      and (p_private or not s.private)
    union all
    select 'match', m.id, m.team_id, m.starts_at, (m.starts_at at time zone 'Asia/Jerusalem')::date,
           case when m.home then 'נגד ' else 'אצל ' end || m.opponent, 'team'
    from team_matches m
    where m.status <> 'canceled' and m.starts_at < now()
      and (m.starts_at at time zone 'Asia/Jerusalem')::date between p_from and p_to
      and (p_team is null or m.team_id = p_team)
      and (p_player is null or exists (select 1 from player_assignments a where a.player_id = p_player and a.team_id = m.team_id))
  ),
  pl as (
    select a.player_id, a.team_id, a.started_on, a.ended_on
    from player_assignments a join players p on p.id = a.player_id and (p_team is null or p.archived_at is null)
    where (p_team is null or (a.team_id = p_team and a.ended_on is null))
      and (p_player is null or a.player_id = p_player)
  )
  select pl.player_id, ev.team_id, ev.kind, ev.id, ev.starts_at, ev.title, ev.audience,
         coalesce(r.status, case ab.kind when 'absent' then 'absent' when 'late' then 'late' end, 'present'),
         ab.reason,
         case when r.status is not null then 'mark' when ab.kind is not null then 'report' else 'default' end
  from pl
  join ev on ev.team_id = pl.team_id and ev.d >= pl.started_on and (pl.ended_on is null or ev.d <= pl.ended_on)
    and (ev.audience = 'team' or session_includes(ev.id, ev.audience, pl.player_id))
  left join attendance_records r on r.player_id = pl.player_id
    and ((ev.kind = 'training' and r.session_id = ev.id) or (ev.kind = 'match' and r.match_id = ev.id))
  left join lateral absence_at(pl.player_id, ev.kind, ev.id, ev.d) ab on true;
$$;

-- Staff: every player x event of the team in the period (filter on the client).
create or replace function public.attendance_report(p_team uuid, p_from date, p_to date)
returns table (
  player_id uuid, first_name text, last_name text, kind text, event_id uuid, starts_at timestamptz, title text,
  status text, reason text, source text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can(p_team, 'attendance', 1) then
    return;
  end if;
  return query
  select c.player_id, p.first_name, p.last_name, c.kind, c.event_id, c.starts_at, c.title, c.status, c.reason, c.source
  from attendance_cells(p_team, null, p_from, p_to, false) c join players p on p.id = c.player_id
  order by p.first_name, p.last_name, c.starts_at;
end;
$$;

-- A child's own attendance: family sees everything (personal trainings too);
-- staff see only their teams' events.
create or replace function public.player_attendance(p_player uuid, p_from date, p_to date)
returns table (team_id uuid, kind text, event_id uuid, starts_at timestamptz, title text, status text, reason text, source text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_family boolean := family_can(p_player, 'view');
begin
  if auth.uid() is null then
    return;
  end if;
  return query
  select c.team_id, c.kind, c.event_id, c.starts_at, c.title, c.status, c.reason, c.source
  from attendance_cells(null, p_player, p_from, p_to, v_family) c
  where v_family or can(c.team_id, 'attendance', 1)
  order by c.starts_at;
end;
$$;

-- Same as M4, plus: the roster of a goalkeeper / personal training is its
-- players only, a family's private training only its creator sees, and a date range
-- covers only the activity type it was reported for.
create or replace function public.event_attendance(p_kind text, p_event uuid)
returns table (
  player_id uuid, first_name text, last_name text, shirt_number int,
  expected text, reason text, report_note text, reported_minutes_late int,
  status text, minutes_late int, effective text
)
language plpgsql stable security definer set search_path = public as $$
declare
  e record;
  v_aud text := 'team';
  v_private boolean := false;
  v_creator uuid;
begin
  select * into e from event_team_and_date(p_kind, p_event);
  if p_kind = 'training' then
    select s.audience, s.private, s.created_by into v_aud, v_private, v_creator from training_sessions s where s.id = p_event;
  end if;
  if e.team_id is null or not can(e.team_id, 'attendance', 1) or (v_private and v_creator is distinct from auth.uid()) then
    return;
  end if;
  return query
  select p.id, p.first_name, p.last_name, a.shirt_number,
         coalesce(ab.kind, 'coming'), ab.reason, ab.note, ab.minutes_late,
         r.status, r.minutes_late::int,
         coalesce(r.status, case ab.kind when 'absent' then 'absent' when 'late' then 'late' else 'coming' end)
  from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  left join lateral absence_at(p.id, p_kind, p_event, e.on_date) ab on true
  left join attendance_records r on r.player_id = p.id
    and ((p_kind = 'training' and r.session_id = p_event) or (p_kind = 'match' and r.match_id = p_event))
  where a.team_id = e.team_id and a.ended_on is null
    and (v_aud = 'team' or session_includes(p_event, v_aud, p.id))
  order by a.shirt_number nulls last, p.first_name;
end;
$$;

create or replace function public.mark_attendance(
  p_kind text, p_event uuid, p_player uuid, p_status text, p_minutes_late int default null, p_note text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_aud text := 'team';
  v_private boolean := false;
  v_creator uuid;
begin
  select * into e from event_team_and_date(p_kind, p_event);
  if e.team_id is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if p_kind = 'training' then
    select s.audience, s.private, s.created_by into v_aud, v_private, v_creator from training_sessions s where s.id = p_event;
  end if;
  if not can(e.team_id, 'attendance', 2) or (v_private and v_creator is distinct from auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from player_assignments a where a.player_id = p_player and a.team_id = e.team_id and a.ended_on is null)
     or not session_includes(p_event, v_aud, p_player) then
    raise exception 'player not in this team' using errcode = '22023';
  end if;
  if p_status is null then
    delete from attendance_records
    where player_id = p_player
      and ((p_kind = 'training' and session_id = p_event) or (p_kind = 'match' and match_id = p_event));
    return;
  end if;
  if p_kind = 'training' then
    insert into attendance_records (team_id, session_id, player_id, status, minutes_late, note)
    values (e.team_id, p_event, p_player, p_status, case when p_status = 'late' then p_minutes_late end, coalesce(p_note, ''))
    on conflict (session_id, player_id) where session_id is not null do update set
      status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note,
      marked_by = auth.uid(), marked_at = now();
  else
    insert into attendance_records (team_id, match_id, player_id, status, minutes_late, note)
    values (e.team_id, p_event, p_player, p_status, case when p_status = 'late' then p_minutes_late end, coalesce(p_note, ''))
    on conflict (match_id, player_id) where match_id is not null do update set
      status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note,
      marked_by = auth.uid(), marked_at = now();
  end if;
end;
$$;

-- Same columns as M4, computed from attendance_cells.
create or replace function public.team_attendance_summary(p_team uuid, p_from date, p_to date)
returns table (player_id uuid, first_name text, last_name text, events int, present int, late int, absent int, rate int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can(p_team, 'attendance', 1) then
    return;
  end if;
  return query
  select p.id, p.first_name, p.last_name,
         count(c.event_id)::int,
         count(*) filter (where c.status = 'present')::int,
         count(*) filter (where c.status = 'late')::int,
         count(*) filter (where c.status in ('absent', 'excused'))::int,
         case when count(c.event_id) = 0 then null
              else round(100.0 * count(*) filter (where c.status in ('present', 'late')) / count(c.event_id))::int end
  from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  left join attendance_cells(p_team, null, p_from, p_to, false) c on c.player_id = a.player_id
  where a.team_id = p_team and a.ended_on is null
  group by p.id, p.first_name, p.last_name
  order by p.first_name;
end;
$$;

-- player_career: same as 20261101985000, except the trainings count (tr)
-- now comes from attendance_cells (audience + applies_to aware), so other
-- families' personal trainings are never counted.
create or replace function public.player_career(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_metrics boolean;
  v_medical boolean;
  v_out jsonb;
begin
  if auth.uid() is null or not can_view_player(p_player) then
    return '{}'::jsonb;
  end if;
  v_metrics := can_view_player_metrics(p_player);
  v_medical := can_view_player_medical(p_player);

  with
  -- every past, not-canceled match the player is linked to in any way
  m as (
    select tm.id, tm.team_id, tm.starts_at, (tm.starts_at at time zone 'Asia/Jerusalem')::date as d,
           tm.opponent, tm.home, t.sport, t.name as team_name
    from team_matches tm join teams t on t.id = tm.team_id
    where tm.status <> 'canceled' and tm.starts_at < now()
      and (exists (select 1 from attendance_records r where r.match_id = tm.id and r.player_id = p_player)
           or exists (select 1 from match_lineup_players lp join match_lineups l on l.id = lp.lineup_id
                      where lp.match_id = tm.id and lp.player_id = p_player and l.published_at is not null)
           or exists (select 1 from match_events e where e.match_id = tm.id and e.player_id = p_player
                      and e.kind = 'goal' and e.deleted_at is null))
  ),
  pm as (
    select m.*,
           (select r.status from attendance_records r where r.match_id = m.id and r.player_id = p_player) as mark,
           exists (select 1 from match_lineup_players lp join match_lineups l on l.id = lp.lineup_id
                   where lp.match_id = m.id and lp.player_id = p_player and l.published_at is not null) as in_lineup,
           exists (select 1 from match_lineup_players lp join match_lineups l on l.id = lp.lineup_id
                   where lp.match_id = m.id and lp.player_id = p_player and l.published_at is not null
                     and lp.slot is not null) as started,
           coalesce((select count(*) from match_events e
                     where e.match_id = m.id and e.player_id = p_player and e.kind = 'goal' and e.deleted_at is null
                       and e.side = case when m.home then 'home' else 'away' end), 0)::int as goals,
           coalesce((select sum(e.points) from match_events e
                     where e.match_id = m.id and e.player_id = p_player and e.kind = 'goal' and e.deleted_at is null
                       and e.side = case when m.home then 'home' else 'away' end), 0)::int as points
    from m
  ),
  app as (
    select pm.*,
           (coalesce(pm.mark, '') not in ('absent', 'excused')
            and (pm.mark in ('present', 'late') or pm.in_lineup or pm.goals > 0)) as appeared
    from pm
  ),
  -- trainings the player was expected at (team, goalkeeper and, for the
  -- family, personal trainings), same rules as the attendance report
  tr as (
    select c.event_id as id, (c.starts_at at time zone 'Asia/Jerusalem')::date as d, c.status as st
    from attendance_cells(null, p_player, date '2000-01-01', current_date, family_can(p_player, 'view')) c
    where c.kind = 'training'
  ),
  months as (
    select to_char(date_trunc('month', current_date) - (n || ' month')::interval, 'YYYY-MM') as ym
    from generate_series(0, 11) n
  )
  select jsonb_build_object(
    'player', (select jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
                        'birth_year', p.birth_year, 'shirt_number', a.shirt_number, 'position', p.position, 'strong_foot', p.strong_foot,
                        'team_id', t.id, 'team_name', t.name, 'club', coalesce(c.name, t.club), 'sport', t.sport)
               from players p
               left join lateral (select * from player_assignments x where x.player_id = p.id and x.ended_on is null
                                  order by x.is_primary desc, x.started_on desc limit 1) a on true
               left join teams t on t.id = a.team_id
               left join clubs c on c.id = t.club_id
               where p.id = p_player),
    'sport', (select t.sport from player_assignments a join teams t on t.id = a.team_id
              where a.player_id = p_player and a.ended_on is null order by a.is_primary desc limit 1),
    'totals', jsonb_build_object(
      'appearances', (select count(*) from app where appeared),
      'starts', (select count(*) from app where appeared and started),
      'goals', (select coalesce(sum(goals), 0) from app),
      'points', (select coalesce(sum(points), 0) from app),
      'trainings', (select count(*) from tr),
      'trainings_attended', (select count(*) from tr where st in ('present', 'late'))
    ),
    'seasons', coalesce((
      select jsonb_agg(x order by x.season desc, x.team_name) from (
        select season_label(d) as season, team_id, team_name,
               count(*) filter (where appeared) as appearances,
               count(*) filter (where appeared and started) as starts,
               sum(goals) as goals, sum(points) as points
        from app group by 1, 2, 3
      ) x), '[]'::jsonb),
    'monthly', (
      select jsonb_agg(jsonb_build_object(
        'month', months.ym,
        'appearances', (select count(*) from app where appeared and to_char(app.d, 'YYYY-MM') = months.ym),
        'goals', (select coalesce(sum(goals), 0) from app where to_char(app.d, 'YYYY-MM') = months.ym),
        'points', (select coalesce(sum(points), 0) from app where to_char(app.d, 'YYYY-MM') = months.ym),
        'trainings', (select count(*) from tr where to_char(tr.d, 'YYYY-MM') = months.ym),
        'trainings_attended', (select count(*) from tr where st in ('present', 'late') and to_char(tr.d, 'YYYY-MM') = months.ym)
      ) order by months.ym)
      from months
    ),
    'goal_matches', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'opponent', opponent, 'goals', goals, 'points', points, 'team', team_name)
                       order by d)
      from app where goals > 0), '[]'::jsonb),
    'assessments', case when v_metrics then coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.assessed_on, 'team_id', a.team_id,
               'speed', a.speed, 'stamina', a.stamina, 'technique', a.technique, 'vision', a.vision, 'note', a.note)
             order by a.assessed_on, a.created_at)
      from player_assessments a where a.player_id = p_player and a.deleted_at is null), '[]'::jsonb) end,
    'fitness', case when v_metrics then coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'test', f.test, 'label', ft.label, 'unit', ft.unit,
               'lower_is_better', ft.lower_is_better, 'value', f.value, 'date', f.tested_on, 'team_id', f.team_id)
             order by ft.sort, f.tested_on, f.created_at)
      from player_fitness_tests f join fitness_test_types ft on ft.code = f.test
      where f.player_id = p_player and f.deleted_at is null), '[]'::jsonb) end,
    -- the team through which the caller may add assessments / tests (null = read only)
    'edit_team_id', (select a.team_id from player_assignments a
                     where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'metrics', 3)
                     order by a.is_primary desc limit 1),
    'measurements', case when v_metrics then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'date', x.measured_on, 'height_cm', x.height_cm, 'weight_kg', x.weight_kg,
               'thigh_cm', x.thigh_cm, 'calf_cm', x.calf_cm, 'arm_cm', x.arm_cm, 'note', x.note)
             order by x.measured_on, x.created_at)
      from player_measurements x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb) end,
    'medical', case when v_medical then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'issued_on', x.issued_on, 'valid_until', x.valid_until,
               'issuer', x.issuer, 'note', x.note)
             order by x.valid_until desc, x.created_at desc)
      from player_medical_clearances x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb) end,
    'can_edit_profile', (is_player_parent(p_player) or exists (select 1 from player_assignments a
                         where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'roster', 3))),
    'can_edit_measurements', can_edit_player_domain(p_player, 'metrics', 3),
    'can_edit_medical', can_edit_player_domain(p_player, 'medical', 3)
  ) into v_out;
  return v_out;
end;
$$;
-- --------------------------------------------------------------- grants

revoke all on function public.training_sessions_guard(), public.player_absences_touch(), public.absence_documents_before(),
  public.notify_private_training_delete(), public.gk_guardian_ids(uuid), public.participant_guardian_ids(uuid),
  public.attendance_cells(uuid, uuid, date, date, boolean), public.absence_at(uuid, text, uuid, date)
from public, anon, authenticated;
revoke all on function public.try_uuid(text), public.is_goalkeeper(uuid), public.session_includes(uuid, text, uuid),
  public.session_visible(uuid, uuid, text, uuid, boolean), public.can_see_medical_docs(uuid), public.medical_doc_player(text),
  public.create_trainings(uuid, text, text, timestamptz[], int, text, text, text, uuid[]),
  public.attendance_report(uuid, date, date), public.player_attendance(uuid, date, date),
  public.event_attendance(text, uuid), public.mark_attendance(text, uuid, uuid, text, int, text),
  public.team_attendance_summary(uuid, date, date), public.player_career(uuid)
from public, anon;
grant execute on function public.try_uuid(text), public.is_goalkeeper(uuid), public.session_includes(uuid, text, uuid),
  public.session_visible(uuid, uuid, text, uuid, boolean), public.can_see_medical_docs(uuid), public.medical_doc_player(text),
  public.create_trainings(uuid, text, text, timestamptz[], int, text, text, text, uuid[]),
  public.attendance_report(uuid, date, date), public.player_attendance(uuid, date, date),
  public.event_attendance(text, uuid), public.mark_attendance(text, uuid, uuid, text, int, text),
  public.team_attendance_summary(uuid, date, date), public.player_career(uuid)
to authenticated;

do $$
begin
  raise notice 'iplays: unified calendar, personal / goalkeeper trainings, absences and medical documents installed';
end;
$$;

commit;
