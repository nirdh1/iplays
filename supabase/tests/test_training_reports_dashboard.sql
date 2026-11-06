-- RLS and RPC tests for 20261106400000_training_reports_dashboard.sql.
-- Runs on the local test database after the migrations and the synthetic seed.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('e2000000-0000-4000-8000-0000000000c1', 'coach1@test.invalid'),
  ('e2000000-0000-4000-8000-0000000000c2', 'coach2@test.invalid'),
  ('e2000000-0000-4000-8000-0000000000a1', 'parent1@test.invalid'),
  ('e2000000-0000-4000-8000-0000000000d1', 'owner1@test.invalid');
insert into team_members (team_id, user_id, role) values
  ('5ea00000-0000-4000-8000-0000000000b1', 'e2000000-0000-4000-8000-0000000000c1', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b2', 'e2000000-0000-4000-8000-0000000000c2', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b1', 'e2000000-0000-4000-8000-0000000000a1', 'parent');
insert into club_staff (club_id, user_id, role) values ('5ea00000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-0000000000d1', 'admin');

create temp table r (k text, v text);
grant all on r to authenticated;
create temp table ids (k text primary key, id uuid);
insert into ids select 'past', id from training_sessions where team_id = '5ea00000-0000-4000-8000-0000000000b1' and not canceled and starts_at < now() order by starts_at desc limit 1;
insert into ids select 'future', id from training_sessions where team_id = '5ea00000-0000-4000-8000-0000000000b1' and not canceled and starts_at > now() + interval '2 hours' order by starts_at limit 1;
grant all on ids to authenticated;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;

set local role authenticated;
select pg_temp.as_user('e2000000-0000-4000-8000-0000000000d1');
insert into r select 'owner_missing_before', (club_dashboard('5ea00000-0000-4000-8000-000000000001') -> 'totals' ->> 'missing_reports');

select pg_temp.as_user('e2000000-0000-4000-8000-0000000000c1');
select submit_training_report((select id from ids where k = 'past'), '{"blocks":[{"ord":0,"status":"done"},{"ord":1,"status":"skipped","note":"גשם"}],"rating":4,"note":"טוב"}');
insert into r select 'c1_reads_report', count(*)::text from training_reports;
do $$ begin perform submit_training_report((select id from ids where k = 'future'), '{"blocks":[]}');
  insert into r values ('report_future', 'ALLOWED'); exception when others then insert into r values ('report_future', 'denied'); end $$;
do $$ begin perform submit_training_report((select id from ids where k = 'past'), '{"blocks":[{"ord":0,"status":"bad"}]}');
  insert into r values ('bad_status', 'ALLOWED'); exception when others then insert into r values ('bad_status', 'denied'); end $$;
insert into r select 'c1_dashboard', coalesce(club_dashboard('5ea00000-0000-4000-8000-000000000001')::text, 'null');
insert into r select 'c1_dash_clubs', count(*)::text from my_dashboard_clubs();

select pg_temp.as_user('e2000000-0000-4000-8000-0000000000c2');
do $$ begin perform submit_training_report((select id from ids where k = 'past'), '{"blocks":[]}');
  insert into r values ('c2_report_other_team', 'ALLOWED'); exception when others then insert into r values ('c2_report_other_team', 'denied'); end $$;
insert into r select 'c2_reads_report', count(*)::text from training_reports;

select pg_temp.as_user('e2000000-0000-4000-8000-0000000000a1');
insert into r select 'parent_reads_report', count(*)::text from training_reports;
insert into r select 'parent_dashboard', coalesce(club_dashboard('5ea00000-0000-4000-8000-000000000001')::text, 'null');

select pg_temp.as_user('e2000000-0000-4000-8000-0000000000d1');
insert into r select 'owner_missing_after', (club_dashboard('5ea00000-0000-4000-8000-000000000001') -> 'totals' ->> 'missing_reports');
insert into r select 'owner_teams', jsonb_array_length(club_dashboard('5ea00000-0000-4000-8000-000000000001') -> 'teams')::text;
insert into r select 'owner_dash_clubs', count(*)::text from my_dashboard_clubs();
reset role;

select k, v,
  case k when 'c1_reads_report' then v = '1' when 'report_future' then v = 'denied' when 'bad_status' then v = 'denied'
         when 'c1_dashboard' then v = 'null' when 'c1_dash_clubs' then v = '0' when 'c2_report_other_team' then v = 'denied'
         when 'c2_reads_report' then v = '0' when 'parent_reads_report' then v = '0' when 'parent_dashboard' then v = 'null'
         when 'owner_missing_after' then v::int = (select v::int - 1 from r where k = 'owner_missing_before')
         when 'owner_teams' then v = '3' when 'owner_dash_clubs' then v = '1' else true end as ok
from r order by k;
rollback;
