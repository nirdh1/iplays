-- Teams without a coach, team search, auto-approval. Runs after test_m4.sql.
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

insert into auth.users (id, email) values (:P1, 'p1@test'), (:P2, 'p2@test'), (:P3, 'p3@test');

-- ------------------------------------------------------------ open a team
select pg_temp.as_user(:P1);
select pg_temp.fails('select open_team(''הכוכבים'', ''עירוני רמת גן'', ''football'', 2016, ''אלון'', ''כהן'', false)',
                     'open a team without the parent declaration');
select pg_temp.fails('select open_team(''הכוכבים'', ''עירוני רמת גן'', ''football'', null, ''אלון'', ''כהן'', true)',
                     'open a team without a birth year');
create temp table t_new as select open_team('הכוכבים', 'עירוני רמת גן', 'football', 2016, 'אלון', 'כהן', true) as id;
grant select on t_new to authenticated;
select pg_temp.check((select role from team_members where user_id = :P1 and team_id = (select id from t_new)) = 'parent',
                     'opener is a parent member, not staff');
select pg_temp.check(not can((select id from t_new), 'training', 2), 'opener cannot edit trainings');
select pg_temp.check(is_player_parent((select player_id from player_assignments where team_id = (select id from t_new))),
                     'opener is the child''s declared parent');
select pg_temp.check(not team_has_staff((select id from t_new)), 'new team has no staff');
select pg_temp.fails('select open_team(''הכוכבים'', ''עירוני רמת גן'', ''football'', 2016, ''דני'', ''לוי'', true)',
                     'the same team opened twice');

-- ------------------------------------------------------------- search
select pg_temp.as_user(:P2);
select pg_temp.check((select count(*) from search_teams('', 2016) where team_id = (select id from t_new)) = 1,
                     'search: by birth year alone');
select pg_temp.check((select count(*) from search_teams('רמת גן', 2016) where team_id = (select id from t_new)) = 1,
                     'search: by club name and birth year');
select pg_temp.check((select count(*) from search_teams('כוכבים') where team_id = (select id from t_new)) = 1,
                     'search: by team name');
select pg_temp.check((select count(*) from search_teams('רמת גן', 2012)) = 0, 'search: other birth year not shown');
select pg_temp.check((select count(*) from search_teams('', null)) = 0, 'search: needs a year or text');
select pg_temp.check((select count(*) from search_teams('רמת גן', 2016, 'basketball')) = 0, 'search: sport filter');
select pg_temp.check((select has_staff from search_teams('', 2016) where team_id = (select id from t_new)) = false,
                     'search: shows the team has no coach yet');
select pg_temp.check((select count(*) from search_teams('', 2017) where team_id = :T1) = 1,
                     'search: a club team found by its players'' birth year');
select pg_temp.check((select has_staff from team_public((select id from t_new))) = false, 'team page: no staff');

-- --------------------------------------------- auto-approval with no staff
select request_join((select id from t_new), null, 'מיה', 'לוי', 2016, '', 'parent', true);
select pg_temp.check(is_team_member((select id from t_new)), 'no staff: declared parent joins right away');
select pg_temp.check((select status from join_requests where user_id = :P2 order by created_at desc limit 1) = 'approved',
                     'no staff: request recorded as approved');
select pg_temp.check((select count(*) from player_guardians g join players p on p.id = g.player_id
                      where g.user_id = :P2 and p.first_name = 'מיה' and g.relation = 'parent') = 1,
                     'no staff: child created with the parent');

-- an existing child that already has a parent still needs approval
select pg_temp.as_user(null);
create temp table t_kids as select id, first_name from players where first_name in ('אלון', 'מיה') and birth_year = 2016;
grant select on t_kids to authenticated;
select pg_temp.as_user(:P3);
select request_join((select id from t_new),
                    (select id from t_kids where first_name = 'אלון'), '', '', null, '', 'parent', true);
select pg_temp.check(not is_team_member((select id from t_new)), 'no staff: claiming a child who has a parent is not automatic');

