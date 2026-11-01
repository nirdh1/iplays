-- A coach asks to manage an existing team. Runs after test_open_teams.sql.
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
\set P1 '''00000000-0000-0000-0000-000000000021'''
\set P2 '''00000000-0000-0000-0000-000000000022'''
\set P3 '''00000000-0000-0000-0000-000000000023'''
\set T1 '''10000000-0000-0000-0000-000000000001'''
\set K1 '''00000000-0000-0000-0000-000000000031'''
\set K2 '''00000000-0000-0000-0000-000000000032'''
\set SA '''00000000-0000-0000-0000-000000000033'''


-- ------------------------------------------------------------ open a team

insert into auth.users (id, email) values (:K1, 'k1@test'), (:K2, 'k2@test'), (:SA, 'sa@test');
insert into platform_admins (user_id) values (:SA);

-- a catalog team with no club and no staff (as an import would create it)
create temp table t_cat as select id from teams where name = 'הכוכבים' limit 0;
insert into teams (name, club, sport, created_by, birth_year_from, birth_year_to)
values ('טרום ב׳ צפון', 'הפועל רמת גן', 'football', :SA, 2018, 2018);
insert into t_cat select id from teams where name = 'טרום ב׳ צפון' and club = 'הפועל רמת גן';
grant select on t_cat to authenticated;

select pg_temp.as_user(:K1);
select pg_temp.check(not team_has_staff((select id from t_cat)), 'catalog team starts with no staff');
select request_team_claim((select id from t_cat), 'אני המאמן של הקבוצה');
select pg_temp.fails(format('select request_team_claim(%L)', (select id from t_cat)), 'same coach asks twice');
select pg_temp.check(not team_has_staff((select id from t_cat)), 'a request alone gives nothing');
select pg_temp.check((select count(*) from pending_team_claims()) = 0, 'coach cannot see claims to review');
select pg_temp.fails(format('select review_team_claim(%L, true)', (select id from team_claims where user_id = :K1)), 'coach approves himself');

-- a parent (P2, member of another team) cannot approve either
select pg_temp.as_user(:P2);
select pg_temp.as_user(null);
create temp table t_claim as select id from team_claims where user_id = :K1;
grant select on t_claim to authenticated;
select pg_temp.as_user(:P2);
select pg_temp.fails(format('select review_team_claim(%L, true)', (select id from t_claim)), 'parent approves a coach');

-- no club: the platform admin approves
select pg_temp.as_user(:SA);
select pg_temp.check((select count(*) from pending_team_claims() where team_id = (select id from t_cat)) = 1, 'super admin sees the claim');
select review_team_claim((select id from pending_team_claims() where team_id = (select id from t_cat)), true);
select pg_temp.as_user(null);
select pg_temp.check((select role from team_members where user_id = :K1 and team_id = (select id from t_cat)) = 'admin',
                     'approved coach becomes team admin (team had none)');
select pg_temp.check(team_has_staff((select id from t_cat)), 'team now has staff');

-- a second coach becomes coach, not admin
select pg_temp.as_user(:K2);
select request_team_claim((select id from t_cat), 'עוזר מאמן');
select pg_temp.as_user(:K1);
select pg_temp.check((select count(*) from pending_team_claims()) = 0, 'team admin is not the approver of coaches');
select pg_temp.as_user(:SA);
select review_team_claim((select id from pending_team_claims() where team_id = (select id from t_cat)), true);
select pg_temp.as_user(null);
select pg_temp.check((select role from team_members where user_id = :K2 and team_id = (select id from t_cat)) = 'coach',
                     'second coach joins as coach');

-- now parent requests wait for the staff
select pg_temp.as_user(:P3);
select request_join((select id from t_cat), null, 'עידו', 'שני', 2018, '', 'parent', true);
select pg_temp.as_user(null);
select pg_temp.check((select status from join_requests where user_id = :P3 and child_first = 'עידו') = 'pending',
                     'after a coach took over, parents wait for approval');

-- club team: the club admin approves, not the platform admin only
select pg_temp.as_user(:K2);
select request_team_claim(:T1, '');
select pg_temp.as_user(:A);
select pg_temp.check((select count(*) from pending_team_claims() where team_id = :T1) = 1, 'club admin sees claims for club teams');
select review_team_claim((select id from pending_team_claims() where team_id = :T1), false);
select pg_temp.as_user(null);
select pg_temp.check((select status from team_claims where user_id = :K2 and team_id = :T1) = 'rejected', 'club admin rejects');
select pg_temp.as_user(null);
