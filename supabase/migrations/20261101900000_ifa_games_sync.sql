-- iplays — IFA league games: change detection, history and a notification queue.
--
-- Run after 20261101800000_ifa_import.sql.
-- Rollback: supabase/rollback/20261101900000_ifa_games_sync.down.sql (keeps
-- every table and row; removes only functions, triggers and policies).
--
-- What this adds
--   * ifa_games: one row per game. The IFA game id is unique when the site has
--     one, but future games are listed with game_id=-1 (verified on the saved
--     team-games page of team 7491: 14 of 15 games). Such games are matched by
--     season + home IFA team id + away IFA team id; when the IFA later assigns
--     an id it is attached to the same row (no duplicate, no notification).
--     Home and away are stored by IFA team id, plus the names as shown.
--     Kickoff time 00:00 (or none) is stored as "time not confirmed".
--     Status and result are separate fields; an empty venue is allowed.
--   * ifa_game_updates + ifa_game_changes: every real change, field by field,
--     with old value, new value, detection time, source and sync run.
--   * team_matches gets source = 'ifa' rows mirrored from ifa_games for every
--     app team linked to an IFA team. Club-created matches and trainings stay
--     source = 'club' and are never touched by the sync. Staff cannot edit the
--     official fields of an IFA game (only the note and lineup size).
--   * notification_outbox: a durable queue (one row per user per update, so the
--     same change is never sent twice). A dispatcher (Edge Function) claims rows,
--     sends Web Push and marks them sent / retries with backoff.
--     Sending is OFF until a platform admin switches push_mode to 'admins'
--     (test) or 'all'. Rows waiting more than 24 h are skipped, not sent late.
--   * notification_prefs + push_subscriptions: per-user opt-out and devices.
--
-- Rules (owner, 2026-11-01)
--   * 00:00 is not a confirmed time unless the payload says time_confirmed.
--   * unknown time -> known time is a change to notify.
--   * date or venue change is significant (notify).
--   * no notification for a sync with no real change; the first time a game is
--     seen is not a change (no notification for the initial load).
--   * nothing is deleted: a game missing from a payload, or a failed sync,
--     leaves the stored data as it was.
--
-- Source: there is no approved automatic access to the IFA site yet (server
-- requests get 403 and we do not get around that). Payloads come from pages
-- an admin saved in their browser, or later from an approved feed. The
-- schedule (ifa_games_due) is ready for when such access exists.

begin;

-- ------------------------------------------------------------- tables

alter table public.ifa_sync_runs add column if not exists status text not null default 'ok';
alter table public.ifa_sync_runs drop constraint if exists ifa_sync_runs_status_check;
alter table public.ifa_sync_runs add constraint ifa_sync_runs_status_check
  check (status in ('ok', 'partial', 'failed', 'skipped', 'dry_run'));

-- age category kept apart from the team's own name ("טרום ב׳" + "הפועל רמת גן צפון")
alter table public.ifa_teams add column if not exists age_category text not null default '';
alter table public.ifa_teams drop constraint if exists ifa_teams_age_category_check;
alter table public.ifa_teams add constraint ifa_teams_age_category_check check (char_length(age_category) <= 30);

create table if not exists public.ifa_games (
  id uuid primary key default gen_random_uuid(),
  ifa_game_id bigint unique check (ifa_game_id > 0),
  ifa_season_id int not null,
  ifa_league_id int,
  home_ifa_team_id int not null,
  away_ifa_team_id int not null,
  home_name text not null default '' check (char_length(home_name) <= 120),
  away_name text not null default '' check (char_length(away_name) <= 120),
  game_date date,
  kickoff_time time,
  time_confirmed boolean not null default false,
  venue text not null default '' check (char_length(venue) <= 120),
  address text not null default '' check (char_length(address) <= 160),
  status text not null default 'scheduled' check (status in ('scheduled', 'played', 'postponed', 'canceled', 'unknown')),
  result_raw text not null default '' check (char_length(result_raw) <= 30),
  home_score smallint check (home_score between 0 and 300),
  away_score smallint check (away_score between 0 and 300),
  source text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_changed_at timestamptz,
  check (not time_confirmed or kickoff_time is not null),
  unique (ifa_season_id, home_ifa_team_id, away_ifa_team_id)
);
create index if not exists ifa_games_home_idx on public.ifa_games (ifa_season_id, home_ifa_team_id, game_date);
create index if not exists ifa_games_away_idx on public.ifa_games (ifa_season_id, away_ifa_team_id, game_date);

create table if not exists public.ifa_game_updates (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.ifa_games (id) on delete restrict,
  run_id uuid references public.ifa_sync_runs (id) on delete set null,
  kinds text[] not null,
  significant boolean not null default false,
  notify boolean not null default false,
  source text not null default '',
  detected_at timestamptz not null default now()
);
create index if not exists ifa_game_updates_game_idx on public.ifa_game_updates (game_id, detected_at desc);

create table if not exists public.ifa_game_changes (
  id bigint generated always as identity primary key,
  update_id uuid not null references public.ifa_game_updates (id) on delete restrict,
  field text not null,
  old_value text,
  new_value text
);
create index if not exists ifa_game_changes_update_idx on public.ifa_game_changes (update_id);

