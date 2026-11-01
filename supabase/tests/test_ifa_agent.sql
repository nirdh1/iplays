-- IFA local agent: request queue, agent key, dry run on submit, import only by a platform admin.
-- Runs after test_ifa_roster_sync.sql.
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

\set SA '''00000000-0000-0000-0000-000000000033'''
\set U9 '''00000000-0000-0000-0000-000000000041'''

create temp table t_k (k text, other text);
grant all on t_k to anon, authenticated;
create temp table t_req (id uuid);
grant all on t_req to anon, authenticated;
-- synthetic roster (made-up names and ids)
create temp table t_pl as select jsonb_build_object(
  'ifa_team_id', 9201, 'ifa_season_id', 28, 'team_name', 'קבוצת סוכן', 'source_url', 'local-agent:test',
  'players', (select jsonb_agg(jsonb_build_object('ifa_player_id', (620000 + i)::text, 'name', 'סוכן ' || i, 'profile_url', 'u' || i))
              from generate_series(1, 7) i)) as p;
grant select on t_pl to anon, authenticated;

-- keys: only a platform admin creates one; the hash is not readable
select pg_temp.as_user(:U9);
select pg_temp.fails($$select create_ifa_agent_key('x')$$, 'a regular user creates an agent key');
select pg_temp.fails($$select request_ifa_sync(9201, 28)$$, 'a regular user requests a sync');
select pg_temp.as_user(:SA);
insert into t_k select create_ifa_agent_key('Mac של בדיקה'), create_ifa_agent_key('second');
select pg_temp.check((select k like 'ifa_%' and length(k) = 52 from t_k), 'key returned once, random 24 bytes');
select pg_temp.check((select count(*) from ifa_agent_keys where name = 'Mac של בדיקה') = 1, 'admin sees the key row');
select pg_temp.fails($$select key_hash from ifa_agent_keys$$, 'admin reads the key hash');

-- "הרץ בדיקה"
insert into t_req select request_ifa_sync(9201, 28);
select pg_temp.check((select request_ifa_sync(9201, 28) from t_req) = (select id from t_req), 'second click returns the same open request');
select pg_temp.check((select status from ifa_sync_requests where id = (select id from t_req)) = 'pending', 'request pending');

-- agent with a wrong key
select pg_temp.as_anon();
select pg_temp.fails($$select * from agent_claim_ifa_requests('ifa_wrong', 5)$$, 'claim with a wrong key');
select pg_temp.fails($$select * from ifa_sync_requests$$, 'anon reads the request table');
select pg_temp.fails($$select request_ifa_sync(1, 28)$$, 'anon requests a sync');
select pg_temp.fails($$select sync_ifa_roster(p, true) from t_pl$$, 'anon calls sync_ifa_roster directly');

-- agent claims, then cannot import
select pg_temp.check((select count(*) from agent_claim_ifa_requests((select k from t_k), 5)) = 1, 'agent claims the request');
select pg_temp.check((select count(*) from agent_claim_ifa_requests((select k from t_k), 5)) = 0, 'nothing left to claim');
select pg_temp.fails($$select agent_submit_ifa_roster((select other from t_k), (select id from t_req), (select p from t_pl))$$,
                     'another agent submits for a request it did not claim');
select pg_temp.fails($$select agent_submit_ifa_roster((select k from t_k), (select id from t_req), jsonb_set((select p from t_pl), '{ifa_team_id}', '9999'))$$,
                     'agent submits a payload for another team');
create temp table t_sub as select agent_submit_ifa_roster((select k from t_k), (select id from t_req), (select p from t_pl), '{"http_status":200}') as r;
grant select on t_sub to anon, authenticated;
select pg_temp.check((select (r->>'ok')::boolean and not (r->>'applied')::boolean and (r->'summary'->>'added')::int = 7 from t_sub), 'submit runs a dry run: 7 added');
select pg_temp.fails($$select apply_ifa_request((select id from t_req))$$, 'agent applies the request');

select pg_temp.as_user(null);
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9201) = 0, 'nothing imported by the agent');
select pg_temp.check((select status || '/' || (fetch_info->>'http_status') from ifa_sync_requests where id = (select id from t_req)) = 'checked/200', 'request checked, fetch info kept');

-- the admin imports
select pg_temp.as_user(:U9);
select pg_temp.fails($$select apply_ifa_request((select id from t_req))$$, 'a regular user applies');
select pg_temp.as_user(:SA);
select pg_temp.check((select (apply_ifa_request(id)->>'applied')::boolean from t_req), 'admin applies the checked request');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9201 and status = 'active') = 7, 'roster imported: 7 active');
select pg_temp.check((select status from ifa_sync_requests where id = (select id from t_req)) = 'applied', 'request applied');
select pg_temp.fails($$select apply_ifa_request((select id from t_req))$$, 'apply twice');

-- a blocked page: the agent reports and nothing changes
delete from t_req;
insert into t_req select request_ifa_sync(9201, 28);
select pg_temp.as_anon();
select pg_temp.check((select count(*) from agent_claim_ifa_requests((select k from t_k), 5)) = 1, 'agent claims the second request');
select agent_fail_ifa_request((select k from t_k), (select id from t_req), 'blocked: HTTP 403, stopped', '{"http_status":403}');
select pg_temp.as_user(null);
select pg_temp.check((select status || ':' || error from ifa_sync_requests where id = (select id from t_req)) = 'failed:blocked: HTTP 403, stopped', 'failure stored');
select pg_temp.check((select count(*) from ifa_sync_runs where source = 'local-agent' and status = 'failed') = 1, 'failure in the sync log');
select pg_temp.check((select count(*) from ifa_rosters where ifa_team_id = 9201 and status = 'active') = 7, 'roster unchanged after a blocked page');

-- a stale claim is offered again; a revoked key is refused
delete from t_req;
select pg_temp.as_user(:SA);
insert into t_req select request_ifa_sync(9201, 28);
select pg_temp.as_anon();
select count(*) from agent_claim_ifa_requests((select k from t_k), 5);
select pg_temp.as_user(null);
update ifa_sync_requests set claimed_at = now() - interval '31 minutes' where id = (select id from t_req);
select pg_temp.as_anon();
select pg_temp.check((select count(*) from agent_claim_ifa_requests((select other from t_k), 5)) = 1, 'stale claim offered again');
select pg_temp.as_user(:SA);
select revoke_ifa_agent_key(id) from ifa_agent_keys where name = 'second';
select cancel_ifa_request(id) from t_req;
select pg_temp.check((select status from ifa_sync_requests where id = (select id from t_req)) = 'canceled', 'admin cancels a request');
select pg_temp.as_anon();
select pg_temp.fails($$select * from agent_claim_ifa_requests((select other from t_k), 5)$$, 'revoked key refused');
select pg_temp.as_user(null);