-- ... and it goes to the child's declared parent (P1), not to a staff that does not exist
select pg_temp.as_user(null);
create temp table t_req as select id from join_requests where user_id = :P3 and relation = 'parent' and status = 'pending';
grant select on t_req to authenticated;
select pg_temp.as_user(:P2);
select pg_temp.check((select count(*) from my_follow_requests()) = 0, 'no staff: another parent does not see the request');
select pg_temp.fails(format('select review_join_request(%L, true)', (select id from t_req)),
                     'no staff: someone who is not the child''s parent approves');
select pg_temp.as_user(:P1);
select pg_temp.check((select relation from my_follow_requests() where child_name like 'אלון%') = 'parent',
                     'no staff: the child''s parent sees the parent request');
select review_join_request((select id from my_follow_requests() where child_name like 'אלון%'), true);
select pg_temp.as_user(:P3);
select pg_temp.check(is_team_member((select id from t_new)), 'no staff: the child''s parent approved, second parent joined');
select pg_temp.check(is_player_parent((select id from t_kids where first_name = 'אלון')), 'no staff: second parent linked to the child');

-- a follower still needs the parent
select request_join((select id from t_new),
                    (select id from t_kids where first_name = 'מיה'), '', '', null, '', 'family', false);
select pg_temp.check((select status from join_requests where user_id = :P3 and relation = 'family') = 'pending',
                     'no staff: follow request waits for the parent');

-- a team with staff: still waits
select request_join(:T1, null, 'גיל', 'שני', 2017, '', 'parent', true);
select pg_temp.check((select status from join_requests where user_id = :P3 and team_id = :T1) = 'pending',
                     'with staff: request waits for approval');

-- ------------------------------------------- parents keep the schedule
select pg_temp.as_user(:P1);
insert into training_sessions (team_id, starts_at, title) values ((select id from t_new), now() + interval '1 day', 'אימון הורים');
select pg_temp.as_user(:P2);
select pg_temp.check((select count(*) from training_sessions where team_id = (select id from t_new)) = 1,
                     'no staff: another parent sees the training a parent added');
update training_sessions set canceled = true where team_id = (select id from t_new);
select pg_temp.check((select canceled from training_sessions where team_id = (select id from t_new)), 'no staff: a parent cancels a training');
select pg_temp.as_user(:P3);
select pg_temp.as_user(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000029', 'x@test');
select pg_temp.as_user('00000000-0000-0000-0000-000000000029');
select pg_temp.fails(format('insert into training_sessions (team_id, starts_at) values (%L, now())', (select id from t_new)),
                     'no staff: a non-member adds a training');

-- ------------------------------------------------------------- adoption
select pg_temp.fails(format('select adopt_team(%L, (select id from clubs where name = %L))', (select id from t_new), 'מכבי צפון'),
                     'a parent adopts a team into a club');
select pg_temp.as_user(:A);
select adopt_team((select id from t_new), (select id from clubs where name = 'מכבי צפון'));
select pg_temp.check(team_has_staff((select id from t_new)), 'adopted: the club now manages the team');
select pg_temp.check(can((select id from t_new), 'staff', 2), 'adopted: club admin approves requests');
select pg_temp.as_user(:P1);
select pg_temp.fails(format('insert into training_sessions (team_id, starts_at) values (%L, now())', (select id from t_new)),
                     'adopted: a parent no longer edits the schedule');
select pg_temp.as_user(:A);
select pg_temp.fails(format('select adopt_team(%L, (select id from clubs where name = %L))', (select id from t_new), 'מכבי צפון'),
                     'adopt twice');

select pg_temp.as_user(:P3);
select request_join((select id from t_new), null, 'רוני', 'שני', 2016, '', 'parent', true);
select pg_temp.check((select status from join_requests where user_id = :P3 and child_first = 'רוני') = 'pending',
                     'adopted: new requests wait for the club');
select pg_temp.as_user(null);