alter table public.team_matches add column if not exists source text not null default 'club';
alter table public.team_matches drop constraint if exists team_matches_source_check;
alter table public.team_matches add constraint team_matches_source_check check (source in ('club', 'ifa'));
alter table public.team_matches add column if not exists ifa_game uuid references public.ifa_games (id) on delete restrict;
alter table public.team_matches add column if not exists time_confirmed boolean not null default true;
alter table public.team_matches add column if not exists ifa_status text;
-- "probably at": the home team's usual ground while the IFA shows no venue.
-- An estimate, shown apart from the official venue and never notified.
alter table public.team_matches add column if not exists venue_hint text;
create unique index if not exists team_matches_ifa_idx on public.team_matches (team_id, ifa_game) where ifa_game is not null;

-- Where a venue name really is (the IFA gives names only). Filled once per
-- venue and kept for every future game there; used for the Waze link.
-- Who may set it (owner, 2026-11-01): a coach or a parent of a team that has a
-- game at that venue, a club admin, or Super Admin. A parent cannot overwrite
-- what staff or an admin set. Every change is kept in venue_location_history.
create table if not exists public.venue_locations (
  name text primary key check (char_length(name) between 1 and 120),
  address text not null default '' check (char_length(address) <= 200),
  lat double precision check (lat between 29 and 34),
  lng double precision check (lng between 34 and 36),
  set_by_role text not null default 'admin' check (set_by_role in ('admin', 'staff', 'parent')),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);

create table if not exists public.venue_location_history (
  id bigint generated always as identity primary key,
  name text not null,
  old_address text,
  new_address text not null,
  lat double precision,
  lng double precision,
  set_by_role text not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('push_mode', '"off"') on conflict (key) do nothing;

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  match_changes boolean not null default true,
  match_results boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete restrict,
  update_id uuid references public.ifa_game_updates (id) on delete restrict,
  kind text not null check (kind in ('match_change', 'match_result')),
  title text not null,
  body text not null,
  url text not null default '',
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, update_id)
);
create index if not exists notification_outbox_due_idx on public.notification_outbox (next_attempt_at) where status in ('pending', 'sending');
create index if not exists notification_outbox_user_idx on public.notification_outbox (user_id, created_at desc);

-- ------------------------------------------------------------ RLS

alter table public.ifa_games enable row level security;
alter table public.ifa_game_updates enable row level security;
alter table public.ifa_game_changes enable row level security;
alter table public.app_settings enable row level security;
alter table public.venue_locations enable row level security;
alter table public.venue_location_history enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists ifa_games_admin on public.ifa_games;
drop policy if exists ifa_game_updates_admin on public.ifa_game_updates;
drop policy if exists ifa_game_changes_admin on public.ifa_game_changes;
drop policy if exists app_settings_admin on public.app_settings;
drop policy if exists venue_locations_read on public.venue_locations;
drop policy if exists venue_location_history_admin on public.venue_location_history;
drop policy if exists notification_prefs_own on public.notification_prefs;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
drop policy if exists notification_outbox_own on public.notification_outbox;
create policy ifa_games_admin on public.ifa_games for select to authenticated using (is_platform_admin());
create policy ifa_game_updates_admin on public.ifa_game_updates for select to authenticated using (is_platform_admin());
create policy ifa_game_changes_admin on public.ifa_game_changes for select to authenticated using (is_platform_admin());
create policy app_settings_admin on public.app_settings for select to authenticated using (is_platform_admin());
create policy venue_locations_read on public.venue_locations for select to authenticated using (true);
create policy venue_location_history_admin on public.venue_location_history for select to authenticated using (is_platform_admin());
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- the user's own notifications double as an in-app inbox
create policy notification_outbox_own on public.notification_outbox for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.ifa_games, public.ifa_game_updates, public.ifa_game_changes,
  public.app_settings, public.notification_outbox, public.venue_locations, public.venue_location_history from authenticated, anon;
grant select on public.ifa_games, public.ifa_game_updates, public.ifa_game_changes, public.app_settings,
  public.notification_outbox, public.venue_locations, public.venue_location_history to authenticated;
grant select, insert, update, delete on public.notification_prefs, public.push_subscriptions to authenticated;

-- ------------------------------------------- IFA rows in team_matches
-- Only the sync writes the official fields of an IFA game. It sets the
-- transaction-local flag iplays.ifa_sync; staff edits keep note and lineup size.

