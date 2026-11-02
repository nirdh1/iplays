-- Coach overrides on IFA games: field-level precedence, conflict on a later IFA
-- change, keep mine (not asked again) / take IFA, other fields keep syncing.
-- Runs after test_ifa_roster_review.sql (team 9301, CO is its team admin).
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

\set CO '''00000000-0000-0000-0000-000000000061'''
\set OT '''00000000-0000-0000-0000-000000000062'''
select pg_temp.as_user(null);

create temp table t_g as select '{
  "ifa_season_id": 28, "source_url": "test:overrides", "scope": {"kind": "team", "ifa_team_id": 9301},
  "games": [{"ifa_game_id": "7100001", "date": "2026-12-12", "time": "10:00", "home_ifa_team_id": 9301, "away_ifa_team_id": 9302,
             "home_name": "קבוצת סקירה", "away_name": "יריבה", "venue": "מגרש העירייה", "status": "scheduled"}]}'::jsonb as p;
create function pg_temp.g(patch jsonb) returns jsonb language sql as $$
  select jsonb_set(p, '{games,0}', (p->'games'->0) || patch) from t_g;
$$;
select import_ifa_games(p, true) from t_g;
create temp table t_m as select id from team_matches where ifa_game = (select id from ifa_games where ifa_game_id = 7100001);
grant select on t_m to authenticated;
select pg_temp.check((select venue from team_matches where id = (select id from t_m)) = 'מגרש העירייה', 'setup: IFA game mirrored');

-- who may override
select pg_temp.as_user(:OT);
select pg_temp.fails($$select set_match_override((select id from t_m), 'venue', '"מגרש אחר"')$$, 'other user overrides');
select pg_temp.as_user(:CO);
select pg_temp.fails($$select set_match_override((select id from t_m), 'status', '"lost"')$$, 'bad status value');
select pg_temp.fails($$select set_match_override((select id from t_m), 'score', '[1]')$$, 'bad score value');

-- coach moves the game to another ground
select set_match_override((select id from t_m), 'venue', '"מגרש סינטטי ב"');
select pg_temp.check((select venue from team_matches where id = (select id from t_m)) = 'מגרש סינטטי ב', 'override: coach venue shown');
select pg_temp.check((select count(*) from my_match_conflicts()) = 0, 'override: no conflict yet');

-- the IFA page is synced again unchanged: coach value stays, no conflict
select pg_temp.as_user(null);
select import_ifa_games(p, true) from t_g;
select pg_temp.check((select venue from team_matches where id = (select id from t_m)) = 'מגרש סינטטי ב', 'resync unchanged: coach venue kept');
select pg_temp.check((select conflict_ifa_value is null from team_match_overrides where match_id = (select id from t_m) and status = 'active'), 'resync unchanged: no conflict');

-- the IFA changes the time (not overridden) and the venue (overridden)
select import_ifa_games(pg_temp.g('{"time": "12:30", "venue": "אצטדיון חדש"}'), true);
select pg_temp.check((select to_char(starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') from team_matches where id = (select id from t_m)) = '12:30', 'other field: time follows the IFA');
select pg_temp.check((select venue from team_matches where id = (select id from t_m)) = 'מגרש סינטטי ב', 'conflict: coach venue still in force');
select pg_temp.as_user(:CO);
select pg_temp.check((select field || ':' || (mine#>>'{}') || '|' || (ifa#>>'{}') from my_match_conflicts()) = 'venue:מגרש סינטטי ב|אצטדיון חדש', 'conflict: both versions shown');
select pg_temp.as_user(:OT);
select pg_temp.check((select count(*) from my_match_conflicts()) = 0, 'other user: sees no conflict');

-- keep mine: not asked again for the same IFA value
select pg_temp.as_user(:CO);
select resolve_match_conflict((select id from t_m), 'venue', true);
select pg_temp.check((select count(*) from my_match_conflicts()) = 0, 'keep mine: conflict closed');
select pg_temp.as_user(null);
select import_ifa_games(pg_temp.g('{"time": "12:30", "venue": "אצטדיון חדש"}'), true);
select pg_temp.check((select conflict_ifa_value is null from team_match_overrides where match_id = (select id from t_m) and status = 'active'), 'keep mine: same IFA value not asked again');

-- the IFA changes the venue again: asked again; take IFA
select import_ifa_games(pg_temp.g('{"time": "12:30", "venue": "מגרש שלישי"}'), true);
select pg_temp.as_user(:CO);
select pg_temp.check((select ifa#>>'{}' from my_match_conflicts()) = 'מגרש שלישי', 'new IFA value: asked again');
select resolve_match_conflict((select id from t_m), 'venue', false);
select pg_temp.check((select venue from team_matches where id = (select id from t_m)) = 'מגרש שלישי', 'take IFA: IFA venue applied');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from team_match_overrides where match_id = (select id from t_m) and status = 'active') = 0, 'take IFA: override released');
select pg_temp.check((select count(*) from team_match_overrides where match_id = (select id from t_m)) = 1, 'take IFA: history row kept');

-- a score override that the IFA later confirms closes by itself
select pg_temp.as_user(:CO);
select set_match_override((select id from t_m), 'score', '[3, 1]');
select pg_temp.check((select score_for = 3 and score_against = 1 from team_matches where id = (select id from t_m)), 'score override applied');
select pg_temp.as_user(null);
select import_ifa_games(pg_temp.g('{"time": "12:30", "venue": "מגרש שלישי", "status": "played", "result_raw": "3-1", "home_score": 3, "away_score": 1}'), true);
select pg_temp.check((select conflict_ifa_value is null from team_match_overrides where match_id = (select id from t_m) and status = 'active'), 'IFA agrees: no conflict');

-- club matches are edited directly, not overridden
insert into team_matches (team_id, starts_at, opponent, created_by)
select team_id, '2026-12-20 17:00+02', 'ידידות', :CO from ifa_teams where ifa_team_id = 9301;
create temp table t_club as select id from team_matches where opponent = 'ידידות';
grant select on t_club to authenticated;
select pg_temp.as_user(:CO);
select pg_temp.fails($$select set_match_override((select id from t_club), 'venue', '"x"')$$, 'override on a club match');
select pg_temp.as_user(null);
