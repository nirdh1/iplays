-- RLS and behaviour tests for M1+M2. Run with supabase/tests/run.sh.
-- Each check raises an exception (and stops the run) when it fails.
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

-- ids
\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''
\set E '''00000000-0000-0000-0000-00000000000e'''
\set T1 '''10000000-0000-0000-0000-000000000001'''
\set T2 '''10000000-0000-0000-0000-000000000002'''
\set T3 '''10000000-0000-0000-0000-000000000003'''
\set T4 '''10000000-0000-0000-0000-000000000004'''
\set NOAM '''20000000-0000-0000-0000-000000000001'''
\set YOAV '''20000000-0000-0000-0000-000000000003'''

-- ------------------------------------------------------------ backfill
select pg_temp.check((select count(*) from clubs) = 2, 'backfill: one draft club per (creator, club name)');
select pg_temp.check((select count(*) from club_programs) = 4, 'backfill: league + academy for each club');
select pg_temp.check((select count(*) from teams where club_id is not null) = 3, 'backfill: teams with a club name are linked');
select pg_temp.check((select club_id from teams where id = :T4) is null, 'backfill: team without club name stays independent');
select pg_temp.check((select count(*) from player_assignments where ended_on is null and is_primary) = 4, 'backfill: one primary assignment per player');
select pg_temp.check((select shirt_number from player_assignments where player_id = :NOAM) = 7, 'backfill: shirt number copied');

-- ------------------------------------------------------ club isolation
select pg_temp.as_user(:B);
select pg_temp.check((select count(*) from clubs) = 1, 'B sees only own club');
select pg_temp.check(not exists (select 1 from teams where id = :T1), 'B cannot see club X team');
select pg_temp.check(not exists (select 1 from players where id = :NOAM), 'B cannot see club X player');
select pg_temp.check(not exists (select 1 from player_assignments where player_id = :NOAM), 'B cannot see club X assignments');
select pg_temp.check((select count(*) from audit_log) = 1, 'B sees only own club audit log');
select pg_temp.fails(format('select transfer_player(%L, %L, %L)', :NOAM, :T3, 'move'), 'B moving a player out of club X');
update teams set club_id = (select club_id from clubs limit 0) where id = :T3;
select pg_temp.check((select c.name from teams t join clubs c on c.id = t.club_id where t.id = :T3) = 'הפועל דרום', 'club follows the team''s program; direct club_id edits are ignored');
select pg_temp.as_user(null);

select p.id as xprog from club_programs p join teams t on t.club_id = p.club_id where t.id = :T1 and p.kind = 'league' \gset
select pg_temp.as_user(:E);
select pg_temp.check((select count(*) from clubs) = 0, 'stranger sees no draft clubs');
select pg_temp.check((select count(*) from players) = 0, 'stranger sees no players');
-- E is admin of independent T4; may not push it into club X
select pg_temp.fails(format('update teams set program_id = %L where id = %L', :'xprog', :T4),
                     'team admin putting a team into a club they do not run');
select pg_temp.as_user(null);

-- ------------------------------------------------------ programs & moves
select pg_temp.as_user(:A);
select pg_temp.check((select count(*) from clubs) = 1, 'A sees own club');
select set_team_program(:T2, (select p.id from club_programs p join teams t on t.club_id = p.club_id where t.id = :T2 and p.kind = 'academy'));
select pg_temp.check((select p.kind from teams t join club_programs p on p.id = t.program_id where t.id = :T2) = 'academy', 'A moves T2 into academy program');
select pg_temp.fails(format('delete from teams where id = %L', :T1), 'deleting a team from the app');
select pg_temp.fails(format('delete from players where id = %L', :NOAM), 'deleting a player from the app');
select pg_temp.fails(format('update players set team_id = %L where id = %L', :T2, :NOAM), 'changing players.team_id directly');

