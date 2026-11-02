-- Smarter team and player search (find_teams, abbreviations, year in the query).
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

\set U3 '''00000000-0000-0000-0000-000000000073'''
insert into auth.users (id, email) values (:U3, 'u73@test');

select pg_temp.check(search_norm('מכבי ת"א') = 'מכבי תל אביב', 'norm: ת"א');
select pg_temp.check(search_norm('הפועל ת״א') = 'הפועל תל אביב', 'norm: ת״א with gershayim');
select pg_temp.check(search_norm('בני ת''''א') = 'בני תל אביב', 'norm: two apostrophes');
select pg_temp.check(search_norm('הפועל פ"ת') = 'הפועל פתח תקווה' and search_norm('מכבי פתח תקוה') = 'מכבי פתח תקווה', 'norm: פ"ת and תקוה');
select pg_temp.check(search_norm('הפועל ר"ג   ב"ש כ"ס') = 'הפועל רמת גן באר שבע כפר סבא', 'norm: ר"ג, ב"ש, כ"ס, spaces');
select pg_temp.check(search_year('מכבי תל אביב 2010') = 2010 and search_year('מכבי 12') is null, 'year read from the query');
select pg_temp.check(search_words('מכבי תל אביב 2010') = '{מכבי,תל,אביב}', 'year is not a name word');

-- made-up teams in the style of the IFA catalog
select pg_temp.as_user(null);
select import_ifa_team('{"ifa_team_id": 9801, "ifa_season_id": 28, "team_name": "מכבי תל אביב עודד", "source_url": "test:smart",
  "ifa_league_id": 9881, "league_name": "2026/2027 ליגת נערים א'' מרכז",
  "players": [{"ifa_player_id": "680001", "name": "רון בדיקתי", "profile_url": ""}]}'::jsonb);
select import_ifa_team('{"ifa_team_id": 9802, "ifa_season_id": 28, "team_name": "הפועל ת\"א צפון", "source_url": "test:smart",
  "ifa_league_id": 9882, "league_name": "2026/2027 ליגת ילדים טרום ב'' דן", "players": []}'::jsonb);
-- 45 more teams of the same club in younger age groups: the old search stopped at 40
do $$ begin
  for i in 1..45 loop
    perform import_ifa_team(jsonb_build_object('ifa_team_id', 9900 + i, 'ifa_season_id', 28,
      'team_name', 'מכבי תל אביב ' || i, 'source_url', 'test:smart',
      'ifa_league_id', 9883, 'league_name', '2026/2027 ליגת ילדים טרום ב'' שרון', 'players', '[]'::jsonb));
  end loop;
end $$;
-- the app label as set by the age-category step: "נערים א׳ – מכבי תל אביב עודד"
select set_ifa_team_category(28, 9801, 'נערים א׳');

select pg_temp.fails('select * from find_teams(''מכבי'')', 'find teams without signing in');
select pg_temp.as_user(:U3);
select pg_temp.check((select count(*) from find_teams('מכבי תל אביב') where name like '%עודד%') = 1, 'teams: "מכבי תל אביב" finds עודד among 46 teams');
select pg_temp.check((select count(*) from find_teams('מכבי ת"א') where name like '%עודד%') = 1, 'teams: "מכבי ת״א" finds it too');
select pg_temp.check((select count(*) from find_teams('מכבי תל אביב 2010')) = 1, 'teams: year in the query = age group filter');
select pg_temp.check((select age_group || ' ' || birth_year_est from find_teams('מכבי תל אביב 2010')) = 'נערים א׳ 2010', 'teams: age group + estimated year per hit');
select pg_temp.check((select count(*) from find_teams('מכבי', 2010)) = 1, 'teams: birth-year field = same filter');
select pg_temp.check((select count(*) from find_teams('מכבי תל אביב 2017')) = 45, 'teams: 2017 = טרום ב׳');
select pg_temp.check((select count(*) from find_teams('הפועל תל אביב')) = 1, 'teams: full name finds a team written ת"א');
select pg_temp.check((select count(*) from find_teams('תל אביב עודד מכבי')) = 1, 'teams: words in any order');
select pg_temp.check((select count(*) from find_teams('נערים א מכבי')) = 1, 'teams: age group words match');
select pg_temp.check((select count(*) from find_teams('2010')) >= 1, 'teams: year alone');
select pg_temp.check((select count(*) from find_teams('x')) = 0, 'teams: needs 2+ characters or a year');

-- players: same rules, team words allowed next to the name
select pg_temp.check((select count(*) from find_players('רון מכבי תל אביב')) = 1, 'players: name + team');
select pg_temp.check((select count(*) from find_players('רון ת"א')) = 1, 'players: abbreviation in the team part');
select pg_temp.check((select count(*) from find_players('רון 2010')) = 1 and (select count(*) from find_players('רון 2012')) = 0, 'players: year in the query');
select pg_temp.check((select count(*) from find_players('מכבי תל אביב')) = 0, 'players: at least one word must be in the name');
select pg_temp.check((select first_name || ' ' || last_name from find_players('רון בדיקתי')) = 'רון ב׳', 'players: privacy mask unchanged');
select pg_temp.as_user(null);
