-- iplays — Israel Football Association (IFA) public data.
--
-- A server job (supabase/functions/ifa-sync) reads what the IFA publishes on
-- football.org.il and writes it here with the service role. The app only
-- reads. iplays is independent and not on behalf of the IFA; the IFA
-- publication and the coach's notice always win.
--
-- Leagues, teams, fixtures and standings are public sports data, readable by
-- any signed-in user (needed to pick your team). Player names are about
-- minors, so they are readable only by members of an iplays team that is
-- linked to that IFA team.

-- ---------------------------------------------------------------- tables

create table public.ifa_leagues (
  id text primary key,                      -- IFA league_id
  season text not null,                     -- e.g. 2026/27
  age_group text not null default '',       -- טרום / ילדים / נערים / נוער / בוגרים
  tier text not null default '',            -- א / ב / ג / על / לאומית ...
  district text not null default '',        -- מחוז
  name text not null,
  url text not null default '',
  updated_at timestamptz not null default now()
);
create index ifa_leagues_filter_idx on public.ifa_leagues (season, age_group, district);

create table public.ifa_teams (
  id text primary key,                      -- IFA team_id
  league_id text references public.ifa_leagues (id) on delete set null,
  name text not null,
  club text not null default '',
  url text not null default '',
  updated_at timestamptz not null default now()
);
create index ifa_teams_league_idx on public.ifa_teams (league_id);

create table public.ifa_matches (
  id text primary key,                      -- IFA game id
  league_id text not null references public.ifa_leagues (id) on delete cascade,
  round int,
  kickoff timestamptz,
  home_team_id text,
  away_team_id text,
  home_name text not null default '',
  away_name text not null default '',
  venue text not null default '',
  venue_address text not null default '',
  home_score int,
  away_score int,
  status text not null default 'scheduled' check (status in ('scheduled', 'played', 'postponed', 'cancelled')),
  updated_at timestamptz not null default now()
);
create index ifa_matches_home_idx on public.ifa_matches (home_team_id, kickoff);
create index ifa_matches_away_idx on public.ifa_matches (away_team_id, kickoff);
create index ifa_matches_league_idx on public.ifa_matches (league_id, kickoff);

create table public.ifa_standings (
  league_id text not null references public.ifa_leagues (id) on delete cascade,
  team_id text not null,
  team_name text not null,
  position int not null,
  played int not null default 0,
  won int not null default 0,
  drawn int not null default 0,
  lost int not null default 0,
  goals_for int not null default 0,
  goals_against int not null default 0,
  points int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (league_id, team_id)
);

create table public.ifa_players (
  team_id text not null references public.ifa_teams (id) on delete cascade,
  player_id text not null,                  -- IFA player id
  first_name text not null,
  last_name text not null default '',
  shirt_number int,
  birth_year int,
  updated_at timestamptz not null default now(),
  primary key (team_id, player_id)
);

-- Link an iplays team to its IFA team (set by the team's staff).
alter table public.teams add column ifa_team_id text references public.ifa_teams (id) on delete set null;
create index teams_ifa_idx on public.teams (ifa_team_id);

-- Remember which IFA player a roster row came from, so re-imports don't duplicate.
alter table public.players add column ifa_player_id text;
create unique index players_team_ifa_idx on public.players (team_id, ifa_player_id) where ifa_player_id is not null;

-- --------------------------------------------------------------- helpers

create function public.is_linked_to_ifa_team(p_ifa_team text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teams t join team_members m on m.team_id = t.id
    where t.ifa_team_id = p_ifa_team and m.user_id = auth.uid()
  );
$$;

-- Copy the IFA roster into the iplays roster. Staff only. Existing rows
-- (same IFA player, or same shirt number) are kept as they are.
create function public.import_ifa_roster(p_team uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ifa text;
  v_count int;
begin
  if not is_team_staff(p_team) then
    raise exception 'only team staff can import the roster';
  end if;
  select ifa_team_id into v_ifa from teams where id = p_team;
  if v_ifa is null then
    raise exception 'team is not linked to the IFA';
  end if;

  insert into players (team_id, first_name, last_name, shirt_number, birth_year, ifa_player_id)
  select p_team, left(ip.first_name, 40), left(ip.last_name, 40),
         case when ip.shirt_number between 0 and 99
               and not exists (select 1 from players x where x.team_id = p_team and x.shirt_number = ip.shirt_number)
              then ip.shirt_number end,
         case when ip.birth_year between 2000 and 2030 then ip.birth_year end,
         ip.player_id
  from ifa_players ip
  where ip.team_id = v_ifa
    and not exists (select 1 from players x where x.team_id = p_team and x.ifa_player_id = ip.player_id)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_ifa_roster, public.is_linked_to_ifa_team from public, anon;
grant execute on function public.import_ifa_roster, public.is_linked_to_ifa_team to authenticated;

-- ------------------------------------------------------------------- RLS

alter table public.ifa_leagues enable row level security;
alter table public.ifa_teams enable row level security;
alter table public.ifa_matches enable row level security;
alter table public.ifa_standings enable row level security;
alter table public.ifa_players enable row level security;

create policy ifa_leagues_select on public.ifa_leagues for select to authenticated using (true);
create policy ifa_teams_select on public.ifa_teams for select to authenticated using (true);
create policy ifa_matches_select on public.ifa_matches for select to authenticated using (true);
create policy ifa_standings_select on public.ifa_standings for select to authenticated using (true);
create policy ifa_players_select on public.ifa_players for select to authenticated using (is_linked_to_ifa_team(team_id));

grant select on public.ifa_leagues, public.ifa_teams, public.ifa_matches, public.ifa_standings, public.ifa_players to authenticated;
-- No insert/update/delete grants: only the sync job (service role) writes.
