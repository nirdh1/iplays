-- Open search, join requests, shirt numbers and kit. Runs after test_m3.sql.
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
\set H '''00000000-0000-0000-0000-000000000012'''
\set T1 '''10000000-0000-0000-0000-000000000001'''
\set T2 '''10000000-0000-0000-0000-000000000002'''
\set NOAM '''20000000-0000-0000-0000-000000000001'''
\set ITAY '''20000000-0000-0000-0000-000000000002'''

insert into auth.users (id, email) values (:G, 'g@test'), (:H, 'h@test');
update profiles set full_name = 'הורה חדש' where id = :G;
update profiles set full_name = 'סבתא' where id = :H;

-- ------------------------------------------------------------- search
select pg_temp.as_user(null);
select pg_temp.fails('select * from search_players(''נוע'')', 'search without signing in');

select pg_temp.as_user(:G);
select pg_temp.check((select count(*) from search_players('נוע')) >= 1, 'search: any signed-in user finds a child by name');
select pg_temp.check((select team_name from search_players('נועם', 2017) limit 1) is not null, 'search: result shows the team');
select pg_temp.check((select count(*) from search_players('נועם', 2010)) = 0, 'search: birth year filter');
select pg_temp.check((select count(*) from search_players('נ')) = 0, 'search: needs 2+ characters');
select pg_temp.check((select count(*) from search_clubs('מכבי')) >= 1, 'search: finds a club');
select pg_temp.check((select count(*) from teams) = 0, 'search does not open the teams table');
select pg_temp.check((select is_member from team_public(:T1)) = false, 'team page: card for a non-member');
select pg_temp.check((select has_parent from team_roster_public(:T2) where player_id = :NOAM), 'team page: roster shows the child has a parent');

-- ------------------------------------------------ parent requests (2 kids)
select pg_temp.fails(format('select request_join(%L, null, %L, %L, 2017)', :T1, 'רון', 'חדש'), 'parent request without the declaration');
select request_join(:T1, null, 'רון', 'חדש', 2017, '', 'parent', true);
select request_join(:T1, null, 'תמר', 'חדש', 2019, '', 'parent', true);
select pg_temp.check((select count(*) from my_join_requests() where status = 'pending') = 2, 'one parent, two children: two pending requests');
select pg_temp.check((select count(*) from join_requests where declared_at is not null and declaration <> '') = 2, 'declaration stored with time and wording');
select pg_temp.fails(format('select request_join(%L, null, %L, %L, 2017, %L, %L, true)', :T1, 'רון', 'חדש', '', 'parent'), 'duplicate pending request');
select pg_temp.as_user(null);

select pg_temp.as_user(:C);
select pg_temp.check((select count(*) from pending_join_requests(:T1)) = 0, 'a parent in the team does not see parent requests');
select pg_temp.fails(format('select review_join_request(%L, true)', (select id from join_requests where child_first = 'רון')), 'a parent approving a parent request');
select pg_temp.as_user(null);

select pg_temp.as_user(:B);
select pg_temp.fails(format('select review_join_request(%L, true)', (select id from join_requests where child_first = 'רון')), 'another club approving');
select pg_temp.as_user(null);

select id as req_ron from join_requests where child_first = 'רון' \gset
select id as req_tamar from join_requests where child_first = 'תמר' \gset
select pg_temp.as_user(:A);
select pg_temp.check((select count(*) from pending_join_requests(:T1)) = 2, 'team admin sees both requests');
select review_join_request(:'req_ron', true);
select review_join_request(:'req_tamar', true);
select pg_temp.as_user(null);

select pg_temp.as_user(:G);
select pg_temp.check((select role from team_members where team_id = :T1 and user_id = :G) = 'parent', 'approved: joined the team as parent');
select pg_temp.check((select count(*) from player_guardians where user_id = :G and relation = 'parent') = 2, 'approved: parent of both children');
select pg_temp.check((select count(*) from players where first_name in ('רון', 'תמר')) = 2, 'approved: both children on the roster');
select pg_temp.as_user(null);
select id as ron from players where first_name = 'רון' \gset

