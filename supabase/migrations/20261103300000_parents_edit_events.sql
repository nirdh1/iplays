-- iplays — parents edit trainings and games, and everyone hears who changed what.
--
-- Run after 20261102500000_calendar_absences.sql, 20261101995000_inbox_notifications.sql,
-- 20261102200000_match_overrides.sql and 20261103100000_schedule_import.sql.
-- Rollback: supabase/rollback/20261103300000_parents_edit_events.down.sql
-- Additive: two policies, new functions, and new versions of existing
-- notification / override functions. No table or row is changed.
--
-- Owner's decisions (2026-11-02):
--   * a parent may edit and change trainings and games too, not only the coach
--     (same rule as adding: any participant of the team, not a follower);
--   * everyone in the team gets a notification about the change, naming who
--     made it, e.g. "דנה כהן עדכן את ימי האימון".
--
-- Trainings: the policies from 20261102500000 already let parents update and
-- delete. New here: edit_training() changes one training and, optionally,
-- the later ones of its weekly series in one go (one notification), and the
-- notifications name the person and also cover title / length / note changes.
-- Club games (not IFA): parents may add, edit, cancel them.
-- IFA games: parents may set the time and the venue (the coach's override
-- rules apply); the score and status stay with staff.

begin;

-- --------------------------------------------------------------- helpers

-- The current user's name for notification titles ('' when unknown).
create or replace function public.actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(full_name), '') from profiles where id = auth.uid()), '');
$$;

-- "<name> <verb>" or the fallback text when the name is unknown.
create or replace function public.actor_title(p_verb text, p_fallback text)
returns text language sql stable security definer set search_path = public as $$
  select case when actor_name() = '' then p_fallback else actor_name() || ' ' || p_verb end;
$$;

-- ------------------------------------------------------------- trainings

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
      case when r.audience = 'goalkeepers' then
             case when r.n = 1 then actor_title('הוסיף אימון שוערים', 'אימון שוערים חדש')
                  else actor_title('הוסיף ' || r.n || ' אימוני שוערים', 'נוספו ' || r.n || ' אימוני שוערים') end
           when r.n = 1 then actor_title('הוסיף אימון', 'אימון חדש')
           else actor_title('הוסיף ' || r.n || ' אימונים', 'נוספו ' || r.n || ' אימונים') end,
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
      case when r.n = 1 then actor_title('מחק את האימון', 'אימון בוטל')
           else actor_title('מחק ' || r.n || ' אימונים', r.n || ' אימונים בוטלו') end,
      case when r.n = 1 then il_time(r.first_at) else 'החל מ־' || il_time(r.first_at) end,
      '#coach/' || r.team_id, null, 'team_updates');
  end loop;
  return null;
end;
$$;

-- One notification per change; edit_training() marks its transaction so a
-- series edit sends a single "updated the training days" notification.
create or replace function public.notify_training_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_series boolean := coalesce(current_setting('iplays.training_series_edit', true), '') = 'on';
begin
  if new.starts_at < now() and old.starts_at < now() then
    return null;
  end if;
  if coalesce(current_setting('iplays.training_notified', true), '') = 'on' then
    return null;
  end if;
  if new.canceled and not old.canceled then
    v_title := actor_title('ביטל את האימון', 'אימון בוטל');
  elsif old.canceled and not new.canceled then
    v_title := actor_title('החזיר את האימון ללוח', 'אימון חזר לתוכנית');
  elsif not new.canceled and (new.starts_at <> old.starts_at or new.location is distinct from old.location
        or new.title is distinct from old.title or new.duration_min is distinct from old.duration_min
        or new.note is distinct from old.note) then
    v_title := case when v_series then actor_title('עדכן את ימי האימון', 'ימי האימון עודכנו')
                    else actor_title('עדכן את האימון', 'שינוי באימון') end;
  else
    return null;
  end if;
  if v_series then
    perform set_config('iplays.training_notified', 'on', true);
  end if;
  perform notify_users(
    case new.audience when 'team' then team_member_ids(new.team_id)
      when 'goalkeepers' then gk_guardian_ids(new.team_id) else participant_guardian_ids(new.id) end,
    new.team_id, 'training', v_title,
    concat_ws(' · ', nullif(new.title, ''), il_time(new.starts_at), nullif(new.location, '')),
    case when new.audience = 'players' then '#calendar' else '#coach/' || new.team_id end, new.id, 'team_updates');
  return null;
