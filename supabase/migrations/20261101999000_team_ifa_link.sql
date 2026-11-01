-- iplays — link from a team page to the same team on the IFA site.
--
-- Run after 20261101998000_ifa_agent.sql. Additive only: one read-only function.
-- Rollback: supabase/rollback/20261101999000_team_ifa_link.down.sql
--
-- ifa_teams is readable by platform admins only. The team page needs just the
-- IFA team id and season of a linked team (public numbers that are already in
-- the IFA site's own URLs), so this returns those two numbers and nothing else:
-- no names, rosters or players.

begin;

create or replace function public.team_ifa_link(p_team uuid)
returns table (ifa_team_id int, ifa_season_id int)
language sql stable security definer set search_path = public as $$
  select t.ifa_team_id, t.ifa_season_id
  from ifa_teams t
  where auth.uid() is not null and t.team_id = p_team
  order by t.ifa_season_id desc
  limit 1;
$$;

revoke all on function public.team_ifa_link(uuid) from public;
grant execute on function public.team_ifa_link(uuid) to authenticated;

commit;
