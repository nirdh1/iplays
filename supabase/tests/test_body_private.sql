-- Body metrics, goals and nutrition: only the child's parents see or edit them.
-- Runs after the other tests (uses the seed data: Noam, parent C, team admin A,
-- platform admin E) with 20261101985000_player_career.sql installed.
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
\set E '''00000000-0000-0000-0000-00000000000e'''
\set NOAM '''20000000-0000-0000-0000-000000000001'''
\set T1 '''10000000-0000-0000-0000-000000000001'''

select pg_temp.as_user(null);
insert into player_guardians (player_id, user_id, relation) values (:NOAM, :C, 'parent') on conflict do nothing;
-- D follows Noam as a family member (not a parent)
insert into player_guardians (player_id, user_id, relation) values (:NOAM, :D, 'family') on conflict do nothing;
insert into platform_admins (user_id) values (:E) on conflict do nothing;
-- a measurement entered by staff before this migration (must stay, but become parent-only)
insert into player_measurements (player_id, measured_on, height_cm, weight_kg, created_by)
values (:NOAM, current_date - 200, 128, 26, :A);

-- preconditions: A has full metrics rights on Noam's team, E is platform admin
select pg_temp.as_user(:A);
select pg_temp.check(can(:T1, 'metrics', 3) and can(:T1, 'roster', 3), 'precondition: A is full staff of Noam''s team');
select pg_temp.check(can_view_player(:NOAM), 'precondition: A sees Noam''s career');

select pg_temp.as_user(null);
\i supabase/migrations/20261102500000_body_goals_nutrition.sql

-- ------------------------------------------------------------- parent C
select pg_temp.as_user(:C);
select pg_temp.check(child_private_profile(:NOAM) is not null, 'parent opens the private area');
select pg_temp.check(jsonb_array_length(child_private_profile(:NOAM) -> 'measurements') = 1, 'parent sees the older staff-entered measurement');
select add_body_measurement(:NOAM, current_date - 10, '{"height_cm": 131.5, "weight_kg": 28.2, "waist_cm": 58, "chest_cm": 64}',
                            '[{"label": "היקף צוואר", "unit": "ס״מ", "value": 27}]', 'בבית');
select add_body_measurement(:NOAM, current_date, '{"height_cm": 132}', '[]', '');
select pg_temp.check(jsonb_array_length(child_private_profile(:NOAM) -> 'measurements') = 3, 'measurements are history (3 rows, none overwritten)');
select pg_temp.check((child_private_profile(:NOAM) -> 'measurements' -> 1 -> 'custom' -> 0 ->> 'label') = 'היקף צוואר', 'custom measure saved');
select pg_temp.check((select count(*) from player_measurements where player_id = :NOAM) = 3, 'parent reads the table directly through RLS');
select pg_temp.fails(format('select add_body_measurement(%L, current_date + 1, %L)', :NOAM, '{"height_cm": 130}'), 'measurement dated in the future');
select pg_temp.fails(format('select add_body_measurement(%L, current_date, %L)', :NOAM, '{}'), 'empty measurement');
select pg_temp.fails(format('select add_body_measurement(%L, current_date, %L, %L)', :NOAM, '{}', '[{"label": "", "value": 1}]'), 'custom measure without a name');
select pg_temp.fails(format('select add_body_measurement(%L, current_date, %L)', :NOAM, '{"height_cm": 900}'), 'impossible height');
select pg_temp.fails(format('insert into player_measurements (player_id, height_cm) values (%L, 120)', :NOAM), 'direct insert into measurements (RPC only)');

create temp table ids (k text, id uuid);
grant all on ids to authenticated;
insert into ids select 'g1', save_child_goal(:NOAM, null, 'ספרינט מהיר יותר', 'speed', 'לרדת מתחת ל-5.5 שניות', current_date - 30, current_date + 60,
                                    'number', 'ספרינט 30 מ׳', 'שניות', 6.1, 5.5, 'active');