create or replace function public.team_matches_ifa_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('iplays.ifa_sync', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source = 'ifa' or new.ifa_game is not null then
      raise exception 'IFA games are added by the sync only' using errcode = '42501';
    end if;
    new.time_confirmed := true;
    new.ifa_status := null;
    new.venue_hint := null;
    return new;
  end if;
  if old.source = 'ifa' then
    new.starts_at := old.starts_at;
    new.opponent := old.opponent;
    new.home := old.home;
    new.venue := old.venue;
    new.competition := old.competition;
    new.status := old.status;
    new.score_for := old.score_for;
    new.score_against := old.score_against;
    new.time_confirmed := old.time_confirmed;
    new.ifa_status := old.ifa_status;
    new.venue_hint := old.venue_hint;
  end if;
  new.source := old.source;
  new.ifa_game := old.ifa_game;
  return new;
end;
$$;
drop trigger if exists team_matches_ifa_guard on public.team_matches;
create trigger team_matches_ifa_guard before insert or update on public.team_matches
  for each row execute function public.team_matches_ifa_guard();

-- Mirror one IFA game into team_matches for each linked app team (home and/or away).
create or replace function public.ifa_mirror_game(p_game uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  g ifa_games%rowtype;
  side record;
  v_starts timestamptz;
  v_n int := 0;
begin
  select * into g from ifa_games where id = p_game;
  if not found or g.game_date is null then
    return 0;
  end if;
  v_starts := (g.game_date + coalesce(case when g.time_confirmed then g.kickoff_time end, time '00:00')) at time zone 'Asia/Jerusalem';
  perform set_config('iplays.ifa_sync', 'on', true);
  for side in
    select t.team_id, true as is_home, g.away_name as opp, g.home_score as sf, g.away_score as sa
    from ifa_teams t where t.ifa_season_id = g.ifa_season_id and t.ifa_team_id = g.home_ifa_team_id and t.team_id is not null
    union all
    select t.team_id, false, g.home_name, g.away_score, g.home_score
    from ifa_teams t where t.ifa_season_id = g.ifa_season_id and t.ifa_team_id = g.away_ifa_team_id and t.team_id is not null
  loop
    insert into team_matches (team_id, starts_at, opponent, home, venue, competition, status, score_for, score_against,
                              source, ifa_game, time_confirmed, ifa_status, created_by)
    values (side.team_id, v_starts, left(coalesce(nullif(side.opp, ''), '—'), 60), side.is_home, left(g.venue, 80), 'league',
            case g.status when 'played' then 'played' when 'canceled' then 'canceled' else 'scheduled' end,
            side.sf, side.sa, 'ifa', g.id, g.time_confirmed, g.status, null)
    on conflict (team_id, ifa_game) where ifa_game is not null do update
      set starts_at = excluded.starts_at, opponent = excluded.opponent, home = excluded.home, venue = excluded.venue,
          status = excluded.status, score_for = excluded.score_for, score_against = excluded.score_against,
          time_confirmed = excluded.time_confirmed, ifa_status = excluded.ifa_status
      where (team_matches.starts_at, team_matches.opponent, team_matches.home, team_matches.venue, team_matches.status,
             team_matches.score_for, team_matches.score_against, team_matches.time_confirmed, team_matches.ifa_status)
        is distinct from
            (excluded.starts_at, excluded.opponent, excluded.home, excluded.venue, excluded.status,
             excluded.score_for, excluded.score_against, excluded.time_confirmed, excluded.ifa_status);
    v_n := v_n + 1;
  end loop;
  perform set_config('iplays.ifa_sync', 'off', true);
  return v_n;
end;
$$;

-- Usual home ground of an IFA team: the venue of most of its home games that
-- had one, only with a clear majority (a team with two grounds gets none).
create or replace function public.ifa_home_venue(p_season int, p_team int)
returns text language sql stable security definer set search_path = public as $$
  with v as (
    select venue, count(*) as n, sum(count(*)) over () as total
    from ifa_games where ifa_season_id = p_season and home_ifa_team_id = p_team and venue <> ''
    group by venue
  )
  select venue from v where n * 2 > total order by n desc limit 1;
$$;

-- Refresh the estimates on IFA matches that still have no official venue.
create or replace function public.ifa_refresh_venue_hints(p_season int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform set_config('iplays.ifa_sync', 'on', true);
  update team_matches tm set venue_hint = h.hint
  from (select g.id, case when g.venue = '' then ifa_home_venue(g.ifa_season_id, g.home_ifa_team_id) end as hint
        from ifa_games g where g.ifa_season_id = p_season) h
  where tm.ifa_game = h.id and tm.venue_hint is distinct from h.hint;
  get diagnostics v_n = row_count;
  perform set_config('iplays.ifa_sync', 'off', true);
  return v_n;
end;
$$;

-- ------------------------------------------------- change detection

create or replace function public.ifa_time_label(p_time time, p_confirmed boolean)
returns text language sql immutable as $$
  select case when p_confirmed and p_time is not null then to_char(p_time, 'HH24:MI') else 'שעה טרם נקבעה' end;
$$;

create or replace function public.ifa_status_label(p text)
returns text language sql immutable as $$
  select case p when 'scheduled' then 'מתוכנן' when 'played' then 'שוחק' when 'postponed' then 'נדחה'
                when 'canceled' then 'בוטל' else 'לא ידוע' end;
$$;

-- Queue one notification per member of each linked team who wants it.
create or replace function public.ifa_enqueue_update(p_update uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  u ifa_game_updates%rowtype;
  g ifa_games%rowtype;
  v_kind text;
  v_title text;
  v_body text;
  v_n int;
begin
  select * into u from ifa_game_updates where id = p_update;
  if not found or not u.notify then
    return 0;
  end if;
  select * into g from ifa_games where id = u.game_id;
  v_kind := case when u.kinds <@ array['result', 'status'] and g.status = 'played' then 'match_result' else 'match_change' end;
  v_title := case v_kind when 'match_result' then 'תוצאה: ' else 'עדכון משחק: ' end || g.home_name || ' – ' || g.away_name;
  v_body := concat_ws(' · ',
    to_char(g.game_date, 'DD/MM/YYYY'),
    ifa_time_label(g.kickoff_time, g.time_confirmed),
    coalesce(nullif(g.venue, ''), 'מיקום טרם נקבע'),
    case when g.status not in ('scheduled', 'played') then ifa_status_label(g.status) end,
    case when g.home_score is not null then g.home_score || '–' || g.away_score end);

  insert into notification_outbox (user_id, team_id, update_id, kind, title, body, url)
  select distinct on (m.user_id) m.user_id, tm.team_id, u.id, v_kind, left(v_title, 140), left(v_body, 300), '#matches/' || tm.team_id
  from team_matches tm
  join team_members m on m.team_id = tm.team_id
  left join notification_prefs np on np.user_id = m.user_id
  where tm.ifa_game = u.game_id
    and case v_kind when 'match_result' then coalesce(np.match_results, true) else coalesce(np.match_changes, true) end
  order by m.user_id, tm.team_id
  on conflict (user_id, update_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Import a games payload (a league page or a page filtered by team).
-- p_apply = false is a dry run: it validates and returns the changes it would
-- make, and writes nothing except the run log.
-- Payload:
-- { "ifa_season_id": 28, "ifa_league_id": 640, "league_name": "...", "source_url": "...",
--   "scope": { "kind": "league" | "team", "ifa_team_id": 7491 },
--   "teams": [ { "ifa_team_id": 7491, "name": "..." } ],
--   "games": [ { "ifa_game_id": "1144003" | "-1", "date": "2026-10-19", "time": "19:00" | "00:00" | null,
--                "time_confirmed": false, "home_ifa_team_id": 3375, "away_ifa_team_id": 7491,
--                "home_name": "...", "away_name": "...", "venue": "", "address": "",
--                "status": "scheduled", "result_raw": "", "home_score": null, "away_score": null } ] }
create or replace function public.import_ifa_games(p jsonb, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season int := (p->>'ifa_season_id')::int;
  v_league int := nullif(p->>'ifa_league_id', '')::int;
  v_source text := left(coalesce(p->>'source_url', ''), 400);
  v_scope_team int := nullif(p #>> '{scope,ifa_team_id}', '')::int;
  v_actor uuid := coalesce(auth.uid(), (select user_id from platform_admins order by user_id limit 1));
  v_run uuid;
  r jsonb;
  old ifa_games%rowtype;
  new ifa_games%rowtype;
  v_found boolean;
  v_gid bigint;
  v_key text;
  v_keys text[] := '{}';
  v_seen uuid[] := '{}';
  v_changes jsonb;
  v_kinds text[];
  v_sig boolean;
  v_notify boolean;
  v_update uuid;
  v_new int := 0;
  v_changed int := 0;
  v_same int := 0;
  v_queued int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_report jsonb := '[]'::jsonb;
  v_min date;
  v_max date;
  v_missing jsonb;
  v_time text;
  c record;
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'add a platform admin first (platform_admins)' using errcode = '22023';
  end if;
  if v_season is null or jsonb_typeof(p->'games') is distinct from 'array' then
    raise exception 'ifa_season_id and games[] are required' using errcode = '22023';
  end if;

  -- run row first so updates can point at it; counts are filled in at the end
  insert into ifa_sync_runs (kind, source, status, created_by)
  values ('games', v_source, case when p_apply then 'ok' else 'dry_run' end, v_actor)
  returning id into v_run;

  for r in select * from jsonb_array_elements(p->'games') loop
    begin
      -- the site shows game_id=-1 for games that have no id yet
      v_gid := case when r->>'ifa_game_id' ~ '^[0-9]+$' and (r->>'ifa_game_id')::bigint > 0 then (r->>'ifa_game_id')::bigint end;
      if v_gid is null and coalesce(r->>'ifa_game_id', '') not in ('', '-1', '0') then
        raise exception 'invalid ifa_game_id %', r->>'ifa_game_id';
      end if;
      if coalesce(r->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'missing or invalid date';
      end if;
      v_time := nullif(trim(coalesce(r->>'time', '')), '');
      if v_time is not null and v_time !~ '^\d{1,2}:\d{2}$' then
        raise exception 'invalid time %', v_time;
      end if;
      if coalesce(r->>'home_ifa_team_id', '') !~ '^[0-9]+$' or coalesce(r->>'away_ifa_team_id', '') !~ '^[0-9]+$' then
        raise exception 'home and away IFA team ids are required (names alone are not used)';
      end if;

      new := null;
      new.ifa_game_id := v_gid;
      new.ifa_season_id := v_season;
      new.ifa_league_id := coalesce(nullif(r->>'ifa_league_id', '')::int, v_league);
      new.home_ifa_team_id := (r->>'home_ifa_team_id')::int;
      new.away_ifa_team_id := (r->>'away_ifa_team_id')::int;
      new.home_name := left(trim(coalesce(r->>'home_name', '')), 120);
      new.away_name := left(trim(coalesce(r->>'away_name', '')), 120);
      new.game_date := (r->>'date')::date;
      new.kickoff_time := v_time::time;
      -- 00:00 is "not set yet" unless the source says otherwise
      new.time_confirmed := new.kickoff_time is not null
                            and (new.kickoff_time <> time '00:00' or coalesce((r->>'time_confirmed')::boolean, false));
      if not new.time_confirmed then
        new.kickoff_time := null;
      end if;
      new.venue := left(trim(coalesce(r->>'venue', '')), 120);
      new.address := left(trim(coalesce(r->>'address', '')), 160);
      new.status := case when r->>'status' in ('scheduled', 'played', 'postponed', 'canceled', 'unknown') then r->>'status' else 'unknown' end;
      new.result_raw := left(trim(coalesce(r->>'result_raw', '')), 30);
      new.home_score := case when r->>'home_score' ~ '^[0-9]+$' then (r->>'home_score')::smallint end;
      new.away_score := case when r->>'away_score' ~ '^[0-9]+$' then (r->>'away_score')::smallint end;
      if (new.home_score is null) <> (new.away_score is null) then
        raise exception 'only one score given';
      end if;

      -- one row per pairing in a payload; a second one would be a guess
      v_key := new.home_ifa_team_id || '-' || new.away_ifa_team_id;
      if v_key = any (v_keys) then
        raise exception 'pairing % appears twice in this payload; not matched', v_key;
      end if;
      v_keys := v_keys || v_key;

      v_min := least(coalesce(v_min, new.game_date), new.game_date);
      v_max := greatest(coalesce(v_max, new.game_date), new.game_date);

      -- match: IFA game id first, then season + home id + away id
      v_found := false;
      if v_gid is not null then
        select * into old from ifa_games where ifa_game_id = v_gid;
        v_found := found;
      end if;
      if not v_found then
        select * into old from ifa_games
        where ifa_season_id = v_season and home_ifa_team_id = new.home_ifa_team_id and away_ifa_team_id = new.away_ifa_team_id;
        v_found := found;
        if v_found and v_gid is not null and old.ifa_game_id is not null and old.ifa_game_id <> v_gid then
          raise exception 'pairing % already has game id %, payload says %', v_key, old.ifa_game_id, v_gid;
        end if;
      end if;
      if v_found and p_apply then
        select * into old from ifa_games where id = old.id for update;
      end if;

      if not v_found then
        v_new := v_new + 1;
        v_report := v_report || jsonb_build_object('ifa_game_id', v_gid, 'pairing', v_key, 'change', 'new');
        if p_apply then
          insert into ifa_games (ifa_game_id, ifa_season_id, ifa_league_id, home_ifa_team_id, away_ifa_team_id, home_name, away_name,
                                 game_date, kickoff_time, time_confirmed, venue, address, status, result_raw, home_score, away_score, source)
          values (new.ifa_game_id, new.ifa_season_id, new.ifa_league_id, new.home_ifa_team_id, new.away_ifa_team_id, new.home_name, new.away_name,
                  new.game_date, new.kickoff_time, new.time_confirmed, new.venue, new.address, new.status, new.result_raw,
                  new.home_score, new.away_score, v_source)
          returning id into new.id;
          v_seen := v_seen || new.id;
          perform ifa_mirror_game(new.id);
        end if;
        continue;
      end if;
      v_seen := v_seen || old.id;

      -- compare field by field (names are kept, never notified)
      v_changes := '[]'::jsonb;
      v_kinds := '{}';
      if old.game_date is distinct from new.game_date then
        v_changes := v_changes || jsonb_build_object('field', 'date', 'old', to_char(old.game_date, 'DD/MM/YYYY'), 'new', to_char(new.game_date, 'DD/MM/YYYY'));
        v_kinds := v_kinds || 'date'::text;
      end if;
      if (old.kickoff_time, old.time_confirmed) is distinct from (new.kickoff_time, new.time_confirmed) then
        v_changes := v_changes || jsonb_build_object('field', 'time',
          'old', ifa_time_label(old.kickoff_time, old.time_confirmed), 'new', ifa_time_label(new.kickoff_time, new.time_confirmed));
        v_kinds := v_kinds || case when new.time_confirmed then 'time' else 'time_unset' end;
      end if;
      if old.venue is distinct from new.venue then
        v_changes := v_changes || jsonb_build_object('field', 'venue', 'old', old.venue, 'new', new.venue);
        v_kinds := v_kinds || 'venue'::text;
      end if;
      if new.address <> '' and old.address is distinct from new.address then
        v_changes := v_changes || jsonb_build_object('field', 'address', 'old', old.address, 'new', new.address);
        v_kinds := v_kinds || 'address'::text;
      end if;
      if old.status is distinct from new.status then
        v_changes := v_changes || jsonb_build_object('field', 'status', 'old', ifa_status_label(old.status), 'new', ifa_status_label(new.status));
        v_kinds := v_kinds || 'status'::text;
      end if;
      if (old.home_score, old.away_score, old.result_raw) is distinct from (new.home_score, new.away_score, new.result_raw) then
        v_changes := v_changes || jsonb_build_object('field', 'result',
          'old', nullif(concat_ws('–', old.home_score, old.away_score), ''), 'new', nullif(concat_ws('–', new.home_score, new.away_score), ''));
        v_kinds := v_kinds || 'result'::text;
      end if;
      if v_gid is not null and old.ifa_game_id is null then
        v_changes := v_changes || jsonb_build_object('field', 'ifa_game_id', 'old', null, 'new', v_gid);
        v_kinds := v_kinds || 'id_assigned'::text;
      end if;

      if jsonb_array_length(v_changes) = 0 then
        v_same := v_same + 1;
        if p_apply then
          update ifa_games set last_seen_at = now(),
            home_name = case when new.home_name <> '' then new.home_name else home_name end,
            away_name = case when new.away_name <> '' then new.away_name else away_name end
          where id = old.id;
        end if;
        continue;
      end if;

      -- significant: date, venue, a time becoming known or moving, status.
      -- A confirmed time falling back to 00:00 is recorded but not notified
      -- (more likely a page glitch than a real change; staff see it in history).
      -- A newly assigned IFA game id is recorded only.
      v_sig := v_kinds && array['date', 'venue', 'time', 'status'];
      v_notify := v_kinds && array['date', 'venue', 'time', 'address', 'status', 'result'];
      v_changed := v_changed + 1;
      v_report := v_report || jsonb_build_object('ifa_game_id', coalesce(v_gid, old.ifa_game_id), 'pairing', v_key, 'change', 'updated',
                                                 'fields', v_changes, 'notify', v_notify);
      if p_apply then
        insert into ifa_game_updates (game_id, run_id, kinds, significant, notify, source)
        values (old.id, v_run, v_kinds, v_sig, v_notify, v_source)
        returning id into v_update;
        for c in select * from jsonb_array_elements(v_changes) loop
          insert into ifa_game_changes (update_id, field, old_value, new_value)
          values (v_update, c.value->>'field', c.value->>'old', c.value->>'new');
        end loop;
        update ifa_games set
          ifa_game_id = coalesce(ifa_game_id, v_gid),
          ifa_league_id = coalesce(new.ifa_league_id, ifa_league_id),
          home_name = case when new.home_name <> '' then new.home_name else home_name end,
          away_name = case when new.away_name <> '' then new.away_name else away_name end,
          game_date = new.game_date, kickoff_time = new.kickoff_time, time_confirmed = new.time_confirmed,
          venue = new.venue, address = case when new.address <> '' then new.address else address end,
          status = new.status, result_raw = new.result_raw, home_score = new.home_score, away_score = new.away_score,
          source = v_source, last_seen_at = now(),
          last_changed_at = case when v_kinds <@ array['id_assigned'] then last_changed_at else now() end
        where id = old.id;
        perform ifa_mirror_game(old.id);
        v_queued := v_queued + ifa_enqueue_update(v_update);
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('game', coalesce(r->>'ifa_game_id', ''), 'date', r->>'date', 'error', sqlerrm);
    end;
  end loop;

  if p_apply then
    perform ifa_refresh_venue_hints(v_season);
    -- the league as the page states it, e.g. "ליגת ילדים טרום ב' דן" (the roster page does not show it)
    if v_league is not null and coalesce(p->>'league_name', '') <> '' then
      insert into ifa_leagues (ifa_season_id, ifa_league_id, name, source_url)
      values (v_season, v_league, left(trim(regexp_replace(p->>'league_name', '^\d{4}/\d{4}\s*', '')), 120), v_source)
      on conflict (ifa_season_id, ifa_league_id) do update set name = excluded.name, synced_at = now();
      if v_scope_team is not null then
        update ifa_teams set ifa_league_id = v_league
        where ifa_season_id = v_season and ifa_team_id = v_scope_team and ifa_league_id is null;
        update teams t set league = left(l.name, 80)
        from ifa_teams it join ifa_leagues l on l.ifa_season_id = it.ifa_season_id and l.ifa_league_id = it.ifa_league_id
        where it.ifa_season_id = v_season and it.ifa_team_id = v_scope_team and t.id = it.team_id and t.league = '';
      end if;
    end if;
  end if;

  -- games we have for this scope and date range that the payload did not list: report only
  select coalesce(jsonb_agg(jsonb_build_object('ifa_game_id', g.ifa_game_id, 'date', g.game_date,
                                               'pairing', g.home_ifa_team_id || '-' || g.away_ifa_team_id) order by g.game_date), '[]'::jsonb)
    into v_missing
  from ifa_games g
  where p_apply and g.ifa_season_id = v_season and v_min is not null and g.game_date between v_min and v_max
    and (v_scope_team is null or v_scope_team in (g.home_ifa_team_id, g.away_ifa_team_id))
    and (v_scope_team is not null or v_league is null or g.ifa_league_id = v_league)
    and not (g.id = any (v_seen));

  update ifa_sync_runs set
    status = case when not p_apply then 'dry_run'
                  when jsonb_array_length(v_errors) = 0 then 'ok'
                  when v_new + v_changed + v_same = 0 then 'failed' else 'partial' end,
    counts = jsonb_build_object('ifa_league_id', v_league, 'ifa_team_id', v_scope_team,
                                'games_in_payload', jsonb_array_length(p->'games'), 'new', v_new, 'changed', v_changed,
                                'unchanged', v_same, 'queued', v_queued, 'not_in_payload', coalesce(v_missing, '[]'::jsonb),
                                'from', v_min, 'to', v_max),
    errors = v_errors
  where id = v_run;

  return jsonb_build_object('run_id', v_run, 'applied', p_apply, 'new', v_new, 'changed', v_changed, 'unchanged', v_same,
                            'queued', v_queued, 'not_in_payload', coalesce(v_missing, '[]'::jsonb), 'errors', v_errors, 'changes', v_report);
end;
$$;

-- A sync that could not reach the source: log it, touch nothing else.
create or replace function public.record_ifa_sync_failure(p_kind text, p_source text, p_error text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into ifa_sync_runs (kind, source, status, errors, created_by)
  values (left(coalesce(p_kind, 'games'), 30), left(coalesce(p_source, ''), 400), 'failed',
          jsonb_build_array(jsonb_build_object('error', left(coalesce(p_error, ''), 500))),
          coalesce(auth.uid(), (select user_id from platform_admins order by user_id limit 1)))
  returning id into v_id;
  return v_id;
end;
$$;

-- Display label: "טרום ב׳ – הפועל רמת גן צפון"; the IFA name stays as is in ifa_teams.name.
create or replace function public.set_ifa_team_category(p_season int, p_ifa_team int, p_category text)
returns text language plpgsql security definer set search_path = public as $$
declare
  t ifa_teams%rowtype;
  v_label text;
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update ifa_teams set age_category = left(trim(coalesce(p_category, '')), 30)
  where ifa_season_id = p_season and ifa_team_id = p_ifa_team
  returning * into t;
  if not found then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  v_label := left(case when t.age_category = '' then t.name else t.age_category || ' – ' || t.name end, 60);
  -- rename the app team only while it still carries an imported name (never a name a coach chose)
  update teams set name = v_label
  where id = t.team_id
    and (name = left(t.name, 60) or name like '% – ' || left(t.name, 50));
  return v_label;
end;
$$;

-- ---------------------------------------------------------- schedule
-- Which IFA teams are due for a games sync: every 3 hours, every hour when the
-- team has a game in the next 48 hours. Used by a scheduled job once an
-- approved source exists; it only reads.
create or replace function public.ifa_games_due(p_now timestamptz default now())
returns table (ifa_season_id int, ifa_team_id int, ifa_league_id int, last_run_at timestamptz, interval_hours int)
language sql stable security definer set search_path = public as $$
  with due as (
    select t.ifa_season_id, t.ifa_team_id, t.ifa_league_id,
           (select max(r.created_at) from ifa_sync_runs r
             where r.kind = 'games' and r.status in ('ok', 'partial')
               and (r.counts->>'ifa_team_id')::int = t.ifa_team_id) as last_run_at,
           case when exists (select 1 from ifa_games g
                              where g.ifa_season_id = t.ifa_season_id
                                and t.ifa_team_id in (g.home_ifa_team_id, g.away_ifa_team_id)
                                and g.status = 'scheduled'
                                and g.game_date between (p_now at time zone 'Asia/Jerusalem')::date
                                                    and ((p_now + interval '48 hours') at time zone 'Asia/Jerusalem')::date)
                then 1 else 3 end as interval_hours
    from ifa_teams t
    where t.team_id is not null
      and (auth.uid() is null or is_platform_admin())
  )
  select * from due
  where last_run_at is null or last_run_at <= p_now - make_interval(hours => interval_hours) + interval '5 minutes'
  order by interval_hours, last_run_at nulls first;
$$;

-- -------------------------------------------------- notification queue

create or replace function public.set_push_mode(p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_mode not in ('off', 'admins', 'all') then
    raise exception 'mode must be off, admins or all' using errcode = '22023';
  end if;
  insert into app_settings (key, value, updated_by) values ('push_mode', to_jsonb(p_mode), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- Dispatcher (server only): take due rows. Respects push_mode; rows older than
-- 24 h are skipped instead of sent late; a 'sending' row stuck for 10 minutes
-- is taken again (the dispatcher died mid-way).
create or replace function public.claim_notifications(p_limit int default 50)
returns table (id uuid, user_id uuid, kind text, title text, body text, url text, attempts int)
language plpgsql security definer set search_path = public as $$
declare
  v_mode text := coalesce((select value #>> '{}' from app_settings where key = 'push_mode'), 'off');
begin
  update notification_outbox o set status = 'skipped', last_error = 'expired (older than 24h)'
  where o.status in ('pending', 'sending') and o.created_at < now() - interval '24 hours';
  if v_mode = 'off' then
    return;
  end if;
  return query
  with due as (
    select o.id from notification_outbox o
    where ((o.status = 'pending' and o.next_attempt_at <= now())
           or (o.status = 'sending' and o.next_attempt_at <= now() - interval '10 minutes'))
      and (v_mode = 'all' or exists (select 1 from platform_admins a where a.user_id = o.user_id))
    order by o.created_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update notification_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
  from due where o.id = due.id
  returning o.id, o.user_id, o.kind, o.title, o.body, o.url, o.attempts;
end;
$$;

create or replace function public.complete_notification(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update notification_outbox set
    -- p_ok with an error text = nothing to send to (no device): skipped, stays in the in-app inbox
    status = case when p_ok and p_error is null then 'sent' when p_ok then 'skipped' when attempts >= 5 then 'failed' else 'pending' end,
    sent_at = case when p_ok and p_error is null then now() end,
    last_error = left(p_error, 500),
    next_attempt_at = case when p_ok then next_attempt_at else now() + make_interval(mins => power(2, least(attempts, 6))::int) end
  where id = p_id and status = 'sending';
$$;

-- Set where a venue is (address and/or map point). Allowed for Super Admin, a
-- club admin, and staff or parents of a team with a match at that venue
-- (official or estimated). A parent cannot overwrite a staff/admin entry.
create or replace function public.set_venue_location(p_name text, p_address text, p_lat double precision default null, p_lng double precision default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_role text;
  cur venue_locations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) = 0 or (char_length(trim(coalesce(p_address, ''))) = 0 and p_lat is null) then
    raise exception 'venue name and an address or a map point are required' using errcode = '22023';
  end if;
  v_role := case
    when is_platform_admin() or exists (select 1 from clubs c where is_club_admin(c.id)) then 'admin'
    when exists (select 1 from team_matches tm where v_name in (tm.venue, tm.venue_hint) and can(tm.team_id, 'matches', 2)) then 'staff'
    when exists (select 1 from team_matches tm where v_name in (tm.venue, tm.venue_hint) and is_team_member(tm.team_id)) then 'parent'
  end;
  if v_role is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cur from venue_locations where name = v_name;
  if found and v_role = 'parent' and cur.set_by_role <> 'parent' then
    raise exception 'set by the team staff; ask the coach to change it' using errcode = '42501';
  end if;
  insert into venue_locations (name, address, lat, lng, set_by_role, updated_by)
  values (v_name, trim(coalesce(p_address, '')), p_lat, p_lng, v_role, auth.uid())
  on conflict (name) do update set address = excluded.address, lat = excluded.lat, lng = excluded.lng,
    set_by_role = excluded.set_by_role, updated_by = excluded.updated_by, updated_at = now();
  insert into venue_location_history (name, old_address, new_address, lat, lng, set_by_role, changed_by)
  values (v_name, cur.address, trim(coalesce(p_address, '')), p_lat, p_lng, v_role, auth.uid());
  return v_role;
end;
$$;

-- ------------------------------------------------------------ reading

-- Change history for one team (staff who see matches) or a whole club (club admin).
create or replace function public.ifa_game_history(p_team uuid default null, p_club uuid default null, p_limit int default 100)
returns table (update_id uuid, game_id uuid, ifa_game_id bigint, team_id uuid, team_name text, home_name text, away_name text,
               detected_at timestamptz, kinds text[], significant boolean, notify boolean, source text,
               changes jsonb, queued int, sent int)
language sql stable security definer set search_path = public as $$
  select u.id, u.game_id, g.ifa_game_id, tm.team_id, t.name, g.home_name, g.away_name, u.detected_at, u.kinds, u.significant, u.notify, u.source,
         (select coalesce(jsonb_agg(jsonb_build_object('field', c.field, 'old', c.old_value, 'new', c.new_value) order by c.id), '[]')
            from ifa_game_changes c where c.update_id = u.id),
         (select count(*)::int from notification_outbox o where o.update_id = u.id and o.team_id = tm.team_id),
         (select count(*)::int from notification_outbox o where o.update_id = u.id and o.team_id = tm.team_id and o.status = 'sent')
  from ifa_game_updates u
  join ifa_games g on g.id = u.game_id
  join team_matches tm on tm.ifa_game = u.game_id
  join teams t on t.id = tm.team_id
  where auth.uid() is not null
    and ((p_team is not null and tm.team_id = p_team and can(p_team, 'matches', 1))
      or (p_club is not null and t.club_id = p_club and (is_club_admin(p_club) or is_platform_admin()))
      or (p_team is null and p_club is null and is_platform_admin()))
  order by u.detected_at desc
  limit greatest(1, least(p_limit, 500));
$$;

-- Super Admin: queue health.
create or replace function public.notification_queue_stats()
returns table (status text, n int, oldest timestamptz)
language sql stable security definer set search_path = public as $$
  select o.status, count(*)::int, min(o.created_at) from notification_outbox o
  where is_platform_admin() group by o.status order by o.status;
$$;

revoke all on function public.team_matches_ifa_guard(), public.ifa_mirror_game(uuid), public.ifa_home_venue(int, int),
  public.ifa_refresh_venue_hints(int), public.ifa_enqueue_update(uuid),
  public.claim_notifications(int), public.complete_notification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(int), public.complete_notification(uuid, boolean, text) to service_role;
revoke all on function public.import_ifa_games(jsonb, boolean), public.record_ifa_sync_failure(text, text, text),
  public.set_ifa_team_category(int, int, text), public.ifa_games_due(timestamptz), public.set_push_mode(text),
  public.ifa_game_history(uuid, uuid, int), public.notification_queue_stats(),
  public.set_venue_location(text, text, double precision, double precision) from public, anon;
grant execute on function public.import_ifa_games(jsonb, boolean), public.record_ifa_sync_failure(text, text, text),
  public.set_ifa_team_category(int, int, text), public.ifa_games_due(timestamptz), public.set_push_mode(text),
  public.ifa_game_history(uuid, uuid, int), public.notification_queue_stats(),
  public.set_venue_location(text, text, double precision, double precision),
  public.ifa_time_label(time, boolean), public.ifa_status_label(text) to authenticated;

commit;
