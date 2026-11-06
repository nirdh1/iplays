-- iPlays 2.0 STAGING seed: synthetic data only. NEVER run on Production.
-- Every name here is invented. Nothing is copied from Production.
-- Run once in the Staging project's SQL Editor, after all migrations.
-- Then sign up in the Staging app with your email and run:
--   select staging_make_me_staff('your@email');

do $$
begin
  if exists (select 1 from public.ifa_players limit 1) then
    raise exception 'ABORT: this database has IFA player data. The synthetic seed runs only on an empty Staging project.';
  end if;
end $$;

create schema if not exists staging;
create table if not exists staging.marker (note text, created_at timestamptz default now());
insert into staging.marker (note) values ('iplays staging: synthetic data only');

-- a non-login owner for seeded rows (no password, .invalid address)
insert into auth.users (id, email, created_at)
values ('5ea00000-0000-4000-8000-00000000000f', 'seed@staging.invalid', now() - interval '60 days')
on conflict (id) do nothing;

-- club, programs, teams
insert into clubs (id, name, city, status, created_by, created_at)
values ('5ea00000-0000-4000-8000-000000000001', 'מועדון הדגמה צפון (נתונים בדויים)', 'עיר בדויה', 'verified', '5ea00000-0000-4000-8000-00000000000f', now() - interval '60 days');

insert into club_programs (id, club_id, kind, name) values
  ('5ea00000-0000-4000-8000-0000000000a1', '5ea00000-0000-4000-8000-000000000001', 'league', 'ליגה'),
  ('5ea00000-0000-4000-8000-0000000000a2', '5ea00000-0000-4000-8000-000000000001', 'academy', 'אקדמיה');

insert into teams (id, name, club, season, sport, club_id, program_id, age_group, birth_year_from, birth_year_to, opened_by, created_by)
select v.id::uuid, v.name, v.club, v.season, v.sport, v.club_id::uuid, v.program_id::uuid, v.age_group, v.byf, v.byt, v.ob, '5ea00000-0000-4000-8000-00000000000f'::uuid from (values
  ('5ea00000-0000-4000-8000-0000000000b1', 'ילדים א׳ (בדוי)', 'מועדון הדגמה צפון', '2026/27', 'football', '5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000a1', 'ילדים א׳', 2014, 2014, 'staff'),
  ('5ea00000-0000-4000-8000-0000000000b2', 'ילדים ב׳ (בדוי)', 'מועדון הדגמה צפון', '2026/27', 'football', '5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000a1', 'ילדים ב׳', 2015, 2015, 'staff'),
  ('5ea00000-0000-4000-8000-0000000000b3', 'טרום א׳ אקדמיה (בדוי)', 'מועדון הדגמה צפון', '2026/27', 'football', '5ea00000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-0000000000a2', 'טרום א׳', 2016, 2016, 'staff')) v(id, name, club, season, sport, club_id, program_id, age_group, byf, byt, ob);

-- 15 invented players per team
with names(i, f, l) as (values
  (1,'אורי','דמו'),(2,'נועם','בדוי'),(3,'איתי','דוגמה'),(4,'יואב','ניסוי'),(5,'עומר','דמו'),
  (6,'רועי','בדוי'),(7,'אלון','דוגמה'),(8,'תומר','ניסוי'),(9,'גיא','דמו'),(10,'דניאל','בדוי'),
  (11,'עידו','דוגמה'),(12,'יונתן','ניסוי'),(13,'אריאל','דמו'),(14,'שחר','בדוי'),(15,'אגם','דוגמה')),
t(team_id, by, n) as (values
  ('5ea00000-0000-4000-8000-0000000000b1'::uuid, 2014, 1),
  ('5ea00000-0000-4000-8000-0000000000b2'::uuid, 2015, 2),
  ('5ea00000-0000-4000-8000-0000000000b3'::uuid, 2016, 3)),
ins as (
  insert into players (id, team_id, first_name, last_name, shirt_number, position, birth_year)
  select ('5ea00000-0000-4000-8000-0' || t.n || lpad(names.i::text, 10, '0'))::uuid, t.team_id, names.f, names.l || ' ' || t.n,
         names.i + 1, (array['שוער','מגן','בלם','קשר','קשר','חלוץ'])[1 + names.i % 6], t.by
  from t cross join names
  returning id)
select count(*) from ins;
-- the players_create_assignment trigger opened an assignment for each player; backdate it
update player_assignments set started_on = current_date - 60
where team_id in (select id from teams where club_id = '5ea00000-0000-4000-8000-000000000001');

-- trainings: 4 weeks back + 2 weeks ahead, Sun/Tue/Thu 17:30 Israel time
insert into training_sessions (team_id, starts_at, duration_min, title, location, kind, audience)
select tm.id,
       ((d + time '17:30') at time zone 'Asia/Jerusalem'),
       90, 'אימון קבוצתי', 'מגרש הדגמה 1', 'team', 'team'
from teams tm
cross join generate_series(current_date - 28, current_date + 14, interval '1 day') g(d0)
cross join lateral (select g.d0::date as d) x
where tm.club_id = '5ea00000-0000-4000-8000-000000000001'
  and extract(dow from x.d) in (0, 2, 4);

-- attendance for past trainings: mostly present, a few late/absent (deterministic)
insert into attendance_records (team_id, session_id, player_id, status, minutes_late)
select s.team_id, s.id, a.player_id,
       case when (hashtext(s.id::text || a.player_id::text) % 13) = 0 then 'absent'
            when (hashtext(s.id::text || a.player_id::text) % 11) = 0 then 'late'
            else 'present' end,
       case when (hashtext(s.id::text || a.player_id::text) % 13) <> 0 and (hashtext(s.id::text || a.player_id::text) % 11) = 0 then 10 end
from training_sessions s
join player_assignments a on a.team_id = s.team_id and a.ended_on is null
where s.starts_at < now() - interval '1 day'
  and s.team_id in (select id from teams where club_id = '5ea00000-0000-4000-8000-000000000001')
  and (hashtext(s.id::text) % 5) <> 0;   -- ~1 in 5 past trainings has no attendance yet (shows "missing")

-- make the signed-up operator club admin + coach of every demo team (Staging only)
create or replace function public.staging_make_me_staff(p_email text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare v uuid;
begin
  if not exists (select 1 from staging.marker) then raise exception 'not a staging database'; end if;
  select id into v from auth.users where lower(email) = lower(p_email);
  if v is null then raise exception 'sign up in the Staging app first: %', p_email; end if;
  insert into club_staff (club_id, user_id, role) values ('5ea00000-0000-4000-8000-000000000001', v, 'owner') on conflict do nothing;
  insert into team_members (team_id, user_id, role)
  select id, v, 'coach' from teams where club_id = '5ea00000-0000-4000-8000-000000000001'
  on conflict do nothing;
  return 'ok: ' || p_email || ' is club owner + coach of 3 demo teams';
end $$;
revoke all on function public.staging_make_me_staff(text) from public, anon, authenticated;
