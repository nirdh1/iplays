-- IFA games sync: matching without game ids, change detection, history,
-- notification queue and dedupe, using made-up games (simulated changes only).
-- Runs after test_ifa.sql (team 9001 exists, U9 is a parent member of it).
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

\set SA '''00000000-0000-0000-0000-000000000033'''
\set U9 '''00000000-0000-0000-0000-000000000041'''

select pg_temp.as_user(null);
create temp table t_team as select team_id from ifa_teams where ifa_season_id = 28 and ifa_team_id = 9001;
grant select on t_team to authenticated;
select pg_temp.check(exists (select 1 from team_members m join t_team t using (team_id) where m.user_id = :U9), 'setup: U9 is a member of team 9001');

-- a match the club created itself; the sync must never touch it
insert into team_matches (team_id, starts_at, opponent, venue, created_by)
select team_id, '2026-12-01 17:00+02', 'משחק ידידות', 'מגרש המועדון', :SA from t_team;

-- made-up games, shaped like the saved team-games page: one with an id, two with -1
create temp table t_p as select '{
  "ifa_season_id": 28, "ifa_league_id": 9640, "league_name": "2026/2027 ליגת בדיקה טרום ב׳ דן", "source_url": "test:team-games",
  "scope": {"kind": "team", "ifa_team_id": 9001},
  "games": [
    {"ifa_game_id": "7000001", "date": "2026-11-07", "time": "18:15", "home_ifa_team_id": 9002, "away_ifa_team_id": 9001,
     "home_name": "יריבה א", "away_name": "קבוצת בדיקה", "venue": "מגרש א", "status": "scheduled"},
    {"ifa_game_id": "-1", "date": "2026-12-05", "time": "00:00", "home_ifa_team_id": 9001, "away_ifa_team_id": 9003,
     "home_name": "קבוצת בדיקה", "away_name": "יריבה ב", "venue": "", "status": "scheduled"},
    {"ifa_game_id": "-1", "date": "2027-01-16", "time": "00:00", "home_ifa_team_id": 9004, "away_ifa_team_id": 9001,
     "home_name": "יריבה ג", "away_name": "קבוצת בדיקה", "venue": "", "status": "scheduled"}
  ]}'::jsonb as p;
grant select on t_p to authenticated;
-- helper: payload with one game changed
create function pg_temp.with_game(p jsonb, i int, patch jsonb) returns jsonb language sql as $$
  select jsonb_set(p, array['games', i::text], (p->'games'->i) || patch);
$$;

-- dry run writes nothing but the run log
create temp table t_dry as select import_ifa_games(p, false) as r from t_p;
select pg_temp.check((select (r->>'new')::int from t_dry) = 3, 'dry run: 3 new games found');
select pg_temp.check((select count(*) from ifa_games) = 0, 'dry run: nothing written');
select pg_temp.check((select status from ifa_sync_runs where id = (select (r->>'run_id')::uuid from t_dry)) = 'dry_run', 'dry run: logged as dry_run');

-- first import
create temp table t_a1 as select import_ifa_games(p, true) as r from t_p;
select pg_temp.check((select (r->>'new')::int from t_a1) = 3 and (select jsonb_array_length(r->'errors') from t_a1) = 0, 'import: 3 new games, no errors');
select pg_temp.check((select count(*) from ifa_games where ifa_game_id is null) = 2, 'import: games without an IFA id are kept (id empty)');
select pg_temp.check((select count(*) from team_matches tm join t_team t using (team_id) where tm.source = 'ifa') = 3, 'import: 3 IFA matches on the app team');
select pg_temp.check((select not time_confirmed and kickoff_time is null from ifa_games where home_ifa_team_id = 9001 and away_ifa_team_id = 9003),
                     '00:00 stored as time not confirmed');
select pg_temp.check((select venue = '' from ifa_games where home_ifa_team_id = 9001 and away_ifa_team_id = 9003), 'empty venue allowed');
select pg_temp.check((select time_confirmed and kickoff_time = '18:15' from ifa_games where ifa_game_id = 7000001), 'real time confirmed');
select pg_temp.check((select home = false and opponent = 'יריבה א' from team_matches where ifa_game = (select id from ifa_games where ifa_game_id = 7000001)),
                     'mirror: away game, opponent from IFA');
