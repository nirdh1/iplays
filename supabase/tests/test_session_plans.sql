-- RLS and RPC tests for 20261106300000_session_plans.sql.
-- Runs on the local test database after the migrations, the synthetic seed and the exercise library.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-0000000000c1', 'coach1@test.invalid'),
  ('e1000000-0000-4000-8000-0000000000c3', 'asst@test.invalid'),
  ('e1000000-0000-4000-8000-0000000000c2', 'coach2@test.invalid'),
  ('e1000000-0000-4000-8000-0000000000a1', 'parent1@test.invalid'),
  ('e1000000-0000-4000-8000-0000000000e1', 'superadmin@test.invalid');
insert into team_members (team_id, user_id, role) values
  ('5ea00000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000c1', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000c3', 'assistant_coach'),
  ('5ea00000-0000-4000-8000-0000000000b2', 'e1000000-0000-4000-8000-0000000000c2', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000a1', 'parent');
insert into platform_admins (user_id) values ('e1000000-0000-4000-8000-0000000000e1');

create temp table r (k text, v text);
grant all on r to authenticated;
create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000c1');
-- 90 minutes: warm-up 15 + stations (4 stations, 4 rounds × 12 + 3 × 2 = 54) + break 3 + game 18
insert into ids select 'plan', save_session_plan(null, '5ea00000-0000-4000-8000-0000000000b1', jsonb_build_object(
  'title', 'אימון מסירות', 'goal', 'מסירה וקבלה', 'status', 'ready',
  'blocks', jsonb_build_array(
    jsonb_build_object('kind', 'exercise', 'duration_min', 15, 'exercise_id', (select id from exercises where scope = 'iplays' order by title limit 1)),
    jsonb_build_object('kind', 'stations', 'title', 'תחנות', 'groups', 4, 'rounds', 4, 'station_min', 12, 'transition_min', 2,
      'stations', jsonb_build_array(
        jsonb_build_object('exercise_id', (select id from exercises where scope = 'iplays' order by title limit 1 offset 1), 'responsible', 'מאמן'),
        jsonb_build_object('exercise_id', (select id from exercises where scope = 'iplays' order by title limit 1 offset 2), 'responsible', 'עוזר'),
        jsonb_build_object('title', 'כדרור חופשי'),
        jsonb_build_object('title', 'בעיטות'))),
    jsonb_build_object('kind', 'break', 'title', 'שתייה', 'duration_min', 3),
    jsonb_build_object('kind', 'exercise', 'title', 'משחק', 'duration_min', 18))));
insert into r select 'total', (session_plan_json((select id from ids where k = 'plan')) ->> 'total_min');
insert into r select 'list_total', total_min::text from team_session_plans('5ea00000-0000-4000-8000-0000000000b1');
do $$ begin perform save_session_plan(null, '5ea00000-0000-4000-8000-0000000000b1', '{"title":"x2","blocks":[{"kind":"stations","groups":2,"rounds":3,"station_min":5,"transition_min":1,"stations":[{"title":"a"},{"title":"b"}]}]}');
  insert into r values ('rounds_gt_stations', 'ALLOWED'); exception when others then insert into r values ('rounds_gt_stations', 'denied'); end $$;
do $$ begin perform save_session_plan(null, '5ea00000-0000-4000-8000-0000000000b2', '{"title":"לא שלי","blocks":[]}');
  insert into r values ('c1_other_team', 'ALLOWED'); exception when others then insert into r values ('c1_other_team', 'denied'); end $$;
insert into ids select 'session', id from training_sessions where team_id = '5ea00000-0000-4000-8000-0000000000b1' and starts_at > now() order by starts_at limit 1;
select assign_session_plan((select id from ids where k = 'session'), (select id from ids where k = 'plan'));
-- later edit does not change the frozen snapshot
select save_session_plan((select id from ids where k = 'plan'), null, '{"title":"שם חדש","blocks":[]}');
insert into r select 'snapshot_title', snapshot ->> 'title' from session_plan_assignments where session_id = (select id from ids where k = 'session');
insert into r select 'snapshot_blocks', jsonb_array_length(snapshot -> 'blocks')::text from session_plan_assignments where session_id = (select id from ids where k = 'session');
do $$ begin insert into session_plans (team_id, title) values ('5ea00000-0000-4000-8000-0000000000b1', 'ישיר');
  insert into r values ('direct_insert', 'ALLOWED'); exception when others then insert into r values ('direct_insert', 'denied'); end $$;

-- assistant: reads and writes the team's plans
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000c3');
insert into r select 'asst_sees', count(*)::text from session_plans;
insert into r select 'asst_write', (save_session_plan((select id from ids where k = 'plan'), null, '{"title":"עוזר ערך","blocks":[]}') is not null)::text;

-- coach of another team: nothing; cannot assign
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000c2');
insert into r select 'c2_sees', count(*)::text from session_plans;
insert into r select 'c2_json', coalesce(session_plan_json((select id from ids where k = 'plan'))::text, 'null');
do $$ begin perform assign_session_plan((select id from ids where k = 'session'), (select id from ids where k = 'plan'));
  insert into r values ('c2_assign', 'ALLOWED'); exception when others then insert into r values ('c2_assign', 'denied'); end $$;

-- parent: no plan tables, only title + goal of the training's plan
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
insert into r select 'parent_sees_plans', count(*)::text from session_plans;
insert into r select 'parent_sees_assign', count(*)::text from session_plan_assignments;
insert into r select 'parent_summary', title || '|' || goal from session_plan_summary((select id from ids where k = 'session'));
insert into r select 'parent_json', coalesce(session_plan_json((select id from ids where k = 'plan'))::text, 'null');

-- platform admin: no plan content
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000e1');
insert into r select 'admin_sees', count(*)::text from session_plans;
reset role;

select k, v,
  case k when 'total' then v = '90' when 'list_total' then v = '90' when 'rounds_gt_stations' then v = 'denied'
         when 'c1_other_team' then v = 'denied' when 'snapshot_title' then v = 'אימון מסירות' when 'snapshot_blocks' then v = '4'
         when 'direct_insert' then v = 'denied' when 'asst_sees' then v = '1' when 'asst_write' then v = 'true'
         when 'c2_sees' then v = '0' when 'c2_json' then v = 'null' when 'c2_assign' then v = 'denied'
         when 'parent_sees_plans' then v = '0' when 'parent_sees_assign' then v = '0' when 'parent_summary' then v = 'אימון מסירות|מסירה וקבלה'
         when 'parent_json' then v = 'null' when 'admin_sees' then v = '0' else true end as ok
from r order by k;
rollback;
