-- Parents edit trainings and games; everyone in the team is told who changed what.
-- Runs after test_calendar.sql (calendar, inbox notifications, match overrides
-- and schedule import installed; self-contained data, plus the IFA game of
-- test_match_overrides.sql).
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

\set COACH '''00000000-0000-0000-0000-0000000000d1'''
\set MOM '''00000000-0000-0000-0000-0000000000d2'''
\set DAD '''00000000-0000-0000-0000-0000000000d3'''
\set OUT '''00000000-0000-0000-0000-0000000000d4'''
\set ET '''10000000-0000-0000-0000-0000000000d1'''

select pg_temp.as_user(null);
insert into auth.users (id, email) values (:COACH, 'coach@edit'), (:MOM, 'mom@edit'), (:DAD, 'dad@edit'), (:OUT, 'out@edit');
insert into profiles (id, full_name) values (:COACH, 'המאמן'), (:MOM, 'דנה כהן'), (:DAD, 'אבא'), (:OUT, 'זר')
  on conflict (id) do update set full_name = excluded.full_name;
insert into teams (id, name, club, sport, created_by) values (:ET, 'עריכה FC', 'בדיקה', 'football', :COACH);
insert into team_members (team_id, user_id, role) values (:ET, :COACH, 'coach'), (:ET, :MOM, 'parent'), (:ET, :DAD, 'parent')
on conflict (team_id, user_id) do update set role = excluded.role;

-- a weekly team training series, added by the coach
select pg_temp.as_user(:COACH);
insert into training_sessions (team_id, starts_at, duration_min, title, location, note, series_id, created_by)
select :ET, date_trunc('day', now()) + interval '2 days' + make_interval(days => 7 * i) + interval '15 hours', 90, 'אימון קבוצתי', 'מגרש א', '',
       '30000000-0000-0000-0000-0000000000d1', :COACH
from generate_series(0, 3) i;
select id as first from training_sessions where team_id = :ET order by starts_at limit 1 \gset

-- ------------------------------------------------ parent edits a training
select pg_temp.as_user(null);
delete from notification_outbox where team_id = :ET;
select pg_temp.as_user(:MOM);
select pg_temp.check(edit_training(:'first', date_trunc('day', now()) + interval '3 days' + interval '16 hours', 75, 'אימון כושר', 'מגרש ב', 'להביא מים') = 1,
  'parent edits one training (date, time, length, title, place, note)');
select pg_temp.check((select title || '|' || location || '|' || duration_min || '|' || note from training_sessions where id = :'first') = 'אימון כושר|מגרש ב|75|להביא מים', 'the change is saved');
select pg_temp.check((select count(*) from training_sessions where team_id = :ET and title = 'אימון קבוצתי') = 3, 'the rest of the series is untouched');

select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where team_id = :ET and title = 'דנה כהן עדכן את האימון') = 2, 'coach and the other parent are told, with the parent''s name');
select pg_temp.check(not exists (select 1 from notification_outbox where team_id = :ET and user_id = :MOM), 'not the parent who changed it');
delete from notification_outbox where team_id = :ET;

-- ... and the whole series from here on: one notification each
select pg_temp.as_user(:MOM);
select pg_temp.check(edit_training(:'first', (select starts_at from training_sessions where id = :'first'), 60, 'אימון', 'מגרש ג', '', true) = 4,
  'parent changes the training days of the whole series');
select pg_temp.check((select count(*) from training_sessions where team_id = :ET and location = 'מגרש ג' and duration_min = 60) = 4, 'all four changed');
select pg_temp.check((select count(distinct (starts_at at time zone 'Asia/Jerusalem')::time) from training_sessions where team_id = :ET) = 1, 'same time of day');
select pg_temp.check((select count(distinct extract(dow from starts_at at time zone 'Asia/Jerusalem')) from training_sessions where team_id = :ET and id <> :'first') = 1, 'later dates keep their weekday');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where team_id = :ET) = 2, 'a series edit is one notification per person');
select pg_temp.check((select count(*) from notification_outbox where team_id = :ET and title = 'דנה כהן עדכן את ימי האימון') = 2, '"<name> עדכן את ימי האימון"');
delete from notification_outbox where team_id = :ET;

-- cancel and delete name the person too
select pg_temp.as_user(:DAD);
update training_sessions set canceled = true where id = :'first';
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where team_id = :ET and title = 'אבא ביטל את האימון') = 2, 'cancel: "<name> ביטל את האימון"');

-- outsiders can't
select pg_temp.as_user(:OUT);
select pg_temp.fails(format('select edit_training(%L, now() + interval ''5 days'', 60, ''x'', '''', '''')', :'first'), 'outsider edits a training');

-- -------------------------------------------------------- club games
select pg_temp.as_user(:MOM);
insert into team_matches (team_id, starts_at, opponent, home, venue, competition) values (:ET, now() + interval '10 days', 'הפועל בדיקה', true, '', 'league');
select id as g from team_matches where team_id = :ET \gset
update team_matches set starts_at = now() + interval '11 days', venue = 'מגרש העירייה', opponent = 'הפועל בדיקה ב' where id = :'g';
select pg_temp.check((select venue || '|' || opponent from team_matches where id = :'g') = 'מגרש העירייה|הפועל בדיקה ב', 'parent adds and edits a club game');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where team_id = :ET and title = 'דנה כהן עדכן את המשחק מול הפועל בדיקה ב') = 2, 'game change: everyone told who changed it');
select pg_temp.as_user(:DAD);
update team_matches set status = 'canceled' where id = :'g';
select pg_temp.check((select status from team_matches where id = :'g') = 'canceled', 'parent cancels a club game');
select pg_temp.as_user(:OUT);
update team_matches set venue = 'זר' where id = :'g';
select pg_temp.as_user(null);
select pg_temp.check((select venue from team_matches where id = :'g') = 'מגרש העירייה', 'outsider cannot edit a game');

-- ---------------------------------------------------------- IFA games
select m.id as ifa_m, m.team_id as ifa_t from team_matches m join ifa_games g on g.id = m.ifa_game where g.ifa_game_id = 7100001 limit 1 \gset
insert into team_members (team_id, user_id, role) values (:'ifa_t', :DAD, 'parent') on conflict (team_id, user_id) do nothing;
select pg_temp.as_user(:DAD);
select set_match_override(:'ifa_m', 'venue', '"מגרש של ההורים"');
select pg_temp.check((select venue from team_matches where id = :'ifa_m') = 'מגרש של ההורים', 'parent sets the venue of an IFA game');
select pg_temp.fails(format('select set_match_override(%L, ''score'', ''[1, 0]'')', :'ifa_m'), 'parent sets the score of an IFA game');
select pg_temp.check((select count(*) from team_match_overrides where match_id = :'ifa_m' and status = 'active') >= 1, 'parent sees the hand changes');
select pg_temp.as_user(:OUT);
select pg_temp.fails(format('select set_match_override(%L, ''venue'', ''"x"'')', :'ifa_m'), 'outsider overrides an IFA game');

select pg_temp.as_user(null);
