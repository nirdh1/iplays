-- A parent leaves a child; the Super Admin removes someone's link to a child.
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

\set ADM '''00000000-0000-0000-0000-0000000000e1'''
\set PA '''00000000-0000-0000-0000-0000000000e2'''
\set PB '''00000000-0000-0000-0000-0000000000e3'''
\set TT '''10000000-0000-0000-0000-0000000000e1'''
\set K1 '''20000000-0000-0000-0000-0000000000e1'''
\set K2 '''20000000-0000-0000-0000-0000000000e2'''

select pg_temp.as_user(null);
insert into auth.users (id, email) values (:ADM, 'adm@test'), (:PA, 'pa@test'), (:PB, 'impostor@test');
insert into platform_admins (user_id) values (:ADM) on conflict do nothing;
update profiles set full_name = 'הורה אמיתי' where id = :PA;
insert into teams (id, name, club, sport, created_by) values (:TT, 'הסרה FC', 'בדיקה', 'football', :PA);
insert into team_members (team_id, user_id, role) values (:TT, :PA, 'parent'), (:TT, :PB, 'parent');
insert into players (id, team_id, first_name, last_name, birth_year, created_by) values
  (:K1, :TT, 'יונתן', 'הסרה', 2016, :PA), (:K2, :TT, 'נועה', 'הסרה', 2018, :PA);
insert into player_guardians (player_id, user_id, relation) values (:K1, :PA, 'parent'), (:K2, :PA, 'parent'), (:K1, :PB, 'parent');

-- ------------------------------------------------ a parent leaves a child
select pg_temp.as_user(:PA);
select leave_child(:K2);
select pg_temp.as_user(null);
select pg_temp.check(not exists (select 1 from player_guardians where player_id = :K2 and user_id = :PA), 'parent left the wrong child');
select pg_temp.check(exists (select 1 from team_members where team_id = :TT and user_id = :PA), 'still in the team through the other child');
select pg_temp.as_user(:PA);
select pg_temp.fails(format('select leave_child(%L)', :K2), 'leave a child you are not linked to');

-- ------------------------------------------------------ the Super Admin
select pg_temp.fails('select * from admin_child_guardians(''הסרה'')', 'non-admin lists guardians');
select pg_temp.fails(format('select admin_remove_guardian(%L, %L)', :K1, :PB), 'non-admin removes a parent');

select pg_temp.as_user(:ADM);
select pg_temp.check((select count(*) from admin_child_guardians('יונתן') where player_id = :K1) = 2, 'admin finds the child with both "parents"');
select pg_temp.check((select count(*) from admin_child_guardians('impostor')) = 2, 'admin finds by a parent''s email');
select admin_remove_guardian(:K1, :PB, 'לא ההורה');
select pg_temp.as_user(null);
select pg_temp.check(not exists (select 1 from player_guardians where player_id = :K1 and user_id = :PB), 'admin removed the wrong parent');
select pg_temp.check(not exists (select 1 from team_members where team_id = :TT and user_id = :PB), 'removed parent left the team');
select pg_temp.check(exists (select 1 from player_guardians where player_id = :K1 and user_id = :PA), 'the real parent stays');
select pg_temp.check((select details ->> 'reason' from audit_log where action = 'family.admin_remove' order by id desc limit 1) = 'לא ההורה',
                     'removal and reason in the audit log');
