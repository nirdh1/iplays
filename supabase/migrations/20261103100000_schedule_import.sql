-- iplays — load a team's game schedule from a file (image, PDF, Excel, CSV).
--
-- Run after 20261102200000_match_overrides.sql (needs the IFA columns on
-- team_matches). Additive only: three functions and one trigger.
-- Rollback: supabase/rollback/20261103100000_schedule_import.down.sql (drops
-- them; every imported game stays).
--
-- The app reads the file (Excel/CSV in the browser, image/PDF through the
-- read-schedule Edge Function), shows every game for review, and then saves
-- the approved games with import_team_matches().
--
-- Who may import (owner, 2026-11-02, same rule as trainings): staff who may
-- add matches, and any member of the team (a parent too), with or without a
-- coach. Imported games are ordinary club games (source = 'club'); IFA games
-- are never written here.
--
-- A game is skipped when the team already has a game that day against the
-- same opponent, or any IFA game that day (the official one wins).
-- A game without a known time is saved at 00:00 with time_confirmed = false
-- ("שעה טרם נקבעה"); once someone sets its time it becomes confirmed.

begin;

create or replace function public.can_import_matches(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (is_team_member(p_team) or can(p_team, 'matches', 2));
$$;

-- p_games: [{starts_at, time_known, opponent, home, venue, competition, note}]
create or replace function public.import_team_matches(p_team uuid, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g jsonb;
  v_start timestamptz;
  v_day date;
  v_opp text;
  v_venue text;
  v_comp text;
  v_note text;
  v_known boolean;
  v_id uuid;
  v_added int := 0;
  v_skipped int := 0;
begin
  if not can_import_matches(p_team) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_games) is distinct from 'array' then
    raise exception 'games must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_games) > 120 then
    raise exception 'too many games' using errcode = '22023';
  end if;

  for g in select * from jsonb_array_elements(p_games) loop
    v_start := (g->>'starts_at')::timestamptz;
    v_opp := left(btrim(coalesce(g->>'opponent', '')), 60);
    if v_start is null or v_opp = '' then
      raise exception 'each game needs a date and an opponent' using errcode = '22023';
    end if;
    v_venue := left(btrim(coalesce(g->>'venue', '')), 80);
    v_comp := coalesce(nullif(g->>'competition', ''), 'league');
    if v_comp not in ('league', 'cup', 'friendly', 'tournament') then v_comp := 'league'; end if;
    v_note := left(btrim(coalesce(g->>'note', '')), 300);
    v_known := coalesce((g->>'time_known')::boolean, true);
    v_day := (v_start at time zone 'Asia/Jerusalem')::date;

    if exists (
      select 1 from team_matches m
      where m.team_id = p_team and m.status <> 'canceled'
        and (m.starts_at at time zone 'Asia/Jerusalem')::date = v_day
        and (m.source = 'ifa' or lower(btrim(m.opponent)) = lower(v_opp))
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into team_matches (team_id, starts_at, opponent, home, venue, competition, note, created_by)
    values (p_team, v_start, v_opp, coalesce((g->>'home')::boolean, true), v_venue, v_comp, v_note, auth.uid())
    returning id into v_id;
    -- the IFA guard confirms every inserted time; mark unknown ones afterwards
    if not v_known then
      update team_matches set time_confirmed = false where id = v_id;
    end if;
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end;
$$;

-- Setting the time of a club game confirms it.
create or replace function public.team_matches_time_confirm()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.source is distinct from 'ifa' and new.starts_at is distinct from old.starts_at then
    new.time_confirmed := true;
  end if;
  return new;
end;
$$;
drop trigger if exists team_matches_time_confirm on public.team_matches;
create trigger team_matches_time_confirm before update on public.team_matches
  for each row execute function public.team_matches_time_confirm();

revoke all on function public.team_matches_time_confirm() from public, anon, authenticated;
revoke all on function public.can_import_matches(uuid), public.import_team_matches(uuid, jsonb) from public, anon;
grant execute on function public.can_import_matches(uuid), public.import_team_matches(uuid, jsonb) to authenticated;

commit;