select pg_temp.check((select count(*) from notification_outbox) = 0, 'first load: no notifications');
select pg_temp.check((select count(*) from ifa_game_updates) = 0, 'first load: no change history');
select pg_temp.check((select league from teams where id = (select team_id from t_team)) = 'ליגת בדיקה טרום ב׳ דן', 'team page: league name from the games page');
select pg_temp.check((select ifa_league_id from ifa_teams where ifa_team_id = 9001) = 9640, 'IFA team linked to its league');

-- the same payload again: nothing changes
create temp table t_a2 as select import_ifa_games(p, true) as r from t_p;
select pg_temp.check((select (r->>'unchanged')::int from t_a2) = 3 and (select (r->>'new')::int + (r->>'changed')::int from t_a2) = 0,
                     're-run: 3 unchanged, no duplicates');
select pg_temp.check((select count(*) from ifa_games) = 3, 're-run: still 3 games');

-- simulated changes: venue of game 1, time of game 2 becomes known, game 3 gets an IFA id
create temp table t_p2 as
select pg_temp.with_game(pg_temp.with_game(pg_temp.with_game(p, 0, '{"venue": "מגרש ב"}'), 1, '{"time": "18:30"}'), 2, '{"ifa_game_id": "7000003"}') as p
from t_p;
grant select on t_p2 to authenticated;
create temp table t_c1 as select import_ifa_games(p, true) as r from t_p2;
select pg_temp.check((select (r->>'changed')::int from t_c1) = 3, 'changes: 3 games changed');
select pg_temp.check((select count(*) from ifa_game_updates where notify) = 2, 'changes: venue + time are notified, id assignment is not');
select pg_temp.check((select count(*) from ifa_game_changes c join ifa_game_updates u on u.id = c.update_id
                      where c.field = 'time' and c.old_value = 'שעה טרם נקבעה' and c.new_value = '18:30') = 1,
                     'history: unknown time -> 18:30 with old and new value');
select pg_temp.check((select count(*) from ifa_game_changes where field = 'venue' and old_value = 'מגרש א' and new_value = 'מגרש ב') = 1,
                     'history: venue old and new value');
select pg_temp.check((select significant from ifa_game_updates u join ifa_game_changes c on c.update_id = u.id where c.field = 'venue'),
                     'venue change is significant');
select pg_temp.check((select ifa_game_id from ifa_games where home_ifa_team_id = 9004) = 7000003, 'IFA id attached to the same game');
select pg_temp.check((select count(*) from ifa_games) = 3, 'id assignment: no duplicate game');
select pg_temp.check((select count(*) from notification_outbox where user_id = :U9) = 2, 'queue: U9 gets one notification per real change');
select pg_temp.check((select venue from team_matches where ifa_game = (select id from ifa_games where ifa_game_id = 7000001)) = 'מגרש ב',
                     'app match updated after the change');
select pg_temp.check((select time_confirmed from team_matches where ifa_game = (select id from ifa_games where home_ifa_team_id = 9001 and away_ifa_team_id = 9003)),
                     'app match: time now confirmed');

-- the same changed payload again (e.g. two runs racing): no new updates, no duplicate notifications
create temp table t_c2 as select import_ifa_games(p, true) as r from t_p2;
select pg_temp.check((select (r->>'changed')::int from t_c2) = 0, 're-run after change: nothing changed');
select pg_temp.check((select count(*) from notification_outbox where user_id = :U9) = 2, 're-run after change: no duplicate notifications');

-- a confirmed time falling back to 00:00 is recorded, not notified
create temp table t_p3 as select pg_temp.with_game(p, 1, '{"time": "00:00"}') as p from t_p2;
grant select on t_p3 to authenticated;
select import_ifa_games(p, true) from t_p3;
select pg_temp.check((select not notify from ifa_game_updates where 'time_unset' = any (kinds)), '18:30 -> 00:00 recorded without notification');
select pg_temp.check((select count(*) from notification_outbox where user_id = :U9) = 2, 'no notification for time unset');

-- the parent turned off change notifications: date change recorded, nothing queued for them
insert into notification_prefs (user_id, match_changes) values (:U9, false);
create temp table t_p4 as select pg_temp.with_game(p, 0, '{"date": "2026-11-08"}') as p from t_p3;
grant select on t_p4 to authenticated;
select import_ifa_games(p, true) from t_p4;
select pg_temp.check((select significant and notify from ifa_game_updates where 'date' = any (kinds)), 'date change is significant');
select pg_temp.check((select count(*) from notification_outbox where user_id = :U9) = 2, 'preference off: no notification queued');

