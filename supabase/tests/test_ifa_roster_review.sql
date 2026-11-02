-- IFA roster review: a newer roster page creates pending rows only; team staff
-- accept or keep; "keep" is not asked again; others cannot see or decide.
-- Runs after test_team_ifa_link.sql (inbox notifications not installed yet).
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

\set CO '''00000000-0000-0000-0000-000000000061'''
\set OT '''00000000-0000-0000-0000-000000000062'''
insert into auth.users (id, email) values (:CO, 'coach-review@test'), (:OT, 'other-review@test') on conflict do nothing;

-- synthetic roster of 8 (made-up names and ids)
create temp table t_rb as select jsonb_build_object(
  'ifa_team_id', 9301, 'ifa_season_id', 28, 'team_name', 'קבוצת סקירה', 'source_url', 'saved:review-test',
  'players', (select jsonb_agg(jsonb_build_object('ifa_player_id', (630000 + i)::text, 'name', 'ילד ' || i, 'profile_url', 'r' || i))
              from generate_series(1, 8) i)) as p;
grant select on t_rb to anon, authenticated;
select pg_temp.as_user(null);

-- propose before the first import is refused
create temp table t_r0 as select propose_ifa_roster(p) as r from t_rb;
select pg_temp.check((select not (r->>'ok')::boolean and r->>'error' like 'team not imported yet%' from t_r0), 'propose: refused before first import');

-- first import (as before), then the coach claims the team
select sync_ifa_roster(p, true) from t_rb;
create temp table t_team as select team_id from ifa_teams where ifa_team_id = 9301;
grant select on t_team to anon, authenticated;
insert into team_members (team_id, user_id, role) select team_id, :CO, 'admin' from t_team;
select pg_temp.check((select count(*) from player_assignments pa join t_team t on pa.team_id = t.team_id where pa.ended_on is null) = 8, 'import: 8 players in the team');

-- newer page: 1 leaves, 2 renamed, 9 joins
create temp table t_r2 as select jsonb_set(p, '{players}',
  (select jsonb_agg(case when e->>'ifa_player_id' = '630002' then jsonb_set(e, '{name}', '"ילד שתיים"') else e end)
   from jsonb_array_elements(p->'players') e where e->>'ifa_player_id' <> '630001')
  || '[{"ifa_player_id":"630009","name":"ילד 9","profile_url":"r9"}]'::jsonb) as p from t_rb;
grant select on t_r2 to anon, authenticated;
create temp table t_p1 as select propose_ifa_roster(p) as r from t_r2;
select pg_temp.check((select (r->>'ok')::boolean and (r->>'new_pending')::int = 3 from t_p1), 'propose: 3 pending rows');
select pg_temp.check((select count(*) from player_assignments pa join t_team t on pa.team_id = t.team_id where pa.ended_on is null) = 8, 'propose: team unchanged (8 players)');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9301 and status = 'active') = 8, 'propose: IFA roster unchanged');
select pg_temp.check((select count(*) from ifa_players where ifa_player_id = 630009) = 0, 'propose: new player not created yet');

-- same page again: no duplicates
create temp table t_p2 as select propose_ifa_roster(p) as r from t_r2;
select pg_temp.check((select (r->>'new_pending')::int = 0 and (r->>'pending_total')::int = 3 from t_p2), 'propose again: no duplicate rows');

-- who sees it
create temp table t_all as select array_agg(id) as a from ifa_roster_review where ifa_team_id = 9301;
grant select on t_all to anon, authenticated;
select pg_temp.as_user(:OT);
select pg_temp.check((select count(*) from ifa_roster_review where ifa_team_id = 9301) = 0, 'other user: cannot read pending rows');
select pg_temp.check((select count(*) from my_roster_review_counts()) = 0, 'other user: no counter');
select pg_temp.fails($$select * from team_roster_review((select team_id from t_team))$$, 'other user lists the review');
select pg_temp.fails($$select decide_ifa_roster_changes((select a from t_all), true)$$, 'other user decides');
select pg_temp.fails($$select propose_ifa_roster(p) from t_r2$$, 'other user proposes');
select pg_temp.as_anon();
select pg_temp.fails($$select propose_ifa_roster(p) from t_r2$$, 'anon proposes without a key');
select pg_temp.fails($$select agent_propose_ifa_roster('wrong-key', p) from t_r2$$, 'anon proposes with a wrong agent key');

