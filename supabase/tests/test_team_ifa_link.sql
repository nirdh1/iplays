-- Team page link to the IFA site. Runs after test_ifa_agent.sql (team 9201 imported there).
\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
  raise notice 'ok  %', p_what;
end;
$$;

create temp table t_team as select team_id from ifa_teams where ifa_team_id = 9201 and ifa_season_id = 28;
grant select on t_team to anon, authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
set role authenticated;
select pg_temp.check((select ifa_team_id = 9201 and ifa_season_id = 28 from team_ifa_link((select team_id from t_team))), 'a signed-in user gets the IFA team id and season');
select pg_temp.check((select count(*) from team_ifa_link(gen_random_uuid())) = 0, 'a team without an IFA link returns nothing');
select pg_temp.check((select count(*) from ifa_teams) = 0, 'the IFA tables stay closed to a regular user');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
begin
  perform team_ifa_link(gen_random_uuid());
  raise exception 'FAIL: anon called team_ifa_link';
exception when insufficient_privilege then
  raise notice 'ok  anon cannot call team_ifa_link';
end;
$$;
reset role;