insert into ids select 'g2', save_child_goal(:NOAM, null, 'רגל שמאל', 'weak_foot', '', current_date, null, 'percent', '', '', null, null, 'active');
select add_child_goal_progress((select id from ids where k = 'g1'), current_date - 15, 5.9, 'אימון אישי');
select add_child_goal_progress((select id from ids where k = 'g1'), current_date, 5.7, '');
select add_child_goal_progress((select id from ids where k = 'g2'), current_date, 40, '');
select pg_temp.fails(format('select add_child_goal_progress(%L, current_date, 140)', (select id from ids where k = 'g2')), 'percent progress over 100');
select pg_temp.fails(format('select save_child_goal(%L, null, %L, %L, %L, current_date, null, %L, %L, %L, null, null)', :NOAM, 'x', 'speed', '', 'number', '', ''), 'number goal without baseline / target');
select pg_temp.fails(format('select save_child_goal(%L, null, %L, %L, %L, current_date, current_date - 1, %L, %L, %L, null, null)', :NOAM, 'x', 'speed', '', 'percent', '', ''), 'target date before start');
select set_child_goal_status((select id from ids where k = 'g2'), 'achieved');
select pg_temp.check(jsonb_array_length(child_private_profile(:NOAM) -> 'goals') = 2, 'parent sees 2 goals');
select pg_temp.check((select jsonb_array_length(g -> 'progress') from jsonb_array_elements(child_private_profile(:NOAM) -> 'goals') g
                      where g ->> 'title' = 'ספרינט מהיר יותר') = 2, 'goal progress history (2 entries)');
select pg_temp.check((select status from child_goals where id = (select id from ids where k = 'g2')) = 'achieved', 'goal status changed');

select save_child_nutrition(:NOAM, 'אוהב פסטה', array['sesame', 'peanuts', 'sesame'], '', array['kosher'], '', 'ראשון ושלישי 17:00', 'בקבוק מים גדול');
select pg_temp.check((child_private_profile(:NOAM) -> 'nutrition' -> 'allergies') = '["peanuts", "sesame"]'::jsonb, 'nutrition saved (allergies deduplicated)');
select save_child_nutrition(:NOAM, 'אוהב פסטה ואורז', array['peanuts'], '', array['kosher'], '', '', '');
select pg_temp.check((select preferences from child_nutrition where player_id = :NOAM) = 'אוהב פסטה ואורז', 'nutrition updated in place');
select pg_temp.fails(format('select save_child_nutrition(%L, %L, array[%L], %L, %L::text[], %L, %L, %L)', :NOAM, '', 'chocolate', '', '{}', '', '', ''), 'allergy not in the list');

-- player_career no longer carries measurements, for anyone
select pg_temp.check((player_career(:NOAM) -> 'measurements') = 'null'::jsonb, 'player_career: measurements null even for the parent');
select pg_temp.check((player_career(:NOAM) ->> 'can_edit_measurements')::boolean = false, 'player_career: can_edit_measurements false');

-- --------------------------------------------- everyone else is locked out
create or replace function pg_temp.locked_out(p uuid, p_who text) returns void language plpgsql as $$
declare
  g1 uuid := (select id from ids where k = 'g1');
  m1 uuid;
