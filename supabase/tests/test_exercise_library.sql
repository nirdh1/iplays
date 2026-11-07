-- RLS and RPC tests for 20261106200000_exercise_library.sql (+ base exercises)
-- and 20261106500000_exercise_topics_base_25.sql (topics, 25 base exercises).
-- Runs on the local test database after the migrations and the synthetic seed.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-0000000000c1', 'coach1@test.invalid'),
  ('e0000000-0000-4000-8000-0000000000c2', 'coach2@test.invalid'),
  ('e0000000-0000-4000-8000-0000000000a1', 'parent1@test.invalid'),
  ('e0000000-0000-4000-8000-0000000000d1', 'owner1@test.invalid');
insert into clubs (id, name, status, created_by) values ('e0000000-0000-4000-8000-0000000000f2', 'מועדון אחר', 'verified', 'e0000000-0000-4000-8000-0000000000d1');
insert into teams (id, name, created_by, club_id) values ('e0000000-0000-4000-8000-0000000000f3', 'קבוצה אחרת', 'e0000000-0000-4000-8000-0000000000d1', 'e0000000-0000-4000-8000-0000000000f2');
insert into team_members (team_id, user_id, role) values
  ('5ea00000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000c1', 'coach'),
  ('e0000000-0000-4000-8000-0000000000f3', 'e0000000-0000-4000-8000-0000000000c2', 'coach'),
  ('5ea00000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-0000000000a1', 'parent');
insert into club_staff (club_id, user_id, role) values ('5ea00000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000d1', 'owner');

create temp table r (k text, v text);
grant all on r to authenticated;
create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, true);
$$;

-- coach 1 (demo club): sees the 25 base drafts, can write personal, not club, not iplays
set local role authenticated;
select pg_temp.as_user('e0000000-0000-4000-8000-0000000000c1');
insert into r select 'c1_sees_base', count(*)::text from exercises where scope = 'iplays';
insert into r select 'c1_personal', save_exercise(null, 'personal', null, '{"title":"התרגיל שלי","category":"rondo"}')::text;
insert into r select 'c1_copy', copy_exercise((select id from exercises where scope = 'iplays' limit 1), 'personal')::text;
do $$ begin perform save_exercise(null, 'club', '5ea00000-0000-4000-8000-000000000001', '{"title":"ניסיון","category":"rondo"}'); insert into r values ('c1_club_write', 'ALLOWED'); exception when others then insert into r values ('c1_club_write', 'denied'); end $$;
do $$ begin perform save_exercise((select id from exercises where scope = 'iplays' limit 1), 'iplays', null, '{"title":"שינוי"}'); insert into r values ('c1_edit_base', 'ALLOWED'); exception when others then insert into r values ('c1_edit_base', 'denied'); end $$;
do $$ begin update exercises set title = 'x' where scope = 'iplays'; insert into r values ('c1_direct_update', 'ALLOWED'); exception when others then insert into r values ('c1_direct_update', 'denied'); end $$;
insert into r select 'c1_sees_own', count(*)::text from exercises where scope = 'personal';
-- topics: a copy keeps the source's topics; unknown codes are dropped; base topics are not editable
insert into r select 'c1_copy_topics', (c.topics = s.topics and cardinality(c.topics) > 0)::text
  from exercises c join exercises s on s.id = c.copied_from where c.id = (select v::uuid from r where k = 'c1_copy');
select set_exercise_topics((select v::uuid from r where k = 'c1_personal'), array['scanning', 'nope', 'depth_pass', 'scanning']);
insert into r select 'c1_set_topics', array_to_string(topics, ',') from exercises where id = (select v::uuid from r where k = 'c1_personal');
do $$ begin perform set_exercise_topics((select id from exercises where scope = 'iplays' limit 1), array['gk']); insert into r values ('c1_topics_base', 'ALLOWED'); exception when others then insert into r values ('c1_topics_base', 'denied'); end $$;
insert into r select 'base_all_topics', (count(*) filter (where cardinality(topics) between 1 and 6))::text from exercises where scope = 'iplays';
insert into r select 'topics_listed', (count(*) >= 15)::text from exercise_topics;

-- owner of the demo club: writes club library
select pg_temp.as_user('e0000000-0000-4000-8000-0000000000d1');
insert into r select 'owner_club_write', (save_exercise(null, 'club', '5ea00000-0000-4000-8000-000000000001', '{"title":"תרגיל מועדון","category":"ssg"}') is not null)::text;
insert into r select 'owner_sees_c1_personal', count(*)::text from exercises where scope = 'personal';

-- coach 1 sees the club exercise; coach 2 (other club) does not, nor coach 1's personal
select pg_temp.as_user('e0000000-0000-4000-8000-0000000000c1');
insert into r select 'c1_sees_club', count(*)::text from exercises where scope = 'club';
select pg_temp.as_user('e0000000-0000-4000-8000-0000000000c2');
insert into r select 'c2_sees_club', count(*)::text from exercises where scope = 'club';
insert into r select 'c2_sees_c1_personal', count(*)::text from exercises where scope = 'personal';
insert into r select 'c2_sees_base', count(*)::text from exercises where scope = 'iplays';

-- parent: nothing at all, cannot save
select pg_temp.as_user('e0000000-0000-4000-8000-0000000000a1');
insert into r select 'parent_sees', count(*)::text from exercises;
do $$ begin perform save_exercise(null, 'personal', null, '{"title":"הורה","category":"rondo"}'); insert into r values ('parent_write', 'ALLOWED'); exception when others then insert into r values ('parent_write', 'denied'); end $$;
reset role;

select k, v,
  case k when 'c1_sees_base' then v = '25' when 'c1_club_write' then v = 'denied' when 'c1_edit_base' then v = 'denied'
         when 'c1_direct_update' then v = 'denied' when 'c1_sees_own' then v = '2' when 'owner_club_write' then v = 'true'
         when 'owner_sees_c1_personal' then v = '0' when 'c1_sees_club' then v = '1' when 'c2_sees_club' then v = '0'
         when 'c2_sees_c1_personal' then v = '0' when 'c2_sees_base' then v = '25' when 'parent_sees' then v = '0'
         when 'parent_write' then v = 'denied' when 'c1_copy_topics' then v = 'true' when 'c1_set_topics' then v = 'depth_pass,scanning'
         when 'c1_topics_base' then v = 'denied' when 'base_all_topics' then v = '25' when 'topics_listed' then v = 'true' else true end as ok
from r where k not in ('c1_personal', 'c1_copy') order by k;
do $$ begin
  if exists (select 1 from r where (k, v) in (('c1_club_write','ALLOWED'),('c1_edit_base','ALLOWED'),('c1_direct_update','ALLOWED'),('parent_write','ALLOWED'),('c1_topics_base','ALLOWED')))
     or exists (select 1 from r where k = 'parent_sees' and v <> '0') then
    raise exception 'exercise library permission test FAILED';
  end if;
end $$;
rollback;
