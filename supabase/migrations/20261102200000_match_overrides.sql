-- iplays — coach overrides on IFA league games, field by field, with conflict
-- prompts.
--
-- Run after 20261102100000_ifa_roster_review.sql. Additive only: one new table,
-- one new trigger on team_matches, new functions. The IFA mirror
-- (ifa_mirror_game) and its guard are not changed.
-- Rollback: supabase/rollback/20261102200000_match_overrides.down.sql (drops the
-- trigger and functions; keeps the table and every row).
--
-- Rules (owner's spec, section 15):
--   * staff who may edit matches (can(team, 'matches', 3)) can set their own
--     value for one field of an IFA game: time (starts_at), venue, status or
--     score. That field then keeps the coach's value; the other fields keep
--     following the IFA.
--   * the sync keeps checking: when the IFA value of an overridden field
--     changes and differs from the coach's value, a conflict is recorded and
--     shown with both versions. Until the coach chooses, their value stays.
--   * "keep mine" acknowledges that IFA value: the same conflict is not shown
--     again unless the IFA value changes again. "Take IFA" drops the override
--     and applies the IFA value.
--   * when the IFA comes to agree with the coach, the conflict closes itself.

begin;

create table if not exists public.team_match_overrides (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.team_matches (id) on delete restrict,
  field text not null check (field in ('starts_at', 'venue', 'status', 'score')),
  value jsonb not null,
  ifa_value jsonb,
  conflict_ifa_value jsonb,
  conflict_at timestamptz,
  status text not null default 'active' check (status in ('active', 'released')),
  set_by uuid references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  released_by uuid references auth.users (id) on delete set null,
  released_at timestamptz
);
create unique index if not exists team_match_overrides_active_idx
  on public.team_match_overrides (match_id, field) where status = 'active';

alter table public.team_match_overrides enable row level security;
drop policy if exists team_match_overrides_select on public.team_match_overrides;
create policy team_match_overrides_select on public.team_match_overrides for select to authenticated
  using (exists (select 1 from team_matches m where m.id = match_id and can(m.team_id, 'matches', 3)));
revoke insert, update, delete on public.team_match_overrides from authenticated, anon;
grant select on public.team_match_overrides to authenticated;

-- ------------------------------------------------------------ helpers
-- The value of one field of a match row, as stored in overrides.
create or replace function public.match_field_value(m public.team_matches, p_field text)
returns jsonb language sql immutable set search_path = public as $$
  select case p_field
    when 'starts_at' then jsonb_build_object('starts_at', m.starts_at, 'time_confirmed', m.time_confirmed)
    when 'venue' then to_jsonb(m.venue)
    when 'status' then to_jsonb(m.status)
    when 'score' then jsonb_build_array(m.score_for, m.score_against)
  end;
$$;

-- Validate a value sent by the app; returns it normalised, or raises.
create or replace function public.match_override_value(p_field text, p_value jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_ts timestamptz;
  v_a int;
  v_b int;
begin
  if p_field = 'starts_at' then
    v_ts := (p_value->>'starts_at')::timestamptz;
    if v_ts is null then raise exception 'starts_at is required' using errcode = '22023'; end if;
    return jsonb_build_object('starts_at', v_ts, 'time_confirmed', true);
  elsif p_field = 'venue' then
    if jsonb_typeof(p_value) <> 'string' or char_length(p_value#>>'{}') > 80 then
      raise exception 'venue must be text up to 80 characters' using errcode = '22023';
    end if;
    return to_jsonb(trim(p_value#>>'{}'));
  elsif p_field = 'status' then
    if coalesce(p_value#>>'{}', '') not in ('scheduled', 'played', 'canceled') then
      raise exception 'status must be scheduled, played or canceled' using errcode = '22023';
    end if;
    return p_value;
  elsif p_field = 'score' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) <> 2 then
      raise exception 'score must be [ours, theirs]' using errcode = '22023';
    end if;
    v_a := (p_value->>0)::int;
    v_b := (p_value->>1)::int;
    if (v_a is null) <> (v_b is null) or v_a not between 0 and 300 or v_b not between 0 and 300 then
      raise exception 'score must be two numbers 0-300, or both empty' using errcode = '22023';
    end if;
    return jsonb_build_array(v_a, v_b);
  end if;
  raise exception 'unknown field %', p_field using errcode = '22023';
end;
$$;

-- Put one field's value into a match row (inside a trigger: on NEW).
create or replace function public.match_put_field(m public.team_matches, p_field text, p_value jsonb)
returns public.team_matches language plpgsql immutable set search_path = public as $$
begin
  if p_field = 'starts_at' then
    m.starts_at := (p_value->>'starts_at')::timestamptz;
    m.time_confirmed := coalesce((p_value->>'time_confirmed')::boolean, true);
  elsif p_field = 'venue' then
    m.venue := p_value#>>'{}';
  elsif p_field = 'status' then
    m.status := p_value#>>'{}';
  elsif p_field = 'score' then
    m.score_for := (p_value->>0)::int;
    m.score_against := (p_value->>1)::int;
  end if;
  return m;
end;
$$;

-- ------------------------------------------------------------- trigger
-- Runs after team_matches_ifa_guard (name order). Only on IFA mirror writes
-- (iplays.ifa_sync = on) of IFA games: NEW holds the IFA values.
create or replace function public.team_matches_keep_overrides()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ov team_match_overrides;
  v_ifa jsonb;
  v_applying boolean := coalesce(current_setting('iplays.override_apply', true), '') = 'on';
begin
  if coalesce(current_setting('iplays.ifa_sync', true), '') <> 'on' or old.source <> 'ifa' then
    return new;
  end if;
  for ov in select * from team_match_overrides where match_id = new.id and status = 'active' loop
    if not v_applying then
      v_ifa := match_field_value(new, ov.field);
      if v_ifa is not distinct from ov.value then
        -- the IFA now says what the coach said: nothing to ask
        update team_match_overrides set ifa_value = v_ifa, conflict_ifa_value = null, conflict_at = null where id = ov.id;
      elsif v_ifa is not distinct from ov.ifa_value then
        if ov.conflict_ifa_value is not null then
          update team_match_overrides set conflict_ifa_value = null, conflict_at = null where id = ov.id;
        end if;
      elsif v_ifa is distinct from ov.conflict_ifa_value then
        update team_match_overrides set conflict_ifa_value = v_ifa, conflict_at = now() where id = ov.id;
      end if;
    end if;
    new := match_put_field(new, ov.field, ov.value);
  end loop;
  return new;
end;
$$;
drop trigger if exists team_matches_keep_overrides on public.team_matches;
create trigger team_matches_keep_overrides before update on public.team_matches
  for each row execute function public.team_matches_keep_overrides();

-- write one field of an IFA game row past the guard
create or replace function public.match_write_field(p_match uuid, p_field text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  m team_matches;
begin
  select * into m from team_matches where id = p_match;
  m := match_put_field(m, p_field, p_value);
  perform set_config('iplays.ifa_sync', 'on', true);
  perform set_config('iplays.override_apply', 'on', true);
  update team_matches
  set starts_at = m.starts_at, time_confirmed = m.time_confirmed, venue = m.venue, status = m.status,
      score_for = m.score_for, score_against = m.score_against
  where id = p_match;
  perform set_config('iplays.override_apply', 'off', true);
  perform set_config('iplays.ifa_sync', 'off', true);
end;
$$;

-- --------------------------------------------------------------- RPCs
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

-- Back to the IFA value (the newest one seen).
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

-- keep mine: acknowledge the IFA value (not shown again unless it changes);
-- take IFA: release the override.
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

-- Open conflicts in teams I may edit (home counter and the matches screen).
create or replace function public.my_match_conflicts()
returns table (match_id uuid, team_id uuid, team_name text, opponent text, starts_at timestamptz,
               field text, mine jsonb, ifa jsonb, conflict_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.team_id, t.name, m.opponent, m.starts_at, o.field, o.value, o.conflict_ifa_value, o.conflict_at
  from team_match_overrides o
  join team_matches m on m.id = o.match_id
  join teams t on t.id = m.team_id
  where o.status = 'active' and o.conflict_ifa_value is not null
    and auth.uid() is not null and can(m.team_id, 'matches', 3)
  order by m.starts_at;
$$;

revoke all on function public.match_write_field(uuid, text, jsonb), public.set_match_override(uuid, text, jsonb),
  public.release_match_override(uuid, text), public.resolve_match_conflict(uuid, text, boolean),
  public.my_match_conflicts() from public;
grant execute on function public.set_match_override(uuid, text, jsonb), public.release_match_override(uuid, text),
  public.resolve_match_conflict(uuid, text, boolean), public.my_match_conflicts() to authenticated;

commit;