-- ---------------------------------------------------------------- shirt
select pg_temp.as_user(:G);
select set_shirt_number(:'ron', :T1, 23);
select pg_temp.check((select shirt_number from player_assignments where player_id = :'ron' and team_id = :T1 and ended_on is null) = 23, 'parent sets the shirt number');
select pg_temp.check((select shirt_number from players where id = :'ron') = 23, 'shirt number mirrored to the profile');
select set_shirt_number(:'ron', :T1, 24);
select pg_temp.check((select shirt_number from players where id = :'ron') = 24, 'shirt number can change');
select pg_temp.fails(format('select set_shirt_number(%L, %L, 5)', :NOAM, :T2), 'parent setting another child''s shirt');
select pg_temp.as_user(null);

-- ------------------------------------------------------------ followers
select pg_temp.as_user(:H);
select pg_temp.fails(format('select request_join(%L, %L, %L, %L, null, %L, %L)', :T1, :ITAY, '', '', '', 'family'), 'follow a child without a declared parent');
select request_join(:T2, :NOAM, '', '', null, 'סבתא של נועם', 'family');
select pg_temp.as_user(null);
select id as req_h from join_requests where user_id = :H \gset

select pg_temp.as_user(:A);
select pg_temp.fails(format('select review_join_request(%L, true)', :'req_h'), 'team admin approving a follower');
select pg_temp.check((select count(*) from pending_join_requests(:T2)) = 0, 'follow requests are not in the staff list');
select pg_temp.as_user(null);

select pg_temp.as_user(:G);
select pg_temp.fails(format('select review_join_request(%L, true)', :'req_h'), 'another parent approving a follower');
select pg_temp.as_user(null);

select pg_temp.as_user(:C);
select pg_temp.check((select count(*) from my_follow_requests()) = 1, 'the declared parent sees the follow request');
select review_join_request(:'req_h', true);
select set_player_kit(:NOAM, 2, 1, 2, 1, 4, '10', '10', '32', '');
select pg_temp.as_user(null);

select pg_temp.as_user(:H);
select pg_temp.check((select relation from player_guardians where user_id = :H and player_id = :NOAM) = 'family', 'follower linked as family');
select pg_temp.check(exists (select 1 from players where id = :NOAM), 'follower sees the child');
select pg_temp.fails(format('insert into player_absences (player_id, from_date, to_date, reason, reported_by) values (%L, current_date + 9, current_date + 9, %L, %L)', :NOAM, 'sick', :H), 'follower reporting an absence');
update players set first_name = 'שונה' where id = :NOAM;
select pg_temp.as_user(null);
select pg_temp.check((select first_name from players where id = :NOAM) = 'נועם', 'follower cannot edit the child');
select pg_temp.as_user(:H);
select pg_temp.fails(format('select claim_player(%L)', :NOAM), 'claiming a child who has a parent');
select pg_temp.fails(format('select set_player_kit(%L, 9)', :NOAM), 'follower editing the kit');
select pg_temp.check((select socks from player_kit where player_id = :NOAM) = 4, 'follower sees the kit');
select pg_temp.as_user(null);

-- -------------------------------------------------------------------- kit
select pg_temp.as_user(:G);
select set_player_kit(:'ron', 1, 1, 1, 1, 2, '8', '8', '30', 'מעדיף מכנס ארוך');
select pg_temp.check((select shirt_size from player_kit where player_id = :'ron') = '8', 'parent saves the kit');
select pg_temp.as_user(null);
select pg_temp.as_user(:E);
select pg_temp.check((select count(*) from player_kit) = 0, 'unrelated user sees no kit');
select pg_temp.check((select count(*) from join_requests) = 0, 'unrelated user sees no requests');
select pg_temp.fails(format('select set_player_kit(%L, 1)', :'ron'), 'unrelated user editing the kit');
select pg_temp.as_user(null);
select pg_temp.as_user(:A);
select pg_temp.check((select home_sets from player_kit where player_id = :'ron') = 1, 'team admin sees the kit (equipment)');
select pg_temp.as_user(null);
