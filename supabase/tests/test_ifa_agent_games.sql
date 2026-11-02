-- The Mac agent sends a team's games page with its key: applied for an imported
-- team, refused for a wrong key, a league-wide page or a team not imported.
-- Runs after test_match_overrides.sql (team 9301 and game 7100001 exist).
\set ON_ERROR_STOP on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then reset role; else set role authenticated; end if;
end;
$$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  set role anon;
end;
$$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
  raise notice 'ok  %', p_what;
end;
$$;
create or replace function pg_temp.fails(p_sql text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok  % (refused: %)', p_what, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % was allowed', p_what;
end;
$$;

select pg_temp.as_user('00000000-0000-0000-0000-000000000033');
create temp table t_ak as select create_ifa_agent_key('games test') as k;
select pg_temp.as_user(null);
create temp table t_ag as select '{
  "ifa_season_id": 28, "source_url": "test:agent-games", "scope": {"kind": "team", "ifa_team_id": 9301},
  "games": [{"ifa_game_id": "7100002", "date": "2027-01-09", "time": "11:00", "home_ifa_team_id": 9303, "away_ifa_team_id": 9301,
             "home_name": "יריבה ג", "away_name": "קבוצת סקירה", "venue": "מגרש ג", "status": "scheduled"}]}'::jsonb as p;
grant select on t_ak, t_ag to anon, authenticated;

select pg_temp.as_anon();
select pg_temp.fails($$select agent_import_ifa_games('wrong', p) from t_ag$$, 'wrong agent key');
select pg_temp.fails($$select import_ifa_games(p, true) from t_ag$$, 'anon calls import_ifa_games directly with no key');
create temp table t_r1 as select agent_import_ifa_games((select k from t_ak), p) as r from t_ag;
create temp table t_r2 as select agent_import_ifa_games((select k from t_ak), jsonb_set(p, '{scope}', '{"kind":"league","ifa_team_id":null}')) as r from t_ag;
create temp table t_r3 as select agent_import_ifa_games((select k from t_ak), jsonb_set(p, '{scope,ifa_team_id}', '9399')) as r from t_ag;
select pg_temp.as_user(null);
select pg_temp.check((select (r->>'ok')::boolean and (r->>'new')::int = 1 from t_r1), 'agent: games page applied (1 new game)');
select pg_temp.check((select count(*) from team_matches where ifa_game = (select id from ifa_games where ifa_game_id = 7100002)) = 1, 'agent: game mirrored to the app team');
select pg_temp.check((select not (r->>'ok')::boolean from t_r2), 'agent: league-wide page refused');
select pg_temp.check((select not (r->>'ok')::boolean and r->>'error' like 'team not imported%' from t_r3), 'agent: team not imported refused');
