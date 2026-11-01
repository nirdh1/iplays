-- iplays — IFA catalog import (teams and rosters from the football association site).
--
-- Run after 20261101700000_team_claims.sql.
-- Rollback: supabase/rollback/20261101800000_ifa_import.down.sql (keeps every
-- table and row; only the functions and policies are removed).
--
-- Source: pages the owner saved from their own browser and parsed with
-- tools/ifa/ifa_collector.py --saved (the site blocks server requests; we do
-- not get around that). Only values present in the page are imported:
--   * team: IFA team id, season id, name as shown in the page heading.
--   * players: IFA player id, full name as written on the page, profile URL.
--     The name is not split into first / last (that would be a guess), and
--     no birth year is set unless the source states it.
--   * league / birth year / matches: only when a saved page states them.
-- Imported teams have no staff, so parents join right away (open teams rule)
-- and a coach takes over through a team claim.
--
-- Idempotent: keyed by IFA ids + season. Running the same payload twice
-- changes nothing; a player missing from a later payload is NOT removed,
-- it is only reported in the sync run.

begin;

create table if not exists public.ifa_leagues (
  ifa_season_id int not null,
  ifa_league_id int not null,
  name text not null check (char_length(name) between 1 and 120),
  source_url text not null default '',
  synced_at timestamptz not null default now(),
  primary key (ifa_season_id, ifa_league_id)
);

create table if not exists public.ifa_teams (
  ifa_season_id int not null,
  ifa_team_id int not null,
  name text not null check (char_length(name) between 1 and 120),
  ifa_league_id int,
  team_id uuid references public.teams (id) on delete restrict,
  source_url text not null default '',
  synced_at timestamptz not null default now(),
  primary key (ifa_season_id, ifa_team_id)
);
create unique index if not exists ifa_teams_team_idx on public.ifa_teams (team_id) where team_id is not null;

create table if not exists public.ifa_players (
  ifa_player_id bigint primary key,
  name text not null check (char_length(name) between 1 and 80),
  player_id uuid references public.players (id) on delete restrict,
  profile_url text not null default '',
  synced_at timestamptz not null default now()
);
create unique index if not exists ifa_players_player_idx on public.ifa_players (player_id) where player_id is not null;

create table if not exists public.ifa_rosters (
  ifa_season_id int not null,
  ifa_team_id int not null,
  ifa_player_id bigint not null references public.ifa_players (ifa_player_id) on delete restrict,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (ifa_season_id, ifa_team_id, ifa_player_id),
  foreign key (ifa_season_id, ifa_team_id) references public.ifa_teams (ifa_season_id, ifa_team_id) on delete restrict
);

create table if not exists public.ifa_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  source text not null default '',
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Only platform admins read these tables in the app; writes go through import_ifa_team().
alter table public.ifa_leagues enable row level security;
alter table public.ifa_teams enable row level security;
alter table public.ifa_players enable row level security;
alter table public.ifa_rosters enable row level security;
alter table public.ifa_sync_runs enable row level security;
drop policy if exists ifa_leagues_admin on public.ifa_leagues;
drop policy if exists ifa_teams_admin on public.ifa_teams;
drop policy if exists ifa_players_admin on public.ifa_players;
drop policy if exists ifa_rosters_admin on public.ifa_rosters;
drop policy if exists ifa_sync_runs_admin on public.ifa_sync_runs;
create policy ifa_leagues_admin on public.ifa_leagues for select to authenticated using (is_platform_admin());
create policy ifa_teams_admin on public.ifa_teams for select to authenticated using (is_platform_admin());
create policy ifa_players_admin on public.ifa_players for select to authenticated using (is_platform_admin());
create policy ifa_rosters_admin on public.ifa_rosters for select to authenticated using (is_platform_admin());
create policy ifa_sync_runs_admin on public.ifa_sync_runs for select to authenticated using (is_platform_admin());
revoke insert, update, delete on public.ifa_leagues, public.ifa_teams, public.ifa_players, public.ifa_rosters, public.ifa_sync_runs
  from authenticated, anon;
grant select on public.ifa_leagues, public.ifa_teams, public.ifa_players, public.ifa_rosters, public.ifa_sync_runs to authenticated;