-- a result: separate status and score fields; results preference still on
create temp table t_p5 as select pg_temp.with_game(p, 0, '{"status": "played", "result_raw": "2 - 1", "home_score": 2, "away_score": 1}') as p from t_p4;
grant select on t_p5 to authenticated;
select import_ifa_games(p, true) from t_p5;
select pg_temp.check((select count(*) from notification_outbox where user_id = :U9 and kind = 'match_result') = 1, 'result queued as match_result');
select pg_temp.check((select status = 'played' and score_for = 1 and score_against = 2 from team_matches
                      where ifa_game = (select id from ifa_games where ifa_game_id = 7000001)), 'away team sees its own score first');

-- a game missing from the payload is reported, never deleted
create temp table t_p6 as select jsonb_set(p, '{games}', (p->'games') - 1) as p from t_p5;
grant select on t_p6 to authenticated;
create temp table t_m as select import_ifa_games(p, true) as r from t_p6;
select pg_temp.check((select jsonb_array_length(r->'not_in_payload') from t_m) = 1, 'missing game reported');
select pg_temp.check((select count(*) from ifa_games) = 3 and (select count(*) from team_matches where source = 'ifa') = 3, 'missing game kept');

-- the site is down: failure logged, data untouched
select record_ifa_sync_failure('games', 'https://example.invalid/team-games', 'HTTP 403');
select pg_temp.check((select status from ifa_sync_runs order by created_at desc, id limit 1) in ('failed', 'ok', 'partial', 'dry_run'), 'failure run recorded');
select pg_temp.check((select count(*) from ifa_sync_runs where status = 'failed' and errors->0->>'error' = 'HTTP 403') = 1, 'failure has its error');
select pg_temp.check((select count(*) from ifa_games) = 3, 'failure: games untouched');

-- bad rows are rejected one by one
create temp table t_bad as select import_ifa_games(jsonb_set(p, '{games}', (p->'games') || jsonb_build_array(
    jsonb_build_object('ifa_game_id', '-1', 'date', '2027-02-01', 'time', '10:00', 'home_name', 'בלי מזהה', 'away_name', 'קבוצת בדיקה'),
    (p->'games'->1) || '{"date": "2027-03-01"}')), true) as r from t_p5;
select pg_temp.check((select jsonb_array_length(r->'errors') from t_bad) = 2, 'no team ids / same pairing twice: rejected, not guessed');
select pg_temp.check((select status from ifa_sync_runs where id = (select (r->>'run_id')::uuid from t_bad)) = 'partial', 'run with errors marked partial');

-- the club's own match is untouched; IFA fields cannot be edited by hand
select pg_temp.check((select venue = 'מגרש המועדון' and source = 'club' from team_matches where opponent = 'משחק ידידות'), 'club match untouched');
update team_matches set venue = 'ידני', note = 'להביא מים' where ifa_game = (select id from ifa_games where ifa_game_id = 7000001);
select pg_temp.check((select venue = 'מגרש ב' and note = 'להביא מים' from team_matches where ifa_game = (select id from ifa_games where ifa_game_id = 7000001)),
                     'IFA match: official fields kept, note editable');
select pg_temp.fails($$insert into team_matches (team_id, starts_at, opponent, source) select team_id, now(), 'x', 'ifa' from t_team$$, 'adding an IFA match by hand');

-- venue estimate: home team 9001 played at home only at "מגרש בית" -> hint on its home game with no venue
select pg_temp.as_user(null);
create temp table t_vh as select jsonb_build_object('ifa_season_id', 28, 'source_url', 'test:hint', 'games', jsonb_build_array(
  jsonb_build_object('ifa_game_id', '7000010', 'date', '2026-10-01', 'time', '17:00', 'home_ifa_team_id', 9001, 'away_ifa_team_id', 9005,
                     'venue', 'מגרש בית', 'status', 'played', 'result_raw', '1 - 1', 'home_score', 1, 'away_score', 1))) as p;
select import_ifa_games(p, true) from t_vh;
select pg_temp.check((select venue = '' and venue_hint = 'מגרש בית' from team_matches
                      where ifa_game = (select id from ifa_games where home_ifa_team_id = 9001 and away_ifa_team_id = 9003)),
                     'venue estimate from the home team''s usual ground, official venue stays empty');
select pg_temp.check((select venue_hint is null from team_matches where ifa_game = (select id from ifa_games where ifa_game_id = 7000001)),
                     'no estimate when the IFA gives a venue');
