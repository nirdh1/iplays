-- Checks for 20261103500000_team_contacts.sql. Run on a TEST database only (it inserts users/teams):
-- local Postgres with Supabase stubs, all migrations applied, then: psql -f this file.
-- Every line starting with "ok" or "t" is a pass; the script stops on the first unexpected error.
\set ON_ERROR_STOP 1
-- people: A, A2 parents of Dani (team 1); B parent of Yael and Ron (team 1);
-- F follower (grandma) of Yael; C coach of team 1; S assistant coach of team 1;
-- K owner of team 1's club; X parent of Omer (team 2); P platform admin.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','a@x.com','{"full_name":"אמא של דני"}'),
 ('00000000-0000-0000-0000-0000000000a2','a2@x.com','{"full_name":"אבא של דני"}'),
 ('00000000-0000-0000-0000-00000000000b','b@x.com','{"full_name":"אמא של יעל"}'),
 ('00000000-0000-0000-0000-00000000000f','f@x.com','{"full_name":"סבתא של יעל"}'),
 ('00000000-0000-0000-0000-00000000000c','c@x.com','{"full_name":"המאמן"}'),
 ('00000000-0000-0000-0000-000000000005','s@x.com','{"full_name":"עוזר מאמן"}'),
 ('00000000-0000-0000-0000-0000000000c1','k@x.com','{"full_name":"מנהל המועדון"}'),
 ('00000000-0000-0000-0000-0000000000ee','x@x.com','{"full_name":"הורה מקבוצה אחרת"}'),
 ('00000000-0000-0000-0000-0000000000ad','p@x.com','{"full_name":"סופר אדמין"}');
update profiles set full_name = (select raw_user_meta_data->>'full_name' from auth.users u where u.id = profiles.id);
insert into clubs (id, name) values ('c0000000-0000-0000-0000-000000000001', 'מועדון בדיקה');
insert into teams (id, name, created_by, club_id) values
 ('10000000-0000-0000-0000-000000000001','ילדים א','00000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','קבוצה אחרת','00000000-0000-0000-0000-0000000000ee', null);
delete from team_members;
insert into team_members (team_id,user_id,role,is_follower) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','parent',false),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','parent',false),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','parent',false),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000f','parent',true),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','coach',false),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','assistant_coach',false),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000ee','parent',false);
insert into club_staff (club_id, user_id, role) values ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','owner');
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000ad') on conflict do nothing;
insert into players (id, team_id, first_name, last_name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','דני','כהן'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','יעל','לוי'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','רון','לוי'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ילד','בלי משפחה'),
 ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','עומר','זר');
insert into player_assignments (player_id, team_id)
 select id, team_id from players where id::text like '20000000-%'
   and not exists (select 1 from player_assignments a where a.player_id = players.id);
insert into player_guardians (player_id, user_id, relation, kinship) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','parent','אמא'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','parent','אבא'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','parent','אמא'),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000b','parent','אמא'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000f','family','סבתא'),
 ('20000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000ee','parent','אבא');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('role', 'authenticated', false); $$;
create function pg_temp.expect_fail(q text, frag text) returns text language plpgsql as $$
begin
  execute q; return 'UNEXPECTED SUCCESS: ' || q;
exception when others then
  if position(frag in sqlerrm) > 0 then return 'ok (blocked: ' || sqlerrm || ')'; end if;
  raise exception 'WRONG ERROR for %: %', q, sqlerrm;
end $$;
create function pg_temp.check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  return 'ok ' || what;
end $$;
-- the contacts of one child as the caller sees them in the team directory
create function pg_temp.dir_person(p_team uuid, p_player text, p_name text) returns jsonb language sql as $$
  select c from jsonb_array_elements(team_directory(p_team)->'players') pl, jsonb_array_elements(pl->'contacts') c
  where pl->>'player_id' = p_player and c->>'name' = p_name; $$;
