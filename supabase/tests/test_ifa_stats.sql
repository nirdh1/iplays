-- IFA numbers loaded from a file: parent saves per season (re-upload updates), outsider cannot, links.
-- Runs after test_self_stats.sql (uses its team, parent and child).
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

\set COACH '''00000000-0000-0000-0000-0000000002c0'''
\set PAR '''00000000-0000-0000-0000-0000000002a1'''
\set OTH '''00000000-0000-0000-0000-0000000002a2'''
\set OUT '''00000000-0000-0000-0000-0000000002ff'''
\set T '''10000000-0000-0000-0000-0000000002e0'''
\set KID '''30000000-0000-0000-0000-0000000002e1'''

select pg_temp.as_user(null);
insert into ifa_teams (ifa_season_id, ifa_team_id, name, team_id) values (28, 99501, 'קבוצת דיווח', :T) on conflict do nothing;
insert into ifa_players (ifa_player_id, name, player_id, profile_url) values (99501001, 'נועם בר', :KID, 'https://www.football.org.il/players/player/?player_id=99501001&season_id=28');

select pg_temp.as_user(:PAR);
select pg_temp.check(player_ifa_links(:KID) ->> 'player_url' like '%player_id=99501001%', 'parent gets the child''s IFA player page');
select pg_temp.check(player_ifa_links(:KID) ->> 'team_url' like '%team_id=99501&season_id=28', 'and the team page');
select pg_temp.check((player_ifa_links(:KID) ->> 'can_edit')::boolean, 'parent can load numbers');
select save_ifa_stats(:KID, '2026/27', 'קבוצת דיווח', '{"games": 8, "goals": 5, "yellow": 1, "minutes": 420}', 'player.png');
select save_ifa_stats(:KID, '2026/27', 'קבוצת דיווח', '{"games": 9, "goals": 6, "yellow": 1}', 'player2.png');
select pg_temp.check((select count(*) from player_ifa_stats where player_id = :KID) = 1, 're-upload of the same season updates the row');
select pg_temp.check((select goals from player_ifa_stats where player_id = :KID) = 6 and (select minutes from player_ifa_stats where player_id = :KID) is null, 'numbers replaced by the new file');
select pg_temp.check((select count(*) from player_self_stats where player_id = :KID and deleted_at is null) >= 1, 'self-reported rows untouched');
select pg_temp.fails(format('select save_ifa_stats(%L, %L, %L, %L, %L)', :KID, '2026', '', '{}', ''), 'bad season label');
select pg_temp.fails(format('select save_ifa_stats(%L, %L, %L, %L, %L)', :KID, '2026/27', '', '{"goals": "x"}', ''), 'non-number');

select pg_temp.as_user(:OTH);
select pg_temp.check((select count(*) from player_ifa_stats where player_id = :KID) = 0, 'another parent does not see them');
select pg_temp.fails(format('select save_ifa_stats(%L, %L, %L, %L, %L)', :KID, '2026/27', '', '{}', ''), 'another parent saving');
select pg_temp.as_user(:OUT);
select pg_temp.fails(format('select player_ifa_links(%L)', :KID), 'outsider asking for links');

select pg_temp.as_user(:PAR);
select remove_ifa_stats((select id from player_ifa_stats where player_id = :KID));
select pg_temp.check((select count(*) from player_ifa_stats where player_id = :KID) = 0, 'parent removes a season');
select pg_temp.as_user(null);