end;
$$;

-- Edit one training; with p_following, the later trainings of its weekly
-- series get the same time of day, length, title, place and note (their dates
-- stay). Runs as the caller, so the training policies decide who may.
-- Returns how many trainings changed.
create or replace function public.edit_training(
  p_session uuid, p_starts timestamptz, p_duration int, p_title text, p_location text, p_note text,
  p_following boolean default false
) returns int language plpgsql security invoker set search_path = public as $$
declare
  s training_sessions;
  v_n int := 0;
  v_more int := 0;
  v_time time;
begin
  select * into s from training_sessions where id = p_session;
  if s.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_starts is null or p_duration is null or p_duration < 15 or p_duration > 480 then
    raise exception 'bad time or length' using errcode = '22023';
  end if;
  if p_following and s.series_id is not null then
    perform set_config('iplays.training_series_edit', 'on', true);
  end if;
  update training_sessions
  set starts_at = p_starts, duration_min = p_duration,
      title = coalesce(nullif(left(btrim(coalesce(p_title, '')), 60), ''), title),
      location = left(btrim(coalesce(p_location, '')), 80), note = left(btrim(coalesce(p_note, '')), 300)
  where id = p_session;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_following and s.series_id is not null then
    v_time := (p_starts at time zone 'Asia/Jerusalem')::time;
    update training_sessions
    set starts_at = ((starts_at at time zone 'Asia/Jerusalem')::date + v_time) at time zone 'Asia/Jerusalem',
        duration_min = p_duration,
        title = coalesce(nullif(left(btrim(coalesce(p_title, '')), 60), ''), title),
        location = left(btrim(coalesce(p_location, '')), 80), note = left(btrim(coalesce(p_note, '')), 300)
    where series_id = s.series_id and id <> s.id and starts_at > s.starts_at;
    get diagnostics v_more = row_count;
  end if;
  perform set_config('iplays.training_series_edit', 'off', true);
  perform set_config('iplays.training_notified', 'off', true);
  return v_n + v_more;
end;
$$;

-- ---------------------------------------------------------- club games

drop policy if exists matches_insert_member on public.team_matches;
create policy matches_insert_member on public.team_matches for insert to authenticated
  with check (is_team_participant(team_id));
drop policy if exists matches_update_member on public.team_matches;
create policy matches_update_member on public.team_matches for update to authenticated
  using (is_team_participant(team_id) and source is distinct from 'ifa')
  with check (is_team_participant(team_id) and source is distinct from 'ifa');

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
    v_title := actor_title('הוסיף משחק ' || v_vs, 'משחק חדש ' || v_vs);
  elsif new.status = 'canceled' and old.status <> 'canceled' then
    v_title := actor_title('ביטל את המשחק ' || v_vs, 'משחק בוטל: ' || v_vs);
  elsif new.status = 'played' and new.score_for is not null
        and (old.status <> 'played' or new.score_for is distinct from old.score_for
             or new.score_against is distinct from old.score_against) then
    v_title := 'תוצאה ' || v_vs || ': ' || new.score_for || '–' || coalesce(new.score_against, 0);
    v_pref := 'match_results';
    v_kind := 'match_result';
  elsif new.status = 'scheduled' and (new.starts_at <> old.starts_at or new.venue <> old.venue or old.status <> 'scheduled'
        or new.opponent <> old.opponent or new.home <> old.home or new.competition <> old.competition) then
    v_title := actor_title('עדכן את המשחק ' || v_vs, 'עדכון משחק ' || v_vs);
  else
    return null;
  end if;
  perform notify_users(team_member_ids(new.team_id), new.team_id, v_kind, v_title,
    concat_ws(' · ', il_time(new.starts_at), nullif(new.venue, '')), '#matches/' || new.team_id, new.id, v_pref);
  return null;
end;
$$;

