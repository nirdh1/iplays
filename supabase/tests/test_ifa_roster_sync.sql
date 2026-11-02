-- IFA roster sync: dry run, added / missing / returned / renamed, guards, no deletes,
-- parent links and hand-edited names kept. Runs after test_ifa_games.sql.
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
\set PA '''00000000-0000-0000-0000-000000000051'''
insert into auth.users (id, email) values (:PA, 'pa@test') on conflict do nothing;

-- synthetic roster of 8 (made-up names and ids)
create temp table t_base as select jsonb_build_object(
  'ifa_team_id', 9101, 'ifa_season_id', 28, 'team_name', 'קבוצת סנכרון', 'source_url', 'saved:sync-test',
  'players', (select jsonb_agg(jsonb_build_object('ifa_player_id', (610000 + i)::text, 'name', 'שחקן ' || i, 'profile_url', 'u' || i))
              from generate_series(1, 8) i)) as p;
grant select on t_base to authenticated;
select pg_temp.as_user(null);

-- dry run on a new team: everything is "added", nothing is written except the log
create temp table t_d1 as select sync_ifa_roster(p, false) as r from t_base;
select pg_temp.check((select (r->>'ok')::boolean and not (r->>'applied')::boolean from t_d1), 'dry run: ok, not applied');
select pg_temp.check((select (r->'summary'->>'added')::int from t_d1) = 8, 'dry run: 8 added');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9101) = 0, 'dry run: no roster rows written');
select pg_temp.check((select count(*) from ifa_players where ifa_player_id between 610001 and 610008) = 0, 'dry run: no players written');
select pg_temp.check((select status from ifa_sync_runs where id = (select (r->>'run_id')::uuid from t_d1)) = 'dry_run', 'dry run: logged as dry_run');

-- apply
create temp table t_a1 as select sync_ifa_roster(p, true) as r from t_base;
select pg_temp.check((select (r->>'applied')::boolean from t_a1), 'apply: applied');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9101 and status = 'active') = 8, 'apply: 8 active roster rows');
select pg_temp.check((select count(*) from ifa_roster_changes where ifa_team_id = 9101 and kind = 'added') = 8, 'apply: 8 "added" changes logged');
select pg_temp.check((select kind || '/' || status from ifa_sync_runs where id = (select (r->>'run_id')::uuid from t_a1)) = 'roster/ok', 'apply: one run, kind roster, status ok');

-- same page again: no changes, no duplicates
create temp table t_a2 as select sync_ifa_roster(p, true) as r from t_base;
select pg_temp.check((select r->'summary' @> '{"added":0,"missing":0,"returned":0,"renamed":0}' from t_a2), 'again: no changes');
select pg_temp.check((select count(*) from ifa_players where ifa_player_id between 610001 and 610008) = 8, 'again: no duplicate players');
select pg_temp.check((select count(*) from ifa_roster_changes where ifa_team_id = 9101) = 8, 'again: no new change rows');

-- a parent claims player 1 and edits the name in the app
insert into player_guardians (player_id, user_id, relation)
select player_id, :PA, 'parent' from ifa_players where ifa_player_id = 610001;
update players set first_name = 'שם שההורה ערך' where id = (select player_id from ifa_players where ifa_player_id = 610001);

-- player 1 leaves, player 2 is renamed on the site, player 9 joins
create temp table t_p2 as select jsonb_set(p, '{players}',
  (select jsonb_agg(case when e->>'ifa_player_id' = '610002' then jsonb_set(e, '{name}', '"שחקן שתיים"') else e end)
   from jsonb_array_elements(p->'players') e where e->>'ifa_player_id' <> '610001')
  || '[{"ifa_player_id":"610009","name":"שחקן 9","profile_url":"u9"}]'::jsonb) as p from t_base;
create temp table t_d2 as select sync_ifa_roster(p, false) as r from t_p2;
select pg_temp.check((select r->'summary' @> '{"added":1,"missing":1,"returned":0,"renamed":1}' from t_d2), 'dry run: 1 added, 1 missing, 1 renamed');
select pg_temp.check((select r->'missing'->0->>'ifa_player_id' from t_d2) = '610001', 'dry run: the missing player is named');
select pg_temp.check((select status from ifa_rosters where ifa_team_id = 9101 and ifa_player_id = 610001) = 'active', 'dry run: status unchanged');

create temp table t_a3 as select sync_ifa_roster(p, true) as r from t_p2;
select pg_temp.check((select status from ifa_rosters where ifa_team_id = 9101 and ifa_player_id = 610001) = 'missing', 'apply: player 1 marked missing');
select pg_temp.check((select missing_since is not null from ifa_rosters where ifa_team_id = 9101 and ifa_player_id = 610001), 'apply: missing_since set');
select pg_temp.check((select count(*) from players where id = (select player_id from ifa_players where ifa_player_id = 610001)) = 1, 'apply: missing player not deleted');
select pg_temp.check((select count(*) from player_guardians where user_id = :PA) = 1, 'apply: parent link kept');
select pg_temp.check((select first_name from players where id = (select player_id from ifa_players where ifa_player_id = 610001)) = 'שם שההורה ערך',
                     'apply: name edited in the app kept');