begin
  reset role;
  select id into m1 from player_measurements where player_id = '20000000-0000-0000-0000-000000000001' and deleted_at is null limit 1;
  perform pg_temp.as_user(p);
  perform pg_temp.check(child_private_profile('20000000-0000-0000-0000-000000000001') is null, p_who || ': private area is null');
  perform pg_temp.check((select count(*) from player_measurements where player_id = '20000000-0000-0000-0000-000000000001') = 0, p_who || ': no measurement rows (RLS)');
  perform pg_temp.check((select count(*) from child_goals where player_id = '20000000-0000-0000-0000-000000000001') = 0, p_who || ': no goal rows (RLS)');
  perform pg_temp.check((select count(*) from child_goal_progress) = 0, p_who || ': no progress rows (RLS)');
  perform pg_temp.check((select count(*) from child_nutrition) = 0, p_who || ': no nutrition rows (RLS)');
  perform pg_temp.check(coalesce(player_career('20000000-0000-0000-0000-000000000001') -> 'measurements', 'null'::jsonb) = 'null'::jsonb, p_who || ': no measurements in player_career');
  perform pg_temp.fails(format('select add_body_measurement(%L, current_date, %L)', '20000000-0000-0000-0000-000000000001', '{"height_cm": 140}'), p_who || ': add measurement');
  perform pg_temp.fails(format('select add_player_measurement(%L, current_date, 140, null, null, null, null)', '20000000-0000-0000-0000-000000000001'), p_who || ': add measurement (old RPC)');
  perform pg_temp.fails(format('select remove_player_record(%L, %L)', 'measurement', m1), p_who || ': remove measurement');
  perform pg_temp.fails(format('select save_child_goal(%L, null, %L, %L, %L, current_date, null, %L, %L, %L, null, null)', '20000000-0000-0000-0000-000000000001', 'x', 'speed', '', 'percent', '', ''), p_who || ': add goal');
  perform pg_temp.fails(format('select save_child_goal(%L, %L, %L, %L, %L, current_date, null, %L, %L, %L, null, null)', '20000000-0000-0000-0000-000000000001', g1, 'x', 'speed', '', 'percent', '', ''), p_who || ': edit goal');
  perform pg_temp.fails(format('select add_child_goal_progress(%L, current_date, 5)', g1), p_who || ': add progress');
  perform pg_temp.fails(format('select set_child_goal_status(%L, %L)', g1, 'dropped'), p_who || ': change goal status');
  perform pg_temp.fails(format('select remove_child_goal_record(%L, %L)', 'goal', g1), p_who || ': remove goal');
  perform pg_temp.fails(format('select save_child_nutrition(%L, %L, %L::text[], %L, %L::text[], %L, %L, %L)', '20000000-0000-0000-0000-000000000001', 'x', '{}', '', '{}', '', '', ''), p_who || ': save nutrition');
  perform pg_temp.fails(format('update child_goals set title = %L', 'hacked'), p_who || ': direct update of goals');
  perform pg_temp.fails('delete from child_nutrition', p_who || ': direct delete of nutrition');
end;
$$;
select pg_temp.locked_out(:A, 'team admin / coach with full rights');
select pg_temp.locked_out(:E, 'platform admin');
select pg_temp.locked_out(:D, 'family follower (not a parent)');
select pg_temp.locked_out(:B, 'admin of another club');

-- club owner / admin of Noam's club
select pg_temp.as_user(null);
select t.club_id as club from teams t where t.id = :T1 \gset
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'clubowner@test') on conflict do nothing;
insert into club_staff (club_id, user_id, role) values (:'club', '00000000-0000-0000-0000-0000000000c1', 'owner') on conflict do nothing;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check(is_club_admin(:'club'), 'precondition: club owner');
select pg_temp.locked_out('00000000-0000-0000-0000-0000000000c1', 'club owner');

-- anon has no grant at all
select pg_temp.as_user(null);
set role anon;
select pg_temp.fails('select count(*) from child_goals', 'anon reads goals');
select pg_temp.fails('select count(*) from player_measurements', 'anon reads measurements');
select pg_temp.fails(format('select child_private_profile(%L)', :NOAM), 'anon calls child_private_profile');
reset role;

-- ------------------------------------------------- parent removes records
select pg_temp.as_user(:C);
select remove_child_goal_record('progress', (select (g -> 'progress' -> 0 ->> 'id')::uuid
  from jsonb_array_elements(child_private_profile(:NOAM) -> 'goals') g where g ->> 'title' = 'ספרינט מהיר יותר'));
select remove_child_goal_record('goal', (select id from ids where k = 'g2'));
select pg_temp.check(jsonb_array_length(child_private_profile(:NOAM) -> 'goals') = 1, 'parent removed a goal (soft)');
select remove_player_record('measurement', (select (child_private_profile(:NOAM) -> 'measurements' -> 0 ->> 'id')::uuid));
select pg_temp.check(jsonb_array_length(child_private_profile(:NOAM) -> 'measurements') = 2, 'parent removed a measurement (soft)');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from player_measurements where player_id = :NOAM) = 3, 'soft delete keeps the row');

-- migration runs twice without error
\i supabase/migrations/20261102500000_body_goals_nutrition.sql
select pg_temp.check((select count(*) from child_goals) = 2, 're-run keeps data');
