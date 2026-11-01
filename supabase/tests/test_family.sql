-- Family members, invites and permissions. Runs after the other tests.
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

\set MOM '''00000000-0000-0000-0000-0000000000f1'''
\set DAD '''00000000-0000-0000-0000-0000000000f2'''
\set GMA '''00000000-0000-0000-0000-0000000000f3'''
\set UNC '''00000000-0000-0000-0000-0000000000f4'''
\set OLD '''00000000-0000-0000-0000-0000000000f5'''
\set FT '''10000000-0000-0000-0000-0000000000f1'''
\set KID '''20000000-0000-0000-0000-0000000000f1'''
\set KID2 '''20000000-0000-0000-0000-0000000000f2'''

select pg_temp.as_user(null);
insert into auth.users (id, email) values (:MOM, 'mom@test'), (:DAD, 'dad@test'), (:GMA, 'gma@test'), (:UNC, 'unc@test'), (:OLD, 'old@test');
update profiles set full_name = 'מיכל' where id = :MOM;
update profiles set full_name = 'סבתא רותי' where id = :GMA;
insert into teams (id, name, club, sport, created_by) values (:FT, 'משפחה FC', 'בדיקה', 'football', :MOM);
insert into team_members (team_id, user_id, role) values (:FT, :MOM, 'parent');
insert into players (id, team_id, first_name, last_name, birth_year, created_by) values
  (:KID, :FT, 'עומר', 'לוי', 2016, :MOM), (:KID2, :FT, 'מאיה', 'לוי', 2018, :MOM);
insert into player_guardians (player_id, user_id, relation) values (:KID, :MOM, 'parent'), (:KID2, :MOM, 'parent');

-- --------------------------------------------- backfill of old followers
insert into team_members (team_id, user_id, role) values (:FT, :OLD, 'parent');
insert into player_guardians (player_id, user_id, relation) values (:KID, :OLD, 'family');
\i supabase/migrations/20261101995000_family_members.sql
select pg_temp.check((select is_follower from team_members where team_id = :FT and user_id = :OLD), 'backfill: old follower marked');
select pg_temp.check(not (select is_follower from team_members where team_id = :FT and user_id = :MOM), 'backfill: parent not marked');

-- -------------------------------------------------------------- invites
select pg_temp.as_user(:GMA);
select pg_temp.fails(format('select create_family_invite(array[%L]::uuid[], %L)', :KID, 'family'), 'non-parent invites family');

select pg_temp.as_user(:MOM);
select pg_temp.fails(format('select create_family_invite(array[%L]::uuid[], %L)', :KID, 'boss'), 'invite with a bad relation');
create temp table codes (who text, code text);
grant all on codes to authenticated;
insert into codes select 'dad', create_family_invite(array[:KID, :KID2]::uuid[], 'parent', 'אבא');
insert into codes select 'gma', create_family_invite(array[:KID]::uuid[], 'family', 'סבתא', true, false, false);
insert into codes select 'unc', create_family_invite(array[:KID]::uuid[], 'family', 'דוד');
select pg_temp.check((select count(*) from family_invites) = 3, 'inviter sees own invites');
select pg_temp.fails(format('select accept_family_invite(%L)', (select code from codes where who = 'gma')), 'accept your own invite');

select pg_temp.as_user(:GMA);
select pg_temp.check((select count(*) from family_invites) = 0, 'others do not see invites');
select pg_temp.check((select status from family_invite_info((select code from codes where who = 'gma'))) = 'valid', 'invite info: valid');
select pg_temp.check((select inviter from family_invite_info((select code from codes where who = 'gma'))) = 'מיכל', 'invite info: inviter name');
select pg_temp.check((select children from family_invite_info((select code from codes where who = 'dad'))) = array['מאיה', 'עומר'], 'invite info: children first names');
select pg_temp.fails(format('select accept_family_invite(%L)', 'NOPENOPE22'), 'accept an unknown code');
select accept_family_invite((select code from codes where who = 'gma'));
select pg_temp.check((select relation = 'family' and kinship = 'סבתא' and can_report and not can_rides
                      from player_guardians where player_id = :KID and user_id = :GMA), 'grandma linked with the chosen permissions');
select pg_temp.check((select role = 'parent' and is_follower from team_members where team_id = :FT and user_id = :GMA), 'grandma joins the team as follower');
select pg_temp.check((select status from family_invite_info((select code from codes where who = 'gma'))) = 'accepted', 'invite info: accepted');
select accept_family_invite((select code from codes where who = 'gma')); -- second tap is harmless

select pg_temp.as_user(:UNC);
select pg_temp.fails(format('select accept_family_invite(%L)', (select code from codes where who = 'gma')), 'reuse a used invite');
select accept_family_invite((select code from codes where who = 'unc'));