grant execute on all functions in schema pg_temp to authenticated;
\set t1 '\'10000000-0000-0000-0000-000000000001\''
\set t2 '\'10000000-0000-0000-0000-000000000002\''

\echo '=== 1. a parent updates their own details'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select save_my_contact_card('אמא של דני', '050-1234567', '', 'mom.dani@x.com', 'הרצל', '12', 'תל אביב');
select pg_temp.check(my_contact_card()->>'phone' = '050-1234567', 'own phone saved in profiles');
select pg_temp.check(my_contact_card()->>'city' = 'תל אביב', 'own address saved');
select pg_temp.check((my_contact_card()->'sharing'->>'phone')::boolean = false, 'sharing defaults to off');
select pg_temp.expect_fail($q$select save_my_contact_card('x', 'abc', '', '', '', '', '')$q$, 'bad phone');
select pg_temp.expect_fail($q$select save_my_contact_card('x', '', '', 'not-an-email', '', '', '')$q$, 'bad email');
select pg_temp.expect_fail($q$select save_my_contact_card('x', '', '', 'a@b.c"><script>', '', '', '')$q$, 'bad email');
select save_player_phone('20000000-0000-0000-0000-000000000001', '052-7654321');
select save_extra_contact(null, '20000000-0000-0000-0000-000000000001', 'מטפלת רותי', 'מטפלת', '054-1111111', '', false, false, false) is not null as extra_added;

\echo '--- B saves details too'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select save_my_contact_card('אמא של יעל', '+972 50 9999999', '050-8888888', '', 'ויצמן', '3', 'רמת גן');

\echo '=== 2. a parent cannot change another parent (or another family''s child)'
select pg_temp.expect_fail($q$update contact_details set city = 'hack'$q$, 'permission denied');
select pg_temp.expect_fail($q$insert into contact_details (user_id, city) values ('00000000-0000-0000-0000-00000000000a', 'hack')$q$, 'permission denied');
update profiles set phone = '000' where id = '00000000-0000-0000-0000-00000000000a'; -- RLS: 0 rows
select pg_temp.expect_fail($q$select save_player_phone('20000000-0000-0000-0000-000000000001', '050-0000000')$q$, 'not allowed');
select pg_temp.expect_fail($q$select set_player_phone_share('20000000-0000-0000-0000-000000000001', true)$q$, 'not allowed');
select pg_temp.expect_fail($q$select save_extra_contact(null, '20000000-0000-0000-0000-000000000001', 'x', '', '', '', true, true, true)$q$, 'not allowed');
select pg_temp.expect_fail($q$select remove_extra_contact((select (c->>'id')::uuid from jsonb_array_elements(team_directory('10000000-0000-0000-0000-000000000001')->'players') pl, jsonb_array_elements(pl->'contacts') c where c->>'kind' = 'extra' limit 1))$q$, 'not allowed');
select pg_temp.expect_fail($q$update player_contacts set share_phone = true$q$, 'permission denied');
select pg_temp.expect_fail($q$select contacts_people('20000000-0000-0000-0000-000000000001', true)$q$, 'permission denied');
reset role;
select pg_temp.check((select phone from profiles where id = '00000000-0000-0000-0000-00000000000a') = '050-1234567', 'A phone unchanged');

