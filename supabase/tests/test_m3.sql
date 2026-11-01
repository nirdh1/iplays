-- M3 permission tree tests. Runs after test_m1_m2.sql (uses its data).
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
\set D '''00000000-0000-0000-0000-00000000000d'''
\set F '''00000000-0000-0000-0000-00000000000f'''
\set T1 '''10000000-0000-0000-0000-000000000001'''
\set T2 '''10000000-0000-0000-0000-000000000002'''
\set T3 '''10000000-0000-0000-0000-000000000003'''
\set NOAM '''20000000-0000-0000-0000-000000000001'''
\set DANIEL '''20000000-0000-0000-0000-000000000004'''

insert into auth.users (id, email) values (:F, 'f@test');
update profiles set full_name = 'מאמן חדש' where id = :F;
select club_id as xclub from teams where id = :T1 \gset
select id as academy from club_programs where club_id = :'xclub' and kind = 'academy' \gset

-- --------------------------------------------------- invite a coach to T1
select pg_temp.as_user(:A);
select create_club_invite(:'xclub', 'staff', :T1, 'coach', 'מאמן טרום ב׳') as code \gset
select pg_temp.as_user(null);

select pg_temp.as_user(:F);
select pg_temp.check((select count(*) from teams) = 0, 'before accepting: new coach sees no teams');
select accept_club_invite(:'code');
select pg_temp.check((select role from team_members where team_id = :T1 and user_id = :F) = 'coach', 'invite: joined T1 as coach');
select pg_temp.check(exists (select 1 from clubs where id = :'xclub'), 'invite: sees own club');
select pg_temp.as_user(null);

select pg_temp.as_user(:B);
select pg_temp.fails(format('select accept_club_invite(%L)', :'code'), 'reusing an invite code by someone else');
select pg_temp.as_user(null);

-- ------------------------------------------------- default coach access
select pg_temp.as_user(:F);
select pg_temp.check((select level from my_permissions(:T1) where domain = 'training') = 4, 'coach: manages trainings of own team');
select pg_temp.check((select level from my_permissions(:T1) where domain = 'finance') = 1, 'coach: finance view only');
select pg_temp.check((select level from my_permissions(:T2) where domain = 'training') = 0, 'coach: no access to another team');
insert into training_sessions (team_id, starts_at, created_by) values (:T1, now() + interval '2 days', :F);
select pg_temp.check(true, 'coach: created a training in own team');
select pg_temp.fails(format('insert into training_sessions (team_id, starts_at, created_by) values (%L, now(), %L)', :T2, :F),
                     'coach creating a training in another team');
select pg_temp.check(not exists (select 1 from teams where id = :T2), 'coach: does not see the academy team');
select pg_temp.check(not exists (select 1 from players where id = :DANIEL), 'coach: does not see academy-only player');
select pg_temp.check(not exists (select 1 from teams where id = :T3), 'coach: does not see another club');
select pg_temp.fails(format('select set_permission(%L, %L, %L, 4)', :'xclub', :F, 'finance'), 'coach granting himself finance');
select pg_temp.fails(format('select transfer_player(%L, %L, %L)', :DANIEL, :T1, 'add'), 'coach transferring players');
select pg_temp.check((select count(*) from club_people(:'xclub')) = 0, 'coach: cannot list club staff');
select pg_temp.as_user(null);

-- ------------------------------------------------- grant on a program
select pg_temp.as_user(:A);
insert into player_absences (player_id, from_date, to_date, reason, reported_by) values (:DANIEL, current_date, current_date + 3, 'vacation', :A);
select set_permission(:'xclub', :F, 'attendance', 1, :'academy');
select pg_temp.check((select count(*) from club_people(:'xclub')) >= 3, 'club admin lists club staff (A, D, F)');
select pg_temp.check(exists (select 1 from profiles where id = :F), 'club admin sees staff names');
select pg_temp.as_user(null);

select pg_temp.as_user(:F);
select pg_temp.check(exists (select 1 from teams where id = :T2), 'program grant: sees academy team');
select pg_temp.check(exists (select 1 from player_absences where player_id = :DANIEL), 'program grant: sees academy absences');
select pg_temp.check(exists (select 1 from players where id = :DANIEL), 'program grant: sees academy players');
select pg_temp.fails(format('insert into training_sessions (team_id, starts_at, created_by) values (%L, now(), %L)', :T2, :F),
                     'program grant for attendance does not allow trainings');
select pg_temp.as_user(null);

-- revoke
select pg_temp.as_user(:A);
select set_permission(:'xclub', :F, 'attendance', 0, :'academy');
select pg_temp.as_user(null);
select pg_temp.as_user(:F);
select pg_temp.check(not exists (select 1 from player_absences where player_id = :DANIEL), 'revoke: academy absences hidden again');
select pg_temp.check(not exists (select 1 from teams where id = :T2), 'revoke: academy team hidden again');
select pg_temp.as_user(null);

-- ------------------------------------------------- other clubs, parents
select pg_temp.as_user(:B);
select pg_temp.fails(format('select set_permission(%L, %L, %L, 4)', :'xclub', :B, 'roster'), 'another club granting in club X');
select pg_temp.fails(format('select create_club_invite(%L)', :'xclub'), 'another club inviting to club X');
select pg_temp.as_user(null);

select pg_temp.as_user(:C);
select pg_temp.fails(format('select create_invite(%L, %L)', :T1, 'coach'), 'parent creating a coach invite');
select pg_temp.fails(format('insert into training_sessions (team_id, starts_at, created_by) values (%L, now(), %L)', :T1, :C), 'parent creating a training');
insert into player_absences (player_id, from_date, to_date, reason, reported_by) values (:NOAM, current_date + 5, current_date + 5, 'family_event', :C);
select pg_temp.check(true, 'parent: still reports an absence for own child');
select pg_temp.as_user(null);

-- existing coach (pre-M3 role) keeps working
select pg_temp.as_user(:D);
insert into training_sessions (team_id, starts_at, created_by) values (:T2, now() + interval '3 days', :D);
select pg_temp.check(true, 'existing coach: still creates trainings');
select pg_temp.check(create_invite(:T2, 'parent') is not null, 'existing coach: still invites parents');
update team_members set role = 'admin' where team_id = :T2 and user_id = :D;
select pg_temp.check((select role from team_members where team_id = :T2 and user_id = :D) = 'coach', 'coach cannot promote himself to admin');
select pg_temp.check(exists (select 1 from player_absences where player_id = :NOAM and from_date = current_date + 5), 'existing coach: sees new absence of own player');
select pg_temp.as_user(null);

-- club admin changes a team role
select pg_temp.as_user(:A);
select set_team_role(:T2, :F, 'assistant_coach');
select pg_temp.as_user(null);
select pg_temp.as_user(:F);
select pg_temp.check((select level from my_permissions(:T2) where domain = 'training') = 3, 'assistant coach: edits trainings');
select pg_temp.check((select level from my_permissions(:T2) where domain = 'roster') = 1, 'assistant coach: roster view only');
select pg_temp.as_user(null);