select pg_temp.as_user(:DAD);
select accept_family_invite((select code from codes where who = 'dad'));
select pg_temp.check((select count(*) from player_guardians where user_id = :DAD and relation = 'parent') = 2, 'second parent linked to both kids');
select pg_temp.check(not (select is_follower from team_members where team_id = :FT and user_id = :DAD), 'second parent is a full member');
select pg_temp.check(family_can(:KID, 'pay') and family_can(:KID2, 'rides'), 'parent has every permission');

-- ------------------------------------------------- what followers can do
select pg_temp.as_user(:GMA);
select pg_temp.check((select count(*) from training_sessions where team_id = :FT) >= 0, 'follower reads the schedule');
select pg_temp.fails(format('insert into training_sessions (team_id, starts_at, created_by) values (%L, now() + interval ''1 day'', %L)', :FT, :GMA),
                     'follower adds a training');
select pg_temp.check(family_can(:KID, 'report') and not family_can(:KID, 'rides') and not family_can(:KID2, 'view'), 'family_can for grandma');
insert into player_absences (player_id, team_id, from_date, to_date, reason, reported_by)
values (:KID, :FT, current_date + 1, current_date + 1, 'family_event', :GMA);
select pg_temp.check((select count(*) from player_absences where player_id = :KID and reported_by = :GMA) = 1, 'grandma (allowed) reports an absence');
-- RLS hides the row from the update (no error); checked below
update players set first_name = 'x' where id = :KID;
select pg_temp.as_user(null);
select pg_temp.check((select first_name from players where id = :KID) = 'עומר', 'follower cannot edit the child');

select pg_temp.as_user(:UNC);
select pg_temp.fails(format('insert into player_absences (player_id, team_id, from_date, to_date, reason, reported_by) values (%L, %L, current_date, current_date, %L, %L)',
                            :KID, :FT, 'other', :UNC), 'uncle (not allowed) reports an absence');
select update_family_member(:KID, :UNC, 'דוד יוסי', true, true, true);
select pg_temp.check((select kinship = 'דוד יוסי' and not can_report from player_guardians where player_id = :KID and user_id = :UNC),
                     'follower changes own label, not own permissions');
select pg_temp.fails(format('select remove_family_member(%L, %L)', :KID, :GMA), 'follower removes another follower');

-- ------------------------------------------------- the parent manages
select pg_temp.as_user(:DAD);
select pg_temp.check((select count(*) from my_family() where player_id = :KID) = 5, 'family list: 2 parents + 3 others');
select pg_temp.check((select is_me from my_family() where player_id = :KID and user_id = :DAD), 'family list marks me');
select update_family_member(:KID, :UNC, null, null, true, null);
select pg_temp.check((select can_rides from player_guardians where player_id = :KID and user_id = :UNC), 'parent turns on rides for uncle');
select update_family_member(:KID, :MOM, 'אמא', false, false, false);
select pg_temp.check((select kinship = 'אמא' and relation = 'parent' from player_guardians where player_id = :KID and user_id = :MOM)
                     and (select can_pay from my_family() where player_id = :KID and user_id = :MOM), 'other parent keeps every permission');
select pg_temp.fails(format('select remove_family_member(%L, %L)', :KID, :MOM), 'parent removes the other parent');
select remove_family_member(:KID, :UNC);
select pg_temp.as_user(null);
select pg_temp.check(not exists (select 1 from player_guardians where player_id = :KID and user_id = :UNC), 'uncle removed');
select pg_temp.check(not exists (select 1 from team_members where team_id = :FT and user_id = :UNC), 'uncle leaves the team');

-- ------------------------------------------- revoke / follower becomes parent
select pg_temp.as_user(:MOM);
insert into codes select 'rev', create_family_invite(array[:KID]::uuid[], 'family', 'שכנה');
select revoke_family_invite((select id from family_invites where code = (select code from codes where who = 'rev')));
select pg_temp.as_user(:UNC);
select pg_temp.fails(format('select accept_family_invite(%L)', (select code from codes where who = 'rev')), 'accept a revoked invite');

select pg_temp.as_user(:MOM);
insert into codes select 'gma2', create_family_invite(array[:KID]::uuid[], 'parent', 'אמא חורגת');
select pg_temp.as_user(:GMA);
select accept_family_invite((select code from codes where who = 'gma2'));
select pg_temp.check((select relation from player_guardians where player_id = :KID and user_id = :GMA) = 'parent', 'follower upgraded to parent');
select pg_temp.check(not (select is_follower from team_members where team_id = :FT and user_id = :GMA), 'upgrade clears the follower mark');

-- ------------------------------------------- second parent through search
select pg_temp.as_user(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f6', 'p2@test');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f6');
select request_join(:FT, :KID2, '', '', null, '', 'parent', true);
select pg_temp.as_user(:MOM);
select pg_temp.check((select count(*) from my_follow_requests() where relation = 'parent') = 1, 'parent sees a second-parent request');
select review_join_request((select id from my_follow_requests() where relation = 'parent'), true);
select pg_temp.check((select relation from player_guardians where player_id = :KID2 and user_id = '00000000-0000-0000-0000-0000000000f6') = 'parent',
                     'parent approves the second parent');

select pg_temp.as_user(null);