\echo '=== 3. hidden details are not visible to other parents (UI and API)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני') is not null, 'B sees A''s name');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' is null, 'B: A phone hidden');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'email' is null, 'B: A e-mail hidden');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->'address' = 'null'::jsonb, 'B: A address hidden');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->'sharing' = 'null'::jsonb, 'B: A sharing switches not sent');
select pg_temp.check((select pl->>'phone' from jsonb_array_elements(team_directory(:t1)->'players') pl where pl->>'player_id' = '20000000-0000-0000-0000-000000000001') is null, 'B: Dani phone hidden');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'מטפלת רותי')->>'phone' is null, 'B: Dani nanny phone hidden');
select pg_temp.check((select count(*) from contact_details where user_id <> auth.uid()) = 0, 'B: no other rows in contact_details');
select pg_temp.check((select count(*) from player_contacts) = 0, 'B: no rows in player_contacts (B''s kids have none)');
select pg_temp.check((select count(*) from player_extra_contacts) = 0, 'B: no rows of Dani''s extra contacts');
select pg_temp.expect_fail($q$select phone from profiles$q$, 'permission denied');
select pg_temp.expect_fail($q$select email from profiles where id = '00000000-0000-0000-0000-00000000000a'$q$, 'permission denied');
select pg_temp.expect_fail($q$select * from profiles$q$, 'permission denied');
select pg_temp.check((select count(*) from profiles where full_name <> '') > 1, 'B still reads team mates'' names');
select pg_temp.check(player_contact_book('20000000-0000-0000-0000-000000000001') is null, 'B: Dani contact book closed');
\echo '--- the other parent of the same child sees only what was shared'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' is null, 'A2: A phone hidden');
select pg_temp.check((select pl->>'phone' from jsonb_array_elements(team_directory(:t1)->'players') pl where pl->>'player_id' = '20000000-0000-0000-0000-000000000001') = '052-7654321', 'A2 (family) sees Dani phone');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'מטפלת רותי')->>'phone' = '054-1111111', 'A2 sees own child''s nanny');
select pg_temp.check((player_contact_book('20000000-0000-0000-0000-000000000001')->>'can_edit')::boolean, 'A2 (parent) can edit Dani contacts');

\echo '=== 4. the team''s coach sees every family in the team (also through the table)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((team_directory(:t1)->>'full_access')::boolean, 'coach: full access');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' = '050-1234567', 'coach: A phone');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->'address'->>'street' = 'הרצל', 'coach: A address');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'email' = 'mom.dani@x.com', 'coach: A e-mail');
select pg_temp.check((select pl->>'phone' from jsonb_array_elements(team_directory(:t1)->'players') pl where pl->>'player_id' = '20000000-0000-0000-0000-000000000001') = '052-7654321', 'coach: Dani phone');
select pg_temp.check((select count(*) from contact_details) = 2, 'coach: RLS rows of the team''s families');
select pg_temp.check(player_contact_book('20000000-0000-0000-0000-000000000001')->>'phone' = '052-7654321', 'coach: player profile contacts');
select pg_temp.check(not (player_contact_book('20000000-0000-0000-0000-000000000001')->>'can_edit')::boolean, 'coach: no edit rights');
select pg_temp.expect_fail($q$select save_player_phone('20000000-0000-0000-0000-000000000001', '050-0000000')$q$, 'not allowed');
select pg_temp.check((team_directory(:t1)->>'without_family')::int = 1, 'kids without family counted, not listed');
select pg_temp.check(jsonb_array_length(team_directory(:t1)->'players') = 3, '3 kids with family listed');
\echo '--- an assistant coach is not a manager: shared details only'
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.check(not (team_directory(:t1)->>'full_access')::boolean, 'assistant: no full access');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' is null, 'assistant: A phone hidden');

\echo '=== 5. the club owner sees every family of the club'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check((team_directory(:t1)->>'full_access')::boolean, 'club owner: full access');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000002', 'אמא של יעל')->>'whatsapp' = '050-8888888', 'club owner: B WhatsApp');
select pg_temp.check((select count(*) from contact_details) = 2, 'club owner: RLS rows');
select pg_temp.expect_fail($q$select team_directory('10000000-0000-0000-0000-000000000002')$q$, 'not allowed');
\echo '--- the platform admin: read only'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ad');
select pg_temp.check(pg_temp.dir_person(:t2, '20000000-0000-0000-0000-000000000005', 'הורה מקבוצה אחרת') is not null, 'platform admin sees team 2');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' = '050-1234567', 'platform admin: A phone');
select pg_temp.expect_fail($q$select set_player_phone_share('20000000-0000-0000-0000-000000000001', true)$q$, 'not allowed');