select pg_temp.check((select count(*) from ifa_game_updates u join ifa_games g on g.id = u.game_id where g.home_ifa_team_id = 9001 and g.away_ifa_team_id = 9003
                      and 'venue' = any (u.kinds)) = 0, 'estimate is not a change');

-- display name: age category apart from the IFA name
select pg_temp.check(set_ifa_team_category(28, 9001, 'טרום ב׳') = 'טרום ב׳ – קבוצת בדיקה צפון', 'label: category – name');
select pg_temp.check((select name from teams where id = (select team_id from t_team)) = 'טרום ב׳ – קבוצת בדיקה צפון', 'app team shows the label');
select pg_temp.check((select name from ifa_teams where ifa_team_id = 9001) = 'קבוצת בדיקה צפון', 'IFA name kept as is');

-- schedule: every 3 hours, hourly when a game is within 48 hours
select pg_temp.check(not exists (select 1 from ifa_games_due(now()) where ifa_team_id = 9001), 'due: just synced, not due');
select pg_temp.check((select interval_hours from ifa_games_due(now() + interval '4 hours') where ifa_team_id = 9001) = 3, 'due: after 3h');
select pg_temp.check((select interval_hours from ifa_games_due('2026-12-04 12:00+02') where ifa_team_id = 9001) = 1, 'due: hourly 48h before a game');

-- who sees what
select pg_temp.as_user(:U9);
select pg_temp.fails('select import_ifa_games(p, true) from t_p', 'a parent imports games');
select pg_temp.check((select count(*) from ifa_games) = 0, 'a parent cannot read ifa_games');
select pg_temp.check((select count(*) from ifa_game_history((select team_id from t_team))) = 0, 'a parent does not get the staff history');
select pg_temp.check((select count(*) from notification_outbox) = 3, 'a parent reads their own notifications');
select pg_temp.fails($$select claim_notifications(10)$$, 'a parent claims the queue');
-- venue locations: a parent of a team playing there may set it; staff/admin entries win
select pg_temp.fails($$select set_venue_location('מגרש זר', 'רחוב 9')$$, 'a parent sets a venue their team never plays at');
select pg_temp.check(set_venue_location('מגרש בית', 'רחוב ההורים 2') = 'parent', 'a parent sets the venue of their team''s (estimated) game');
select pg_temp.check((select address from venue_locations where name = 'מגרש בית') = 'רחוב ההורים 2', 'members read venue locations');
select pg_temp.as_user(:SA);
select pg_temp.check(set_venue_location('מגרש בית', 'רחוב הבדיקה 1', 32.08, 34.81) = 'admin', 'admin corrects it');
select pg_temp.as_user(:U9);
select pg_temp.fails($$select set_venue_location('מגרש בית', 'רחוב אחר 3')$$, 'a parent overwrites an admin entry');
select pg_temp.as_user(:SA);
select pg_temp.check((select count(*) from venue_location_history where name = 'מגרש בית') = 2, 'venue changes kept in history');
select pg_temp.as_user(:U9);
select pg_temp.as_user(:SA);
select pg_temp.check((select count(*) from ifa_game_history()) >= 5, 'platform admin sees all history');
select pg_temp.check((select count(*) from notification_outbox) = 0, 'admin does not read other users notifications');

-- dispatcher: off by default, then admins only, then all; retries and dedupe
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from claim_notifications(10)) = 0, 'push_mode off: nothing sent');
select set_push_mode('admins');
select pg_temp.check((select count(*) from claim_notifications(10)) = 0, 'push_mode admins: parents not sent');
select set_push_mode('all');
create temp table t_claim as select * from claim_notifications(10);
select pg_temp.check((select count(*) from t_claim) = 3, 'push_mode all: 3 due');
select pg_temp.check((select count(*) from claim_notifications(10)) = 0, 'claimed rows are not handed out twice');
select complete_notification((select id from t_claim order by id limit 1), true);
select complete_notification((select id from t_claim order by id offset 1 limit 1), false, 'push service 503');
select pg_temp.check((select count(*) from notification_outbox where status = 'sent') = 1, 'sent marked');
select pg_temp.check((select status = 'pending' and next_attempt_at > now() and attempts = 1 from notification_outbox where last_error = 'push service 503'),
                     'failed send retried later with backoff');
update notification_outbox set created_at = now() - interval '25 hours' where status = 'sending';
select claim_notifications(10);
select pg_temp.check((select count(*) from notification_outbox where status = 'skipped') = 1, 'stale notification skipped, not sent a day late');
select set_push_mode('off');
