-- IFA import: upsert by ifa ids, idempotent, errors logged, privacy of imported minors. Runs after test_team_claims.sql.
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
\set P1 '''00000000-0000-0000-0000-000000000021'''
\set U9 '''00000000-0000-0000-0000-000000000041'''
insert into auth.users (id, email) values (:U9, 'u9@test');

-- synthetic payload (made-up names and ids)
create temp table t_payload as select '{"ifa_team_id": 9001, "ifa_season_id": 28, "team_name": "קבוצת בדיקה צפון",
  "source_url": "saved:test", "players": [
   {"ifa_player_id": "500001", "name": "אלף בדיקה", "profile_url": "u1"},
   {"ifa_player_id": "500002", "name": "בית רפאל בדיקה", "profile_url": "u2"},
   {"ifa_player_id": "500003", "name": "גימל בדיקה", "profile_url": "u3"},
   {"ifa_player_id": "", "name": "בלי מזהה", "profile_url": "u4"}]}'::jsonb as p;
grant select on t_payload to authenticated;

-- from the SQL Editor (no signed-in user)
select pg_temp.as_user(null);
create temp table t_r1 as select import_ifa_team(p) as r from t_payload;
select pg_temp.check((select (r->>'new_players')::int from t_r1) = 3, 'import: 3 new players');
select pg_temp.check((select jsonb_array_length(r->'errors') from t_r1) = 1, 'import: player without id logged as error, skipped');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9001) = 3, 'import: roster rows per team + season');
select pg_temp.check((select count(*) from player_assignments a join ifa_players i on i.player_id = a.player_id
                      where i.ifa_player_id between 500001 and 500003 and a.ended_on is null) = 3, 'import: players assigned to the team');
select pg_temp.check((select first_name from players p join ifa_players i on i.player_id = p.id where i.ifa_player_id = 500002) = 'בית רפאל בדיקה',
                     'import: full name kept as on the page, not split');
select pg_temp.check((select birth_year from players p join ifa_players i on i.player_id = p.id where i.ifa_player_id = 500002) is null,
                     'import: no birth year guessed');
select pg_temp.check(not team_has_staff((select team_id from ifa_teams where ifa_team_id = 9001)), 'import: team has no staff');

-- idempotent
create temp table t_r2 as select import_ifa_team(p) as r from t_payload;
select pg_temp.check((select (r->>'new_players')::int from t_r2) = 0 and (select (r->>'new_team')::boolean from t_r2) = false, 'import again: nothing new');
select pg_temp.check((select count(*) from ifa_players where ifa_player_id between 500001 and 500003) = 3, 'import again: no duplicates');

-- a player missing from a later payload is kept and reported
create temp table t_r3 as select import_ifa_team(jsonb_set(p, '{players}', (p->'players') - 2)) as r from t_payload;
select pg_temp.check((select r->'not_in_payload' from t_r3) = '[500003]'::jsonb, 'missing player reported');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9001) = 3, 'missing player not removed');
select pg_temp.check((select count(*) from ifa_sync_runs where counts->>'ifa_team_id' = '9001') = 3, 'every run logged');

-- who may import / read
select pg_temp.as_user(:U9);
select pg_temp.fails('select import_ifa_team(p) from t_payload', 'a regular user imports');
select pg_temp.check((select count(*) from ifa_players) = 0, 'a regular user cannot read ifa tables');
select pg_temp.check((select count(*) from ifa_sync_overview()) = 0, 'a regular user gets no sync overview');
select pg_temp.as_user(:SA);
select pg_temp.check((select (import_ifa_team(p)->>'players_seen')::int from t_payload) = 3, 'platform admin imports');
select pg_temp.check((select players from ifa_sync_overview() where ifa_team_id = 9001) = 3, 'platform admin sees last sync per team');

-- privacy of imported minors
select pg_temp.as_user(:U9);
select pg_temp.check((select count(*) from search_players('בדיקה')) = 0, 'open search hides imported children with no parent');
select pg_temp.as_user(null);
create temp table t_team as select team_id from ifa_teams where ifa_team_id = 9001;
create temp table t_kid as select player_id from ifa_players where ifa_player_id = 500002;
grant select on t_team, t_kid to authenticated;
select pg_temp.as_user(:U9);
select pg_temp.check((select first_name || ' ' || last_name from team_roster_public((select team_id from t_team))
                      where player_id = (select player_id from t_kid)) = 'בית ר׳', 'team page: outsider sees first name + initial');
-- the parent claims the child (no staff: approved right away), then sees the full name
select request_join((select team_id from t_team), (select player_id from t_kid), '', '', null, '', 'parent', true);
select pg_temp.check(is_player_parent((select player_id from t_kid)), 'parent claimed the imported child');
select pg_temp.check((select first_name from team_roster_public((select team_id from t_team))
                      where player_id = (select player_id from t_kid)) = 'בית רפאל בדיקה', 'member sees the full name');
select pg_temp.as_user(:P1);
select pg_temp.check((select count(*) from search_players('בית רפאל')) = 1, 'claimed child appears in the open search');
select pg_temp.check((select count(*) from search_players('אלף בדיקה')) = 0, 'unclaimed sibling still hidden');
select pg_temp.as_user(null);