\echo '=== 7. someone from another team, a follower and anon cannot open the directory'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ee');
select pg_temp.expect_fail($q$select team_directory('10000000-0000-0000-0000-000000000001')$q$, 'not allowed');
select pg_temp.check(player_contact_book('20000000-0000-0000-0000-000000000001') is null, 'X: player contact book closed');
select pg_temp.check((select count(*) from contact_details where user_id <> auth.uid()) + (select count(*) from player_contacts) + (select count(*) from player_extra_contacts) = 0, 'X: no rows');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.expect_fail($q$select team_directory('10000000-0000-0000-0000-000000000001')$q$, 'not allowed');
select pg_temp.check(player_contact_book('20000000-0000-0000-0000-000000000002') is not null, 'follower still sees own grandchild''s contacts');
select pg_temp.check(not (player_contact_book('20000000-0000-0000-0000-000000000002')->>'can_edit')::boolean, 'follower cannot edit');
reset role; select set_config('request.jwt.claim.sub','',false); set role anon;
select pg_temp.expect_fail($q$select count(*) from contact_details$q$, 'permission denied');
select pg_temp.expect_fail($q$select team_directory('10000000-0000-0000-0000-000000000001')$q$, 'permission denied');
reset role;

\echo '=== 8. sharing switches apply at once'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_my_contact_share('phone', true);
select set_my_contact_share('whatsapp', true);
select set_my_contact_share('address', true);
select set_player_phone_share('20000000-0000-0000-0000-000000000001', true);
select save_extra_contact((select id from player_extra_contacts limit 1), '20000000-0000-0000-0000-000000000001', 'מטפלת רותי', 'מטפלת', '054-1111111', '', true, false, false) is not null as extra_shared;
select pg_temp.expect_fail($q$select set_my_contact_share('password', true)$q$, 'bad field');
select pg_temp.check((my_contact_card()->'sharing'->>'phone')::boolean, 'A: switch saved');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' = '050-1234567', 'B now sees A phone');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'whatsapp' = '050-1234567', 'B sees A WhatsApp (= phone)');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->'address'->>'city' = 'תל אביב', 'B sees A address');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'email' is null, 'B: A e-mail still hidden');
select pg_temp.check((select pl->>'phone' from jsonb_array_elements(team_directory(:t1)->'players') pl where pl->>'player_id' = '20000000-0000-0000-0000-000000000001') = '052-7654321', 'B sees Dani phone after parent approved');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'מטפלת רותי')->>'phone' = '054-1111111', 'B sees shared nanny phone');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'מטפלת רותי')->>'whatsapp' is null, 'nanny WhatsApp still hidden');
select pg_temp.check((select count(*) from contact_details where user_id <> auth.uid()) = 0, 'B: still no direct rows (shared only through the directory)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_my_contact_share('phone', false);
select set_my_contact_share('whatsapp', false);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(pg_temp.dir_person(:t1, '20000000-0000-0000-0000-000000000001', 'אמא של דני')->>'phone' is null, 'B: A phone hidden again');

\echo '=== one family, several children: B appears under both kids, with own switches'
select pg_temp.check((select count(*) from jsonb_array_elements(team_directory(:t1)->'players') pl, jsonb_array_elements(pl->'contacts') c where c->>'user_id' = '00000000-0000-0000-0000-00000000000b') = 2, 'B under Yael and Ron');
select pg_temp.check((select bool_and((c->>'is_me')::boolean and c->'sharing' is not null) from jsonb_array_elements(team_directory(:t1)->'players') pl, jsonb_array_elements(pl->'contacts') c where c->>'user_id' = '00000000-0000-0000-0000-00000000000b'), 'B is_me + own switches');
reset role;
\echo 'ALL CONTACTS TESTS PASSED'