select pg_temp.check((select name from ifa_players where ifa_player_id = 610002) = 'שחקן שתיים', 'apply: IFA name updated in ifa_players');
select pg_temp.check((select first_name from players where id = (select player_id from ifa_players where ifa_player_id = 610002)) = 'שחקן 2',
                     'apply: app player name not overwritten by the rename');
select pg_temp.check((select old_value || '>' || new_value from ifa_roster_changes where ifa_player_id = 610002 and kind = 'renamed') = 'שחקן 2>שחקן שתיים',
                     'apply: rename logged old > new');
select pg_temp.check((select count(*) from ifa_roster_changes where ifa_player_id = 610001 and kind = 'missing') = 1, 'apply: "missing" logged');

-- player 1 comes back
create temp table t_a4 as select sync_ifa_roster(jsonb_set(p, '{players}', (p->'players') || (select (b.p->'players')->0 from t_base b)), true) as r from t_p2;
select pg_temp.check((select (r->'summary'->>'returned')::int from t_a4) = 1, 'return: 1 returned');
select pg_temp.check((select status || coalesce(missing_since::text, '') from ifa_rosters where ifa_team_id = 9101 and ifa_player_id = 610001) = 'active', 'return: active again');
select pg_temp.check((select count(*) from ifa_players where ifa_player_id = 610001) = 1, 'return: same IFA player, no duplicate');

-- guards: empty roster, sudden drop, bad ids, duplicate ids -> failed run, nothing changed
create temp table t_before as select count(*) as n, count(*) filter (where status = 'active') as a from ifa_rosters where ifa_team_id = 9101;
create temp table t_g1 as select sync_ifa_roster(jsonb_set(p, '{players}', '[]'), true) as r from t_base;
select pg_temp.check((select not (r->>'ok')::boolean and r->>'error' like 'empty roster%' from t_g1), 'guard: empty roster refused');
select pg_temp.check((select status from ifa_sync_runs where id = (select (r->>'run_id')::uuid from t_g1)) = 'failed', 'guard: logged as failed');
create temp table t_g2 as select sync_ifa_roster(jsonb_set(p, '{players}', jsonb_build_array((p->'players')->0, (p->'players')->1)), true) as r from t_base;
select pg_temp.check((select not (r->>'ok')::boolean and r->>'error' like 'roster dropped from 9 to 2%' from t_g2), 'guard: drop from 9 to 2 refused');
create temp table t_g3 as select sync_ifa_roster(jsonb_set(p, '{players}', (p->'players') || '[{"ifa_player_id":"x1","name":"בלי מזהה"}]'), true) as r from t_base;
select pg_temp.check((select not (r->>'ok')::boolean from t_g3), 'guard: non-numeric id refused');
create temp table t_g4 as select sync_ifa_roster(jsonb_set(p, '{players}', (p->'players') || jsonb_build_array((p->'players')->0)), true) as r from t_base;
select pg_temp.check((select not (r->>'ok')::boolean and r->>'error' like 'the same ifa_player_id%' from t_g4), 'guard: duplicate id refused');
select pg_temp.check((select n = (select count(*) from ifa_rosters where ifa_team_id = 9101)
                         and a = (select count(*) from ifa_rosters where ifa_team_id = 9101 and status = 'active') from t_before),
                     'guard: rosters unchanged after every refusal');
-- a checked drop goes through
create temp table t_g5 as select sync_ifa_roster(jsonb_set(p, '{players}', jsonb_build_array((p->'players')->0, (p->'players')->1)) || '{"allow_large_drop":true}', true) as r from t_base;
select pg_temp.check((select (r->>'ok')::boolean and (r->'summary'->>'missing')::int = 7 from t_g5), 'guard: allow_large_drop applies after review');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9101) = 9, 'allowed drop: still no rows deleted');

-- who may sync / read
select pg_temp.as_user(:U9);
select pg_temp.fails('select sync_ifa_roster(p, false) from t_base', 'a regular user syncs');
select pg_temp.check((select count(*) from ifa_roster_changes) = 0, 'a regular user cannot read the change log');
select pg_temp.as_user(:SA);
select pg_temp.check((select (sync_ifa_roster(p, false)->>'ok')::boolean from t_base), 'platform admin runs a dry run');
select pg_temp.check((select count(*) from ifa_roster_changes where ifa_team_id = 9101) > 0, 'platform admin reads the change log');
select pg_temp.as_user(null);
