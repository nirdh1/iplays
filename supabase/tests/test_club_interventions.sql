-- RLS and RPC tests for 20261111100000_club_interventions.sql (phase A).
-- Runs on a local database after the Staging parts, the synthetic seed and
-- the migrations up to 20261109500000. Everything is rolled back at the end.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('e5000000-0000-4000-8000-0000000000c1', 'coach1@test.invalid'),
  ('e5000000-0000-4000-8000-0000000000c2', 'coach2@test.invalid'),
  ('e5000000-0000-4000-8000-0000000000c3', 'coach3@test.invalid'),
  ('e5000000-0000-4000-8000-0000000000a1', 'parent1@test.invalid'),
  ('e5000000-0000-4000-8000-0000000000d1', 'owner1@test.invalid'),
  ('e5000000-0000-4000-8000-0000000000e1', 'viewer1@test.invalid');
insert into profiles (id, full_name) values
  ('e5000000-0000-4000-8000-0000000000c1', 'מאמן בדיקה 1'), ('e5000000-0000-4000-8000-0000000000d1', 'בעלים בדיקה')
  on conflict (id) do update set full_name = excluded.full_name;
-- another club with its own team and coach
insert into clubs (id, name, status, created_by) values ('e5000000-0000-4000-8000-0000000000f2', 'מועדון אחר', 'verified', 'e5000000-0000-4000-8000-0000000000d1');
insert into teams (id, name, created_by, club_id) values ('e5000000-0000-4000-8000-0000000000f3', 'קבוצה אחרת', 'e5000000-0000-4000-8000-0000000000d1', 'e5000000-0000-4000-8000-0000000000f2');
-- a demo-club team without any training (missing data)
insert into teams (id, name, created_by, club_id) values ('e5000000-0000-4000-8000-0000000000f4', 'קבוצה ריקה', 'e5000000-0000-4000-8000-0000000000d1', '5ea00000-0000-4000-8000-000000000001');
insert into team_members (team_id, user_id, role) values
  ('5ea00000-0000-4000-8000-0000000000b1', 'e5000000-0000-4000-8000-0000000000c1', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b2', 'e5000000-0000-4000-8000-0000000000c2', 'coach'),
  ('e5000000-0000-4000-8000-0000000000f3', 'e5000000-0000-4000-8000-0000000000c3', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b1', 'e5000000-0000-4000-8000-0000000000a1', 'parent');
insert into club_staff (club_id, user_id, role) values ('5ea00000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000d1', 'owner');
-- club-wide "reports" viewer (level 1): sees everything, changes nothing
insert into permission_grants (club_id, user_id, domain, level) values
  ('5ea00000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000e1', 'reports', 1);

create temp table r (k text, v text);
create temp table ids (k text primary key, id uuid);
grant all on r, ids to authenticated, anon;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
$$;
-- expected baseline, computed as the database owner
insert into r select 'expected_b1_att', coalesce(intervention_metric_value('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1', 'attendance_pct', '{}')::text, 'null');

set local role authenticated;

-- owner opens; same insight again -> the same one (no duplicate)
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000d1');
insert into ids select 'b1', (open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1', 'attendance_drop',
  'הנוכחות יורדת', 'ירידה של 12 נקודות', 'שיחה עם המאמן') ->> 'id')::uuid;
insert into r select 'owner_reopen_existing', (open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1', 'attendance_drop', 'שוב אותה תובנה') ->> 'existing');
insert into r select 'owner_reopen_same_id', ((open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1', 'attendance_drop', 'שוב') ->> 'id')::uuid = (select id from ids where k = 'b1'))::text;
insert into r select 'open_count_b1', count(*)::text from club_interventions where insight_key = 'attendance_drop:5ea00000-0000-4000-8000-0000000000b1';
insert into r select 'baseline_server', coalesce(baseline_value::text, 'null') from club_interventions where id = (select id from ids where k = 'b1');
insert into r select 'metric_server', metric from club_interventions where id = (select id from ids where k = 'b1');
insert into ids select 'club', (open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'missing_reports', '12 אימונים בלי דוח') ->> 'id')::uuid;
-- missing data: a team with no trainings -> baseline null, not 0
insert into ids select 'empty', (open_intervention('5ea00000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f4', 'no_plan', 'אימונים בלי מערך') ->> 'id')::uuid;
insert into r select 'empty_baseline', coalesce(baseline_value::text, 'null') from club_interventions where id = (select id from ids where k = 'empty');
insert into r select 'empty_measure', coalesce(measure_intervention((select id from ids where k = 'empty'))::text, 'null');
-- drill transfer: unknown exercise ids are dropped, the metric counts real use
insert into ids select 'drill', (open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b2', 'drill_transfer', 'להעביר תרגילים',
  '', '', null, null, jsonb_build_object('exercise_ids', jsonb_build_array((select id from exercises where scope = 'iplays' order by title limit 1), '00000000-0000-4000-8000-000000000000', 'x'),
                                        'from_team_id', '5ea00000-0000-4000-8000-0000000000b1')) ->> 'id')::uuid;
insert into r select 'drill_ctx', jsonb_array_length(context -> 'exercise_ids')::text || '/' || (baseline_value is not null)::text from club_interventions where id = (select id from ids where k = 'drill');
-- validation
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'results_down', 'בלי קבוצה'); insert into r values ('results_no_team', 'ALLOWED'); exception when others then insert into r values ('results_no_team', 'denied'); end $$;
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b2', 'drill_transfer', 'בלי תרגילים'); insert into r values ('transfer_no_drills', 'ALLOWED'); exception when others then insert into r values ('transfer_no_drills', 'denied'); end $$;
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-0000000000f3', 'no_plan', 'קבוצה ממועדון אחר'); insert into r values ('foreign_team', 'ALLOWED'); exception when others then insert into r values ('foreign_team', 'denied'); end $$;
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'made_up', 'סוג לא קיים'); insert into r values ('unknown_kind', 'ALLOWED'); exception when others then insert into r values ('unknown_kind', 'denied'); end $$;
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'no_plan', 'בעלים הורה', '', '', 'e5000000-0000-4000-8000-0000000000a1'); insert into r values ('parent_as_owner', 'ALLOWED'); exception when others then insert into r values ('parent_as_owner', 'denied'); end $$;
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'no_plan', 'תאריך עבר', '', '', null, date '2020-01-01'); insert into r values ('past_due', 'ALLOWED'); exception when others then insert into r values ('past_due', 'denied'); end $$;
-- no direct writes, even for the owner
do $$ begin insert into club_interventions (club_id, insight_key, kind, metric, title) values ('5ea00000-0000-4000-8000-000000000001', 'x:club', 'no_plan', 'plan_pct', 'ישיר'); insert into r values ('direct_insert', 'ALLOWED'); exception when others then insert into r values ('direct_insert', 'denied'); end $$;
do $$ begin update club_interventions set status = 'closed'; insert into r values ('direct_update', 'ALLOWED'); exception when others then insert into r values ('direct_update', 'denied'); end $$;
do $$ begin delete from club_intervention_log; insert into r values ('direct_delete', 'ALLOWED'); exception when others then insert into r values ('direct_delete', 'denied'); end $$;
-- owner options: club staff + the team's coach, never the parent
insert into r select 'owner_options_b1', string_agg(user_id::text, ',' order by user_id) from intervention_owner_options('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1')
  where user_id in ('e5000000-0000-4000-8000-0000000000c1', 'e5000000-0000-4000-8000-0000000000a1');