-- parallel: Noam (league T1) also joins academy T2 with shirt 10
select transfer_player(:NOAM, :T2, 'add', null, 'מצטרף לאימוני אקדמיה', 10);
select pg_temp.check((select count(*) from player_assignments where player_id = :NOAM and ended_on is null) = 2, 'parallel: Noam in league and academy');
select pg_temp.check((select team_id from players where id = :NOAM) = :T1, 'parallel: main team stays the league team');
select pg_temp.fails(format('select transfer_player(%L, %L, %L)', :NOAM, :T2, 'add'), 'adding a player twice to the same team');
select pg_temp.as_user(null);

select pg_temp.as_user(:D);
select pg_temp.check(exists (select 1 from players where id = :NOAM), 'academy coach sees the parallel player');
select pg_temp.check(not exists (select 1 from players where id = '20000000-0000-0000-0000-000000000002'), 'academy coach does not see league-only player');
select pg_temp.check(exists (select 1 from player_absences where player_id = :NOAM), 'academy coach sees absences of a player in their team');
select pg_temp.fails(format('select transfer_player(%L, %L, %L)', '20000000-0000-0000-0000-000000000002', :T2, 'add'), 'coach (not club admin) transferring');
select pg_temp.as_user(null);

-- move: Itay leaves the league team for the academy team
select pg_temp.as_user(:A);
select transfer_player('20000000-0000-0000-0000-000000000002', :T2, 'move', :T1, 'החלטה מקצועית', 9);
select pg_temp.check((select team_id from players where id = '20000000-0000-0000-0000-000000000002') = :T2, 'move: main team is now academy');
select pg_temp.check((select count(*) from player_assignments where player_id = '20000000-0000-0000-0000-000000000002') = 2, 'move: old assignment kept as history');
select pg_temp.check((select ended_on from player_assignments where player_id = '20000000-0000-0000-0000-000000000002' and team_id = :T1) = current_date, 'move: old assignment ended today');
-- Noam ends the league assignment; academy becomes main
select end_player_assignment(:NOAM, :T1, 'עבר לאקדמיה בלבד');
select pg_temp.check((select team_id from players where id = :NOAM) = :T2, 'end: remaining team becomes main');
select pg_temp.check((select shirt_number from players where id = :NOAM) = 10, 'end: shirt number follows main team');
select pg_temp.check((select count(*) from player_transfers where player_id = :NOAM) = 2, 'history: add + end recorded');
select pg_temp.check((select count(*) from player_absences where player_id = :NOAM) = 1, 'history: absences kept after transfer');
select pg_temp.check((select count(*) from audit_log where action like 'player.%') = 3, 'audit: every transfer logged');
select pg_temp.as_user(null);

-- the parent still sees the child and the whole history
select pg_temp.as_user(:C);
select pg_temp.check(exists (select 1 from players where id = :NOAM), 'parent still sees child after transfer');
select pg_temp.check((select count(*) from player_transfers where player_id = :NOAM) = 2, 'parent sees transfer history');
select pg_temp.check(not exists (select 1 from players where id = '20000000-0000-0000-0000-000000000002'), 'parent no longer sees a teammate who left');
select pg_temp.as_user(null);

-- adding a player the old way still creates an assignment
select pg_temp.as_user(:A);
select add_my_child(:T1, 'שירה', 'לוי', 11, '', 2017);
select pg_temp.check((select count(*) from player_assignments a join players p on p.id = a.player_id where p.first_name = 'שירה' and a.team_id = :T1 and a.is_primary) = 1, 'legacy add_my_child creates assignment');
-- create a new club
select create_club('בית"ר מרכז', 'ירושלים');
select pg_temp.check((select count(*) from clubs) = 2, 'A sees both own clubs');
select pg_temp.fails(format('select set_club_status(%L, %L)', (select id from clubs where name like 'בית%'), 'verified'), 'club owner verifying own club');
select pg_temp.as_user(null);

-- platform admin
insert into platform_admins (user_id) values (:E);
select pg_temp.as_user(:E);
select set_club_status((select id from clubs where name like 'בית%'), 'verified');
select pg_temp.check((select count(*) from clubs) = 3, 'platform admin sees every club');
select pg_temp.as_user(null);
select pg_temp.as_user(:B);
select pg_temp.check((select count(*) from clubs) = 2, 'verified club is visible in the directory');
select pg_temp.as_user(null);
