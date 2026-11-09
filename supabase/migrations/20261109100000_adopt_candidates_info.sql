-- Club "חיפוש" tab: tell look-alike teams apart before a club adopts one.
-- Many IFA catalog teams share a name ("הפועל רמת גן דרום" x5) and have no age
-- group, so the club admin cannot see which is which. This returns, for teams
-- that are still free to adopt (no club), the league, the season, and the most
-- common birth year in the active roster. Aggregates only: no player names.
-- Who: a club owner/admin (of any club) or a platform admin. Read-only.
-- Rollback: supabase/rollback/20261109100000_adopt_candidates_info.down.sql
begin;

create or replace function public.adopt_candidates_info(p_teams uuid[])
returns table (team_id uuid, league text, season text, roster_year int, roster_players int)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not (is_platform_admin() or exists (
    select 1 from club_staff s where s.user_id = auth.uid() and s.role in ('owner', 'admin')
  )) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_teams, 1), 0) > 100 then
    raise exception 'too many teams' using errcode = '22023';
  end if;
  return query
  select t.id,
         coalesce(nullif(il.name, ''), nullif(t.league, ''), '') as league,
         t.season,
         (select p.birth_year from player_assignments a join players p on p.id = a.player_id
           where a.team_id = t.id and a.ended_on is null and p.birth_year is not null
           group by p.birth_year order by count(*) desc, p.birth_year desc limit 1),
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null)
  from teams t
  left join ifa_teams it on it.team_id = t.id
  left join ifa_leagues il on il.ifa_season_id = it.ifa_season_id and il.ifa_league_id = it.ifa_league_id
  where t.id = any (p_teams) and t.club_id is null and t.archived_at is null;
end;
$$;

revoke all on function public.adopt_candidates_info(uuid[]) from public, anon;
grant execute on function public.adopt_candidates_info(uuid[]) to authenticated;

commit;
