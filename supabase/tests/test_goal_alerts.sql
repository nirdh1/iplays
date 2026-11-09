-- Goal alerts: one bell / push row per counted goal, to the team, not to the actor.
-- Runs after test_live_match.sql (uses its own fixtures).
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

\set COACH '''00000000-0000-0000-0000-0000000009c0'''
\set P1 '''00000000-0000-0000-0000-0000000009a1'''
\set P2 '''00000000-0000-0000-0000-0000000009a2'''
\set T '''10000000-0000-0000-0000-0000000009e0'''
\set M '''20000000-0000-0000-0000-0000000009e0'''

select pg_temp.as_user(null);
insert into auth.users (id, email, raw_user_meta_data) values
  (:COACH, 'gcoach@test', '{"full_name":"מאמן"}'), (:P1, 'gp1@test', '{"full_name":"אבי"}'), (:P2, 'gp2@test', '{"full_name":"בתיה"}');
insert into teams (id, name, created_by) values (:T, 'הפועל רמת גן', :COACH);
insert into team_members (team_id, user_id, role) values (:T, :COACH, 'coach'), (:T, :P1, 'parent'), (:T, :P2, 'parent')
  on conflict (team_id, user_id) do update set role = excluded.role;
insert into players (id, team_id, first_name, last_name, shirt_number) values ('30000000-0000-0000-0000-0000000009e1', :T, 'יונתן', 'כהן', 9);
insert into team_matches (id, team_id, starts_at, opponent, home) values (:M, :T, now() - interval '22 minutes', 'הפועל אשקלון', true);

-- P1 reports a goal while no one is the primary: it counts and alerts everyone else
select pg_temp.as_user(:P1);
select submit_match_report(:M, 'goal', 'home', 9);
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where kind = 'live_goal' and team_id = :T) = 2, 'goal alert to the 2 other members');
select pg_temp.check(not exists (select 1 from notification_outbox where kind = 'live_goal' and user_id = :P1), 'reporter not alerted about own goal');
select pg_temp.check((select title from notification_outbox where kind = 'live_goal' and user_id = :P2) = 'גול! הפועל רמת גן 1:0 הפועל אשקלון', 'title has both teams and the score');
select pg_temp.check((select body from notification_outbox where kind = 'live_goal' and user_id = :P2) like 'דקה 2_ · יונתן כהן (#9) · להפועל רמת גן', 'body has minute and scorer');
select pg_temp.check((select url from notification_outbox where kind = 'live_goal' and user_id = :P2) = '#matches/' || :T || '/' || :M, 'link opens the match');

-- goal type, set by the sender
select pg_temp.as_user(:P1);
select set_match_goal_type((select id from match_events where match_id = :M), 'free_kick');
select pg_temp.check((select goal_type from match_events_feed(:M)) = 'free_kick', 'feed returns the goal type');
select pg_temp.fails($$select set_match_goal_type((select id from match_events where match_id = '20000000-0000-0000-0000-0000000009e0'), 'banana')$$, 'unknown goal type refused');

-- a parent who turned match results off gets no goal alerts; cards do not alert
select pg_temp.as_user(null);
insert into notification_prefs (user_id, match_results) values (:P2, false)
  on conflict (user_id) do update set match_results = false;
select pg_temp.as_user(:COACH);
select submit_match_report(:M, 'goal', 'away', null);
select submit_match_report(:M, 'yellow', 'away', 5);
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where kind = 'live_goal' and user_id = :P2) = 1, 'results off: no further goal alerts');
select pg_temp.check((select count(*) from notification_outbox where kind = 'live_goal' and user_id = :P1) = 1, 'second goal alerts P1, the card does not');
select pg_temp.check((select title from notification_outbox where kind = 'live_goal' and user_id = :P1) = 'גול! הפועל רמת גן 1:1 הפועל אשקלון', 'score after the equaliser');

-- a pending report does not alert
select pg_temp.as_user(:P1);
select claim_match_reporter(:M);
select pg_temp.as_user(:P2);
select submit_match_report(:M, 'goal', 'home', null);
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where kind = 'live_goal') = 3, 'pending report: no alert');
-- approval alerts (P2's prefs are off, so only the coach)
select pg_temp.as_user(:P1);
select review_match_report((select id from match_reports where match_id = :M and status = 'pending'), true);
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where kind = 'live_goal' and user_id = :COACH) = 2, 'approved goal alerts the team');
