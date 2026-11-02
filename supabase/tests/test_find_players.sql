-- Find a player by name (find_players). Runs after the IFA tests.
\set ON_ERROR_STOP on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  if p is null then reset role; else set role authenticated; end if;
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

\set U1 '''00000000-0000-0000-0000-000000000071'''
\set U2 '''00000000-0000-0000-0000-000000000072'''
insert into auth.users (id, email) values (:U1, 'u71@test'), (:U2, 'u72@test');

-- helpers
select pg_temp.check(ifa_age_group('2026/2027 ליגת ילדים טרום ב'' דן') = 'טרום ב׳', 'age group: טרום before ילדים');
select pg_temp.check(ifa_age_group('ליגת נערים ג׳ מרכז') = 'נערים ג׳', 'age group: נערים ג׳');
select pg_temp.check(ifa_age_group('ליגת ילדות א') is null, 'age group: girls league gives no estimate');
select pg_temp.check(ifa_estimated_birth_year('נערים א׳', 28) = 2010 and ifa_estimated_birth_year('טרום ג׳', 28) = 2018,
                     'estimate: season 2026/27 נערים א=2010, טרום ג=2018');

-- two IFA teams, two different players with the same name (made-up names and ids)
select pg_temp.as_user(null);
select import_ifa_team('{"ifa_team_id": 9701, "ifa_season_id": 28, "team_name": "שמשון צפון", "source_url": "test:find",
  "ifa_league_id": 9771, "league_name": "2026/2027 ליגת נערים ג'' מרכז", "players": [
   {"ifa_player_id": "600001", "name": "דניאל זהבי", "profile_url": ""},
   {"ifa_player_id": "600003", "name": "יואב זהבי", "profile_url": ""}]}'::jsonb);
select import_ifa_team('{"ifa_team_id": 9702, "ifa_season_id": 28, "team_name": "שמשון דרום", "source_url": "test:find",
  "ifa_league_id": 9772, "league_name": "2026/2027 ליגת ילדים טרום ב'' דן", "players": [
   {"ifa_player_id": "600002", "name": "דניאל זהבי", "profile_url": ""}]}'::jsonb);
create temp table t_k1 as select player_id from ifa_players where ifa_player_id = 600001;
create temp table t_k2 as select player_id from ifa_players where ifa_player_id = 600002;
create temp table t_t1 as select team_id from ifa_teams where ifa_team_id = 9701;
grant select on t_k1, t_k2, t_t1 to authenticated;

select pg_temp.fails('select * from find_players(''דניאל'')', 'find without signing in');

select pg_temp.as_user(:U1);
select pg_temp.check((select count(*) from search_players('דניאל זהבי')) = 0, 'old search unchanged: still hides unclaimed imports');
select pg_temp.check((select count(*) from find_players('דניאל זהבי')) = 2, 'find: both players with the same name');
select pg_temp.check((select count(distinct player_id) from find_players('דניאל זהבי')) = 2, 'find: two separate players, not merged');
select pg_temp.check((select bool_and(name_hidden and first_name = 'דניאל' and last_name = 'ז׳' and same_name = 2 and from_ifa)
                      from find_players('דניאל זהבי')), 'find: outsider sees first name + initial, same-name count 2');
select pg_temp.check((select array_agg(birth_year_est order by birth_year_est) from find_players('דניאל זהבי')) = '{2012,2017}',
                     'find: estimated birth year from the league age group');
select pg_temp.check((select birth_year_est from find_players('דניאל זהבי') where team_name = 'שמשון צפון') = 2012
                     and (select age_group from find_players('דניאל זהבי') where team_name = 'שמשון צפון') = 'נערים ג׳', 'find: team and age group per hit');
select pg_temp.check((select count(*) from find_players('זהבי דניאל')) = 2, 'find: words in any order');
select pg_temp.check((select count(*) from find_players('דניאל זהבי', 2012)) = 1, 'find: birth-year filter matches the estimate');
select pg_temp.check((select count(*) from find_players('%%')) = 0, 'find: % is a plain character');
select pg_temp.check((select count(*) from find_players('ד')) = 0, 'find: needs 2+ characters');
select pg_temp.check((select count(*) from find_players('זהבי')) = 3, 'find: last name finds the whole family');

-- the parent claims one child: no staff, approved right away; then the full name shows
select request_join((select team_id from t_t1), (select player_id from t_k1), '', '', null, '', 'parent', true);
select pg_temp.check((select last_name from find_players('דניאל זהבי') where player_id = (select player_id from t_k1)) = ''
                     and (select first_name from find_players('דניאל זהבי') where player_id = (select player_id from t_k1)) = 'דניאל זהבי',
                     'find: claimed child shows the full name');
select pg_temp.check((select name_hidden from find_players('יואב') limit 1) = false, 'find: a team member sees the teammate''s full name');
select pg_temp.as_user(:U2);
select pg_temp.check((select name_hidden from find_players('יואב') limit 1), 'find: an outsider still sees the teammate masked');
select pg_temp.check((select count(*) from teams) = 0, 'find does not open the teams table');

-- an exact year entered by a parent / coach wins over the estimate
select pg_temp.as_user(null);
update players set birth_year = 2016 where id = (select player_id from t_k2);
select pg_temp.as_user(:U2);
select pg_temp.check((select birth_year from find_players('דניאל זהבי') where player_id = (select player_id from t_k2)) = 2016
                     and (select birth_year_est from find_players('דניאל זהבי') where player_id = (select player_id from t_k2)) is null,
                     'find: exact birth year replaces the estimate');
select pg_temp.check((select count(*) from find_players('דניאל זהבי', 2016)) = 1, 'find: birth-year filter matches the exact year');
select pg_temp.as_user(null);
