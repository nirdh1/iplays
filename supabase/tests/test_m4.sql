-- M4: matches, lineups, attendance. Runs after test_search.sql (uses its data).
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

\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set E '''00000000-0000-0000-0000-00000000000e'''
\set G '''00000000-0000-0000-0000-000000000011'''
\set T1 '''10000000-0000-0000-0000-000000000001'''
\set T3 '''10000000-0000-0000-0000-000000000003'''

select id as ron from players where first_name = 'רון' \gset
select id as tamar from players where first_name = 'תמר' \gset
select id as shira from players where first_name = 'שירה' \gset
-- the players joined T1 a month ago (the summary counts events from the day a player joined)
update player_assignments set started_on = current_date - 30 where team_id = :T1 and ended_on is null;

-- --------------------------------------------------------------- matches
select pg_temp.as_user(:A);
insert into team_matches (team_id, starts_at, opponent, home, venue)
values (:T1, now() + interval '2 days', 'הפועל מזרח', true, 'מגרש העירוני');
select pg_temp.check((select lineup_size from team_matches where opponent = 'הפועל מזרח') = 7, 'football match: lineup of 7 by default');
insert into team_matches (team_id, starts_at, opponent, home) values (:T1, now() - interval '1 day', 'בני צפון', false);
select pg_temp.as_user(null);
select id as m1 from team_matches where opponent = 'הפועל מזרח' \gset
select id as mpast from team_matches where opponent = 'בני צפון' \gset

select pg_temp.as_user(:C);
select pg_temp.check((select count(*) from team_matches where team_id = :T1) = 2, 'parent sees the team''s matches');
select pg_temp.fails(format('insert into team_matches (team_id, starts_at, opponent) values (%L, now(), %L)', :T1, 'x'), 'parent adding a match');
update team_matches set score_for = 9 where id = :'m1';
select pg_temp.as_user(null);
select pg_temp.check((select score_for from team_matches where id = :'m1') is null, 'parent cannot change a match');

select pg_temp.as_user(:E);
select pg_temp.check((select count(*) from team_matches) = 0, 'outsider sees no matches');
select pg_temp.as_user(null);

select pg_temp.as_user(:A);
update team_matches set score_for = 3, score_against = 1, status = 'played', team_id = :T3 where id = :'mpast';
select pg_temp.as_user(null);
select pg_temp.check((select team_id from team_matches where id = :'mpast') = :T1, 'a match cannot move to another team');
select pg_temp.check((select score_for from team_matches where id = :'mpast') = 3, 'staff record the score');

-- basketball: 5
update teams set sport = 'basketball' where id = :T3;
select pg_temp.as_user(:B);
insert into team_matches (team_id, starts_at, opponent) values (:T3, now() + interval '3 days', 'מכבי סל');
select pg_temp.check((select lineup_size from team_matches where opponent = 'מכבי סל') = 5, 'basketball match: lineup of 5');
select pg_temp.fails(format('select add_lineup(%L)', :'m1'), 'another club building a lineup');
select pg_temp.as_user(null);

update teams set sport = 'other' where id = '10000000-0000-0000-0000-000000000004';
insert into team_matches (team_id, starts_at, opponent) values ('10000000-0000-0000-0000-000000000004', now(), 'תחרות');
select pg_temp.check((select lineup_size from team_matches where opponent = 'תחרות') is null, 'other sport: no lineup');

-- --------------------------------------------------------------- lineups
select pg_temp.as_user(:A);
select add_lineup(:'m1') as la \gset
select add_lineup(:'m1') as lb \gset
select pg_temp.check((select string_agg(label, ',' order by sort) from match_lineups where match_id = :'m1') = 'הרכב א,הרכב ב', 'two lineups: א and ב');
select save_lineup(:'la', jsonb_build_array(
  jsonb_build_object('player_id', :'ron', 'slot', 1, 'position', 'שוער'),
  jsonb_build_object('player_id', :'tamar', 'slot', 2)));
