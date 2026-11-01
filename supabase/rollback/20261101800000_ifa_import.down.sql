-- Rollback of 20261101800000_ifa_import.sql. Keeps every ifa_* table and row,
-- and every team / player the import created.
begin;
drop function if exists public.import_ifa_team(jsonb);
drop function if exists public.ifa_sync_overview();
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
  order by p.first_name, p.last_name
  limit 30;
end;
$$;

create or replace function public.team_roster_public(p_team uuid)
returns table (player_id uuid, first_name text, last_name text, birth_year int, has_parent boolean, linked boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.birth_year,
         exists (select 1 from player_guardians g where g.player_id = p.id and g.relation = 'parent'),
         exists (select 1 from player_guardians g where g.player_id = p.id and g.user_id = auth.uid())
  from player_assignments a
  join players p on p.id = a.player_id and p.archived_at is null
  where auth.uid() is not null and a.team_id = p_team and a.ended_on is null
    and exists (select 1 from teams t where t.id = p_team and t.archived_at is null)
  order by p.first_name, p.last_name;
$$;

drop function if exists public.is_unclaimed_import(uuid);
drop policy if exists ifa_leagues_admin on public.ifa_leagues;
drop policy if exists ifa_teams_admin on public.ifa_teams;
drop policy if exists ifa_players_admin on public.ifa_players;
drop policy if exists ifa_rosters_admin on public.ifa_rosters;
drop policy if exists ifa_sync_runs_admin on public.ifa_sync_runs;
revoke all on public.ifa_leagues, public.ifa_teams, public.ifa_players, public.ifa_rosters, public.ifa_sync_runs from authenticated;
commit;