select pg_temp.as_user(:CO);
select pg_temp.check((select pending from my_roster_review_counts()) = 3, 'coach: counter shows 3');
select pg_temp.check((select count(*) from team_roster_review((select team_id from t_team))) = 3, 'coach: lists 3 rows');
select pg_temp.check((select string_agg(kind, ',' order by kind) from team_roster_review((select team_id from t_team))) = 'added,missing,renamed', 'coach: added, missing, renamed');

-- accept the new player and the rename, keep the missing player
create temp table t_ids as select kind, id from team_roster_review((select team_id from t_team));
select decide_ifa_roster_changes((select array_agg(id) from t_ids where kind in ('added', 'renamed')), true);
select decide_ifa_roster_changes((select array_agg(id) from t_ids where kind = 'missing'), false);
select pg_temp.check((select count(*) from my_roster_review_counts()) = 0, 'coach: counter cleared');
select pg_temp.check((select count(*) from player_assignments pa join t_team t on pa.team_id = t.team_id where pa.ended_on is null) = 9, 'accept: player 9 added (9 active), player 1 kept');
select pg_temp.as_user(null);
select pg_temp.check((select first_name from players where id = (select player_id from ifa_players where ifa_player_id = 630002)) = 'ילד שתיים', 'accept rename: untouched app name follows the page');
select pg_temp.check((select status from ifa_rosters where ifa_team_id = 9301 and ifa_player_id = 630001) = 'active', 'keep: IFA roster row stays active');
select pg_temp.check((select count(*) filter (where kind = 'added') = 9 and count(*) filter (where kind = 'renamed') = 1 from ifa_roster_changes where ifa_team_id = 9301), 'accept: added + renamed logged (8 from the import + 1, and 1)');

-- the same page again: the kept difference is not asked again
create temp table t_p3 as select propose_ifa_roster(p) as r from t_r2;
select pg_temp.check((select (r->>'new_pending')::int = 0 and (r->>'pending_total')::int = 0 and (r->>'kept_quiet')::int = 1 from t_p3), 'keep: not asked again');

-- a later page that drops player 3: asked; accept ends the assignment, keeps the player
create temp table t_r4 as select jsonb_set(p, '{players}', (select jsonb_agg(e) from jsonb_array_elements(p->'players') e where e->>'ifa_player_id' <> '630003')) as p from t_r2;
grant select on t_r4 to anon, authenticated;
-- the Mac agent proposes with its key
select pg_temp.as_user('00000000-0000-0000-0000-000000000033'); -- platform admin from the earlier tests
create temp table t_key as select create_ifa_agent_key('review test') as k;
select pg_temp.as_user(null);
grant select on t_key to anon, authenticated;
select pg_temp.as_anon();
create temp table t_p4 as select agent_propose_ifa_roster((select k from t_key), p) as r from t_r4;
select pg_temp.as_user(null);
select pg_temp.check((select (r->>'ok')::boolean and (r->>'new_pending')::int = 1 from t_p4), 'agent: 1 pending row (player 3 missing)');
select pg_temp.as_user(:CO);
select decide_ifa_roster_changes((select array_agg(id) from team_roster_review((select team_id from t_team))), true);
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from player_assignments pa join t_team t on pa.team_id = t.team_id where pa.ended_on is null) = 8, 'accept missing: assignment ended (8 active)');
select pg_temp.check((select count(*) from players where id = (select player_id from ifa_players where ifa_player_id = 630003)) = 1, 'accept missing: player kept');
select pg_temp.check((select status from ifa_rosters where ifa_team_id = 9301 and ifa_player_id = 630003) = 'missing', 'accept missing: IFA roster row marked missing');
-- player 1 is shown again on a page: the old "keep" closes
create temp table t_p5 as select propose_ifa_roster(p) as r from t_rb;
select pg_temp.check((select status from ifa_roster_review where ifa_team_id = 9301 and ifa_player_id = 630001 and kind = 'missing' order by id desc limit 1) = 'superseded', 'keep closes once the page shows the player again');
select pg_temp.as_user(null);