-- Import one team and its roster. Payload:
-- { "ifa_team_id": 7491, "ifa_season_id": 28, "team_name": "...", "source_url": "...",
--   "ifa_league_id": null, "league_name": null, "sport": "football",
--   "players": [ { "ifa_player_id": "308953", "name": "...", "profile_url": "..." }, ... ] }
-- Run from the SQL Editor (no signed-in user) or by a platform admin.
create function public.import_ifa_team(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season int := (p->>'ifa_season_id')::int;
  v_ifa_team int := (p->>'ifa_team_id')::int;
  v_name text := left(trim(coalesce(p->>'team_name', '')), 60);
  v_league int := nullif(p->>'ifa_league_id', '')::int;
  v_actor uuid := coalesce(auth.uid(), (select user_id from platform_admins order by user_id limit 1));
  v_team uuid;
  v_player uuid;
  v_run uuid;
  r jsonb;
  v_pid bigint;
  v_pname text;
  v_new_teams int := 0;
  v_new_players int := 0;
  v_seen int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_missing jsonb;
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'add a platform admin first (platform_admins)' using errcode = '22023';
  end if;
  if v_season is null or v_ifa_team is null or char_length(v_name) = 0 then
    raise exception 'ifa_season_id, ifa_team_id and team_name are required' using errcode = '22023';
  end if;

  if v_league is not null and coalesce(p->>'league_name', '') <> '' then
    insert into ifa_leagues (ifa_season_id, ifa_league_id, name)
    values (v_season, v_league, left(p->>'league_name', 120))
    on conflict (ifa_season_id, ifa_league_id) do update set name = excluded.name, synced_at = now();
  end if;

  insert into ifa_teams (ifa_season_id, ifa_team_id, name, ifa_league_id, source_url)
  values (v_season, v_ifa_team, v_name, v_league, coalesce(p->>'source_url', ''))
  on conflict (ifa_season_id, ifa_team_id) do update
    set name = excluded.name, ifa_league_id = coalesce(excluded.ifa_league_id, ifa_teams.ifa_league_id),
        source_url = excluded.source_url, synced_at = now();
  select team_id into v_team from ifa_teams where ifa_season_id = v_season and ifa_team_id = v_ifa_team;

  if v_team is null then
    insert into teams (name, club, season, sport, league, created_by)
    values (v_name, '', '2026/27',
            case when p->>'sport' in ('football', 'basketball') then p->>'sport' else 'football' end,
            left(coalesce(p->>'league_name', ''), 80), v_actor)
    returning id into v_team;
    update ifa_teams set team_id = v_team where ifa_season_id = v_season and ifa_team_id = v_ifa_team;
    v_new_teams := 1;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) loop
    begin
      v_pid := case when r->>'ifa_player_id' ~ '^[0-9]+$' then (r->>'ifa_player_id')::bigint end;
      v_pname := left(trim(coalesce(r->>'name', '')), 40);
      if v_pid is null or char_length(v_pname) = 0 then
        v_errors := v_errors || jsonb_build_object('player', r, 'error', 'missing ifa_player_id or name; skipped');
        continue;
      end if;
      insert into ifa_players (ifa_player_id, name, profile_url)
      values (v_pid, v_pname, coalesce(r->>'profile_url', ''))
      on conflict (ifa_player_id) do update set name = excluded.name, profile_url = excluded.profile_url, synced_at = now();
      select player_id into v_player from ifa_players where ifa_player_id = v_pid;
      if v_player is null then
        -- full name as written on the page; not split, no birth year guessed
        insert into players (team_id, first_name, last_name, created_by)
        values (v_team, v_pname, '', v_actor)
        returning id into v_player;
        update ifa_players set player_id = v_player where ifa_player_id = v_pid;
        v_new_players := v_new_players + 1;
      end if;
      insert into ifa_rosters (ifa_season_id, ifa_team_id, ifa_player_id)
      values (v_season, v_ifa_team, v_pid)
      on conflict (ifa_season_id, ifa_team_id, ifa_player_id) do update set last_seen_at = now();
      v_seen := v_seen + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('player', r, 'error', sqlerrm);
    end;
  end loop;

  -- players we had for this team who are not in this payload: report only
  select coalesce(jsonb_agg(x.ifa_player_id), '[]'::jsonb) into v_missing
  from ifa_rosters x
  where x.ifa_season_id = v_season and x.ifa_team_id = v_ifa_team
    and not exists (select 1 from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) e
                    where e->>'ifa_player_id' ~ '^[0-9]+$' and (e->>'ifa_player_id')::bigint = x.ifa_player_id);

  insert into ifa_sync_runs (kind, source, counts, errors, created_by)
  values ('team', coalesce(p->>'source_url', ''),
          jsonb_build_object('ifa_team_id', v_ifa_team, 'players_in_payload', jsonb_array_length(coalesce(p->'players', '[]'::jsonb)),
                             'players_seen', v_seen, 'new_players', v_new_players, 'new_team', v_new_teams,
                             'not_in_payload', v_missing),
          v_errors, v_actor)
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'team_id', v_team, 'new_team', v_new_teams = 1,
                            'players_seen', v_seen, 'new_players', v_new_players,
                            'not_in_payload', v_missing, 'errors', v_errors);