-- ------------------------------------------------------------ IFA games

-- Staff who may edit matches: every field. A parent of the team: time and venue.
create or replace function public.can_override_match_field(p_team uuid, p_field text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (can(p_team, 'matches', 3)
    or (p_field in ('starts_at', 'venue') and is_team_participant(p_team)));
$$;

drop policy if exists team_match_overrides_select on public.team_match_overrides;
create policy team_match_overrides_select on public.team_match_overrides for select to authenticated
  using (exists (select 1 from team_matches m where m.id = match_id
                 and (can(m.team_id, 'matches', 3) or is_team_participant(m.team_id))));

-- Everyone in the team hears about a hand change to an IFA game.
create or replace function public.notify_match_override(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches;
begin
  select * into m from team_matches where id = p_match;
  if m.id is null or m.starts_at < now() then
    return;
  end if;
  perform notify_users(team_member_ids(m.team_id), m.team_id, 'match_change',
    actor_title('עדכן את המשחק מול ' || m.opponent, 'עדכון משחק מול ' || m.opponent),
    concat_ws(' · ', il_time(m.starts_at), nullif(m.venue, '')), '#matches/' || m.team_id, m.id, 'match_changes');
end;
$$;

create or replace function public.set_match_override(p_match uuid, p_field text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches;
  v_value jsonb;
begin
  select * into m from team_matches where id = p_match;
  if m.id is null then
    raise exception 'match not found' using errcode = 'P0002';
  end if;
  if not can_override_match_field(m.team_id, p_field) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if m.source <> 'ifa' then
    raise exception 'only IFA games need an override; edit this match directly' using errcode = '22023';
  end if;
  v_value := match_override_value(p_field, p_value);
  update team_match_overrides set value = v_value, set_by = auth.uid(), set_at = now()
  where match_id = p_match and field = p_field and status = 'active';
  if not found then
    -- the row holds the IFA value while nothing is overridden
    insert into team_match_overrides (match_id, field, value, ifa_value, set_by)
    values (p_match, p_field, v_value, match_field_value(m, p_field), auth.uid());
  end if;
  perform match_write_field(p_match, p_field, v_value);
  if p_field in ('starts_at', 'venue', 'status') then
    perform notify_match_override(p_match);
  end if;
end;
$$;

-- Back to the IFA value (the newest one seen).
create or replace function public.release_match_override(p_match uuid, p_field text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ov team_match_overrides;
  v_team uuid;
begin
  select team_id into v_team from team_matches where id = p_match;
  if v_team is null or not can_override_match_field(v_team, p_field) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into ov from team_match_overrides where match_id = p_match and field = p_field and status = 'active' for update;
  if ov.id is null then
    return;
  end if;
  update team_match_overrides set status = 'released', released_by = auth.uid(), released_at = now() where id = ov.id;
  if coalesce(ov.conflict_ifa_value, ov.ifa_value) is not null then
    perform match_write_field(p_match, p_field, coalesce(ov.conflict_ifa_value, ov.ifa_value));
    if p_field in ('starts_at', 'venue', 'status') then
      perform notify_match_override(p_match);
    end if;
  end if;
end;
$$;

create or replace function public.resolve_match_conflict(p_match uuid, p_field text, p_keep_mine boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_matches where id = p_match;
  if v_team is null or not can_override_match_field(v_team, p_field) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_keep_mine then
    update team_match_overrides
    set ifa_value = conflict_ifa_value, conflict_ifa_value = null, conflict_at = null
    where match_id = p_match and field = p_field and status = 'active' and conflict_ifa_value is not null;
  else
    perform release_match_override(p_match, p_field);
  end if;
end;
$$;

revoke all on function public.actor_name(), public.actor_title(text, text), public.notify_match_override(uuid),
  public.can_override_match_field(uuid, text), public.edit_training(uuid, timestamptz, int, text, text, text, boolean) from public, anon;
revoke all on function public.notify_match_override(uuid) from authenticated;
grant execute on function public.can_override_match_field(uuid, text),
  public.edit_training(uuid, timestamptz, int, text, text, text, boolean) to authenticated;

commit;