insert into r select 'today_owner', jsonb_typeof(club_today_sessions('5ea00000-0000-4000-8000-000000000001'));

-- coach of b1: sees only b1's; works on it; can't open, assign or close
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000c1');
insert into r select 'c1_sees', count(*)::text from club_interventions;
insert into r select 'c1_list', jsonb_array_length(club_interventions_list(null))::text;
select intervention_act((select id from ids where k = 'b1'), 'note', 'דיברתי עם ההורים');
select intervention_act((select id from ids where k = 'b1'), 'status', 'in_progress');
insert into r select 'c1_measure', (measure_intervention((select id from ids where k = 'b1')) is not distinct from (select v::numeric from r where k = 'expected_b1_att' and v <> 'null'))::text;
insert into r select 'c1_can_work', (intervention_detail((select id from ids where k = 'b1')) ->> 'can_work');
insert into r select 'c1_can_manage', (intervention_detail((select id from ids where k = 'b1')) ->> 'can_manage');
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1', 'no_plan', 'מאמן פותח'); insert into r values ('c1_open', 'ALLOWED'); exception when others then insert into r values ('c1_open', 'denied'); end $$;
do $$ begin perform close_intervention((select id from ids where k = 'b1'), 'improved', 'מאמן סוגר לבד את ההתערבות'); insert into r values ('c1_close', 'ALLOWED'); exception when others then insert into r values ('c1_close', 'denied'); end $$;
do $$ begin perform intervention_act((select id from ids where k = 'b1'), 'owner', 'e5000000-0000-4000-8000-0000000000c1'); insert into r values ('c1_assign', 'ALLOWED'); exception when others then insert into r values ('c1_assign', 'denied'); end $$;
do $$ begin perform intervention_act((select id from ids where k = 'club'), 'note', 'לא שלי'); insert into r values ('c1_note_club', 'ALLOWED'); exception when others then insert into r values ('c1_note_club', 'denied'); end $$;
do $$ begin perform intervention_act((select id from ids where k = 'b1'), 'status', 'closed'); insert into r values ('c1_status_closed', 'ALLOWED'); exception when others then insert into r values ('c1_status_closed', 'denied'); end $$;
do $$ begin perform intervention_metric_value('5ea00000-0000-4000-8000-000000000001', null, 'plan_pct', '{}'); insert into r values ('c1_metric_fn', 'ALLOWED'); exception when others then insert into r values ('c1_metric_fn', 'denied'); end $$;
insert into r select 'c1_today', coalesce(club_today_sessions('5ea00000-0000-4000-8000-000000000001')::text, 'null');