end;
$$;

revoke all on function public.import_ifa_team(jsonb) from public, anon;
grant execute on function public.import_ifa_team(jsonb) to authenticated;

-- ------------------------------------------------------------ privacy
-- Minors imported from the IFA are not published broadly (owner, 2026-11-01):
--   * no photos are stored or shown (image URLs are not imported);
--   * an imported child that no parent has claimed yet does not appear in the
--     open search;
--   * on a team page, non-members see such a child only as first name +
--     initial (enough for a parent to recognise and claim them); members,
--     staff and the club see the full name as before.

create function public.is_unclaimed_import(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ifa_players i where i.player_id = p_player)
     and not exists (select 1 from player_guardians g where g.player_id = p_player and g.relation = 'parent');
$$;

create or replace function public.search_players(p_query text, p_birth_year int default null)
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  team_id uuid, team_name text, club_id uuid, club_name text, program_kind text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.first_name, p.last_name, p.birth_year,
         t.id, t.name, c.id, coalesce(c.name, nullif(t.club, '')), cp.kind
  from players p
  join player_assignments a on a.player_id = p.id and a.ended_on is null
  join teams t on t.id = a.team_id and t.archived_at is null
  left join clubs c on c.id = t.club_id and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where p.archived_at is null
    and (p.first_name || ' ' || p.last_name) ilike '%' || v_q || '%'
    and (p_birth_year is null or p.birth_year = p_birth_year)
    and not is_unclaimed_import(p.id)
  order by p.first_name, p.last_name
  limit 30;
end;
$$;

create or replace function public.team_roster_public(p_team uuid)
returns table (player_id uuid, first_name text, last_name text, birth_year int, has_parent boolean, linked boolean)
language sql stable security definer set search_path = public as $$
  select p.id,
         case when is_unclaimed_import(p.id) and not (is_team_member(p_team) or can(p_team, 'roster', 1))
              then split_part(trim(p.first_name || ' ' || p.last_name), ' ', 1)
              else p.first_name end,
         case when is_unclaimed_import(p.id) and not (is_team_member(p_team) or can(p_team, 'roster', 1))
              then coalesce(left(nullif(split_part(trim(p.first_name || ' ' || p.last_name), ' ', 2), ''), 1) || '׳', '')
              else p.last_name end,
         p.birth_year,
         exists (select 1 from player_guardians g where g.player_id = p.id and g.relation = 'parent'),
         exists (select 1 from player_guardians g where g.player_id = p.id and g.user_id = auth.uid())
  from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  where auth.uid() is not null and a.team_id = p_team and a.ended_on is null
    and exists (select 1 from teams t where t.id = p_team and t.archived_at is null)
  order by p.first_name, p.last_name;
$$;

-- Last sync per team for the Super Admin screen.
create function public.ifa_sync_overview()
returns table (ifa_season_id int, ifa_team_id int, name text, team_id uuid, players int, synced_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.ifa_season_id, t.ifa_team_id, t.name, t.team_id,
         (select count(*)::int from ifa_rosters r where r.ifa_season_id = t.ifa_season_id and r.ifa_team_id = t.ifa_team_id),
         t.synced_at
  from ifa_teams t
  where is_platform_admin()
  order by t.synced_at desc;
$$;

revoke all on function public.is_unclaimed_import(uuid), public.ifa_sync_overview() from public, anon;
grant execute on function public.is_unclaimed_import(uuid), public.ifa_sync_overview(), public.search_players(text, int),
  public.team_roster_public(uuid) to authenticated;

commit;
