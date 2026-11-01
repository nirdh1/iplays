-- Account types (parent / club). Runs after test_ifa_games.sql.
\set ON_ERROR_STOP on
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_what; end if;
  raise notice 'ok  %', p_what;
end;
$$;
select pg_temp.check((select count(*) from profiles where account_types is null) = 0, 'every profile has account types');
select pg_temp.check(not exists (select 1 from club_staff s join profiles p on p.id = s.user_id where not 'club' = any(p.account_types)),
                     'existing club staff got "club"');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'kinds@test');
select pg_temp.check((select account_types from profiles where id = '00000000-0000-0000-0000-0000000000b1') = '{parent}', 'new user defaults to parent');
update profiles set account_types = '{parent,club}' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.check((select cardinality(account_types) from profiles where id = '00000000-0000-0000-0000-0000000000b1') = 2, 'parent and club together');
do $$ begin
  begin
    update profiles set account_types = '{admin}' where id = '00000000-0000-0000-0000-0000000000b1';
    raise exception 'FAIL: unknown account type accepted';
  exception when check_violation then raise notice 'ok  unknown account type refused';
  end;
  begin
    update profiles set account_types = '{}' where id = '00000000-0000-0000-0000-0000000000b1';
    raise exception 'FAIL: empty account types accepted';
  exception when check_violation then raise notice 'ok  empty account types refused';
  end;
end $$;