-- coach of b2 sees only b2's (the drill transfer); another club's coach and the parent see nothing
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000c2');
insert into r select 'c2_sees', count(*)::text from club_interventions;
insert into r select 'c2_detail', coalesce(intervention_detail((select id from ids where k = 'b1'))::text, 'null');
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000c3');
insert into r select 'c3_sees', count(*)::text from club_interventions;
insert into r select 'c3_log', count(*)::text from club_intervention_log;
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000a1');
insert into r select 'parent_sees', count(*)::text from club_interventions;
insert into r select 'parent_log', count(*)::text from club_intervention_log;
insert into r select 'parent_list', jsonb_array_length(club_interventions_list(null))::text;
insert into r select 'parent_today', coalesce(club_today_sessions('5ea00000-0000-4000-8000-000000000001')::text, 'null');
do $$ begin perform measure_intervention((select id from ids where k = 'b1')); insert into r values ('parent_measure', 'ALLOWED'); exception when others then insert into r values ('parent_measure', 'denied'); end $$;

-- club "reports" viewer: sees all, changes nothing
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000e1');
insert into r select 'viewer_sees', count(*)::text from club_interventions;
do $$ begin perform open_intervention('5ea00000-0000-4000-8000-000000000001', null, 'no_plan', 'צופה פותח'); insert into r values ('viewer_open', 'ALLOWED'); exception when others then insert into r values ('viewer_open', 'denied'); end $$;
do $$ begin perform close_intervention((select id from ids where k = 'b1'), 'improved', 'צופה סוגר את ההתערבות'); insert into r values ('viewer_close', 'ALLOWED'); exception when others then insert into r values ('viewer_close', 'denied'); end $$;

-- owner assigns the club-level one to coach 1 -> coach 1 now sees it
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000d1');
select intervention_act((select id from ids where k = 'club'), 'owner', 'e5000000-0000-4000-8000-0000000000c1');
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000c1');
insert into r select 'c1_sees_assigned', count(*)::text from club_interventions;