select save_lineup(:'lb', jsonb_build_array(jsonb_build_object('player_id', :'shira', 'slot', 1)));
select pg_temp.check((select count(*) from match_lineup_players where match_id = :'m1') = 3, 'lineups saved');
select pg_temp.fails(format('select save_lineup(%L, %L::jsonb)', :'lb', jsonb_build_array(jsonb_build_object('player_id', :'ron'))), 'same player in two lineups of one match');
select pg_temp.fails(format('select save_lineup(%L, %L::jsonb)', :'lb', jsonb_build_array(jsonb_build_object('player_id', :'shira', 'slot', 8))), 'slot beyond 7');
select save_lineup(:'la', jsonb_build_array(
  jsonb_build_object('player_id', :'ron', 'slot', 1, 'position', 'שוער'),
  jsonb_build_object('player_id', :'tamar', 'slot', 2)), 'הרכב כחול');
select pg_temp.check((select label from match_lineups where id = :'la') = 'הרכב כחול', 'lineup renamed');
select pg_temp.as_user(null);

select pg_temp.as_user(:G);
select pg_temp.check((select count(*) from match_lineups where match_id = :'m1') = 0, 'parents do not see unpublished lineups');
select pg_temp.fails(format('select save_lineup(%L, %L::jsonb)', :'la', '[]'), 'parent editing a lineup');
select pg_temp.as_user(null);

select pg_temp.as_user(:A);
select publish_lineup(:'la');
select pg_temp.fails(format('select remove_lineup(%L)', :'la'), 'removing a published lineup');
select pg_temp.as_user(null);

select pg_temp.as_user(:G);
select pg_temp.check((select count(*) from match_lineups where match_id = :'m1') = 1, 'parents see the published lineup');
select pg_temp.check((select count(*) from match_lineup_players where lineup_id = :'la') = 2, 'parents see who is in it');
select pg_temp.as_user(null);

-- ------------------------------------------------------------ attendance
-- the parent reports Ron absent on the match day
select pg_temp.as_user(:G);
insert into player_absences (player_id, from_date, to_date, reason, reported_by)
select :'ron', d, d, 'family_event', :G from (select ((starts_at at time zone 'Asia/Jerusalem')::date) d from team_matches where id = :'m1') x;
select pg_temp.check((select count(*) from event_attendance('match', :'m1')) = 0, 'parents do not get the attendance sheet');
select pg_temp.fails(format('select mark_attendance(%L, %L, %L, %L)', 'match', :'m1', :'shira', 'absent'), 'parent marking attendance');
select pg_temp.as_user(null);

select pg_temp.as_user(:A);
select pg_temp.check((select expected from event_attendance('match', :'m1') where player_id = :'ron') = 'absent', 'parent''s report shows as expected absence');
select pg_temp.check((select effective from event_attendance('match', :'m1') where player_id = :'shira') = 'coming', 'no report: presumed coming');
select mark_attendance('match', :'m1', :'shira', 'late', 10);
select pg_temp.check((select effective || ':' || minutes_late from event_attendance('match', :'m1') where player_id = :'shira') = 'late:10', 'staff mark late with minutes');
select mark_attendance('match', :'m1', :'shira', null);
select pg_temp.check((select status from event_attendance('match', :'m1') where player_id = :'shira') is null, 'clearing a mark returns to default');
select mark_attendance('match', :'mpast', :'shira', 'absent');
select mark_attendance('match', :'mpast', :'ron', 'present');
select pg_temp.check((select absent from team_attendance_summary(:T1, current_date - 7, current_date) where player_id = :'shira') = 1, 'summary counts a marked absence');
select pg_temp.check((select present from team_attendance_summary(:T1, current_date - 7, current_date) where player_id = :'tamar') >= 1, 'summary presumes presence without a mark');
select pg_temp.as_user(null);

select pg_temp.as_user(:G);
select pg_temp.check((select count(*) from attendance_records) = 1, 'parent sees only own child''s marks');
select pg_temp.check((select count(*) from team_attendance_summary(:T1, current_date - 7, current_date)) = 0, 'parents do not get the team summary');
select pg_temp.as_user(null);

select pg_temp.as_user(:A);
select publish_lineup(:'la', false);
select remove_lineup(:'lb');
select pg_temp.check((select count(*) from match_lineups where match_id = :'m1') = 1, 'unpublished lineup removed');
select pg_temp.as_user(null);
