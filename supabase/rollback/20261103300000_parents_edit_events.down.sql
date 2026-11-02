-- Rollback of 20261103300000_parents_edit_events.sql.
-- Restores the earlier notification and IFA override functions, drops the
-- parent policies on club games and the new helpers. Every training, game and
-- notification stays.

begin;

drop policy if exists matches_insert_member on public.team_matches;
drop policy if exists matches_update_member on public.team_matches;

drop policy if exists team_match_overrides_select on public.team_match_overrides;
create policy team_match_overrides_select on public.team_match_overrides for select to authenticated
  using (exists (select 1 from team_matches m where m.id = match_id and can(m.team_id, 'matches', 3)));

-- trainings (as in 20261102500000_calendar_absences.sql)
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

-- club games (as in 20261101995000_inbox_notifications.sql)
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

-- IFA overrides (as in 20261102200000_match_overrides.sql)
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
  if not can(m.team_id, 'matches', 3) then
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
end;
$$;

create or replace function public.release_match_override(p_match uuid, p_field text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ov team_match_overrides;
  v_team uuid;
begin
  select team_id into v_team from team_matches where id = p_match;
  if v_team is null or not can(v_team, 'matches', 3) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into ov from team_match_overrides where match_id = p_match and field = p_field and status = 'active' for update;
  if ov.id is null then
    return;
  end if;
  update team_match_overrides set status = 'released', released_by = auth.uid(), released_at = now() where id = ov.id;
  if coalesce(ov.conflict_ifa_value, ov.ifa_value) is not null then
    perform match_write_field(p_match, p_field, coalesce(ov.conflict_ifa_value, ov.ifa_value));
  end if;
end;
$$;

create or replace function public.resolve_match_conflict(p_match uuid, p_field text, p_keep_mine boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_matches where id = p_match;
  if v_team is null or not can(v_team, 'matches', 3) then
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

drop function if exists public.edit_training(uuid, timestamptz, int, text, text, text, boolean);
drop function if exists public.notify_match_override(uuid);
drop function if exists public.can_override_match_field(uuid, text);
drop function if exists public.actor_title(text, text);
drop function if exists public.actor_name();

commit;
