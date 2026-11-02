-- iplays — the Mac agent may send a team's games page (saved by the owner).
--
-- Run after 20261102200000_match_overrides.sql. Additive only: one function.
-- Rollback: supabase/rollback/20261102300000_ifa_agent_games.down.sql.
--
-- Spec section 12/13: game schedules keep following newer saved pages
-- (date, time, venue, status, result), matched by the IFA game id or by
-- season + home + away. A coach's own value still wins field by field
-- (20261102200000_match_overrides.sql). Rosters are NOT sent this way: a
-- newer roster only proposes changes (agent_propose_ifa_roster).
--
-- Limits: one team's games page at a time (scope.kind = 'team'), only for a
-- team already imported (in ifa_teams). The agent key cannot import a new team.

begin;

create or replace function public.agent_import_ifa_games(p_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := ifa_agent_id(p_key);
  v_season int := case when p_payload->>'ifa_season_id' ~ '^[0-9]+$' then (p_payload->>'ifa_season_id')::int end;
  v_team int := case when p_payload #>> '{scope,ifa_team_id}' ~ '^[0-9]+$' then (p_payload #>> '{scope,ifa_team_id}')::int end;
begin
  if p_payload #>> '{scope,kind}' is distinct from 'team' or v_team is null or v_season is null then
    return jsonb_build_object('ok', false, 'error', 'send one team''s games page (scope.kind = team) with ifa_season_id');
  end if;
  if not exists (select 1 from ifa_teams where ifa_season_id = v_season and ifa_team_id = v_team) then
    return jsonb_build_object('ok', false, 'error', 'team not imported yet: run the first import for it');
  end if;
  return jsonb_build_object('ok', true, 'agent_id', v_agent) || import_ifa_games(p_payload, true);
end;
$$;

revoke all on function public.agent_import_ifa_games(text, jsonb) from public;
grant execute on function public.agent_import_ifa_games(text, jsonb) to anon, authenticated;

commit;