-- close: needs an outcome and a real conclusion; then the insight can open again
select pg_temp.as_user('e5000000-0000-4000-8000-0000000000d1');
do $$ begin perform close_intervention((select id from ids where k = 'b1'), 'improved', ''); insert into r values ('close_no_conclusion', 'ALLOWED'); exception when others then insert into r values ('close_no_conclusion', 'denied'); end $$;
do $$ begin perform close_intervention((select id from ids where k = 'b1'), 'great', 'מסקנה מקצועית מלאה'); insert into r values ('close_bad_outcome', 'ALLOWED'); exception when others then insert into r values ('close_bad_outcome', 'denied'); end $$;
select close_intervention((select id from ids where k = 'b1'), 'improved', 'הנוכחות חזרה ל־85% אחרי שיחה עם ההורים');
insert into r select 'closed_status', status || '/' || outcome || '/' || (current_at is not null)::text from club_interventions where id = (select id from ids where k = 'b1');
do $$ begin perform intervention_act((select id from ids where k = 'b1'), 'note', 'אחרי סגירה'); insert into r values ('note_after_close', 'ALLOWED'); exception when others then insert into r values ('note_after_close', 'denied'); end $$;
insert into r select 'reopen_after_close', (open_intervention('5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000b1', 'attendance_drop', 'שוב ירידה') ->> 'existing');
insert into r select 'log_b1', string_agg(action, ',' order by at, id) from club_intervention_log where intervention_id = (select id from ids where k = 'b1');
do $$ begin perform cancel_intervention((select id from ids where k = 'empty'), ''); insert into r values ('cancel_no_reason', 'ALLOWED'); exception when others then insert into r values ('cancel_no_reason', 'denied'); end $$;
select cancel_intervention((select id from ids where k = 'empty'), 'נפתח בטעות');
insert into r select 'cancel_status', status from club_interventions where id = (select id from ids where k = 'empty');

-- anonymous: nothing
reset role;
set local role anon;
select pg_temp.as_user(null);
do $$ begin perform club_interventions_list(null); insert into r values ('anon_list', 'ALLOWED'); exception when others then insert into r values ('anon_list', 'denied'); end $$;
do $$ begin perform count(*) from club_interventions; insert into r values ('anon_table', 'ALLOWED'); exception when others then insert into r values ('anon_table', 'denied'); end $$;
reset role;

create temp table expect (k text primary key, v text);
insert into expect values
  ('owner_reopen_existing', 'true'), ('owner_reopen_same_id', 'true'), ('open_count_b1', '1'), ('metric_server', 'attendance_pct'),
  ('empty_baseline', 'null'), ('empty_measure', 'null'),
  ('results_no_team', 'denied'), ('transfer_no_drills', 'denied'), ('foreign_team', 'denied'), ('unknown_kind', 'denied'),
  ('parent_as_owner', 'denied'), ('past_due', 'denied'),
  ('direct_insert', 'denied'), ('direct_update', 'denied'), ('direct_delete', 'denied'),
  ('owner_options_b1', 'e5000000-0000-4000-8000-0000000000c1'), ('today_owner', 'array'),
  ('c1_sees', '1'), ('c1_list', '1'), ('c1_measure', 'true'), ('c1_can_work', 'true'), ('c1_can_manage', 'false'),
  ('c1_open', 'denied'), ('c1_close', 'denied'), ('c1_assign', 'denied'), ('c1_note_club', 'denied'), ('c1_status_closed', 'denied'),
  ('c1_metric_fn', 'denied'), ('c1_today', 'null'),
  ('c2_sees', '1'), ('c2_detail', 'null'), ('c3_sees', '0'), ('c3_log', '0'),
  ('parent_sees', '0'), ('parent_log', '0'), ('parent_list', '0'), ('parent_today', 'null'), ('parent_measure', 'denied'),
  ('viewer_sees', '4'), ('drill_ctx', '1/true'), ('viewer_open', 'denied'), ('viewer_close', 'denied'),
  ('c1_sees_assigned', '2'),
  ('close_no_conclusion', 'denied'), ('close_bad_outcome', 'denied'), ('closed_status', 'closed/improved/true'),
  ('note_after_close', 'denied'), ('reopen_after_close', 'false'), ('log_b1', 'opened,note,status,measured,closed'),
  ('cancel_no_reason', 'denied'), ('cancel_status', 'canceled'),
  ('anon_list', 'denied'), ('anon_table', 'denied');
-- the baseline equals the server's own calculation
insert into expect select 'baseline_server', v from r where k = 'expected_b1_att';

select e.k, r.v, e.v as expected, (r.v is not distinct from e.v) as ok from expect e left join r on r.k = e.k order by ok, e.k;
do $$ declare n int; begin
  select count(*) into n from expect e left join r on r.k = e.k where r.v is distinct from e.v;
  if n > 0 then raise exception 'club interventions test FAILED (% checks)', n; end if;
  raise notice 'club interventions: all % checks passed', (select count(*) from expect);
end $$;
rollback;
