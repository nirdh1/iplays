-- Live match: clock, primary reporter, queue and hand-off, secondary reports,
-- merging, approval, cards, final result, permissions. Self-contained fixtures.
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

\set COACH '''00000000-0000-0000-0000-0000000001c0'''
\set P1 '''00000000-0000-0000-0000-0000000001a1'''
\set P2 '''00000000-0000-0000-0000-0000000001a2'''
\set P3 '''00000000-0000-0000-0000-0000000001a3'''
\set OUT '''00000000-0000-0000-0000-0000000001ff'''
\set T '''10000000-0000-0000-0000-0000000001e0'''
\set M '''20000000-0000-0000-0000-0000000001e0'''

select pg_temp.as_user(null);
insert into auth.users (id, email, raw_user_meta_data) values
  (:COACH, 'lcoach@test', '{"full_name":"מאמן"}'), (:P1, 'lp1@test', '{"full_name":"אבי"}'),
  (:P2, 'lp2@test', '{"full_name":"בתיה"}'), (:P3, 'lp3@test', '{"full_name":"גיל"}'), (:OUT, 'lout@test', '{"full_name":"זר"}');
insert into teams (id, name, created_by) values (:T, 'קבוצת לייב', :COACH);
insert into team_members (team_id, user_id, role) values (:T, :COACH, 'coach'), (:T, :P1, 'parent'), (:T, :P2, 'parent'), (:T, :P3, 'parent')
  on conflict (team_id, user_id) do update set role = excluded.role;
insert into players (id, team_id, first_name, last_name, shirt_number) values
  ('30000000-0000-0000-0000-0000000001e1', :T, 'יונתן', 'כהן', 9),
  ('30000000-0000-0000-0000-0000000001e2', :T, 'עומר', 'לוי', 4);
insert into player_guardians (player_id, user_id) values ('30000000-0000-0000-0000-0000000001e1', :P1);
-- home game against Ashkelon, kicked off 5 minutes ago
insert into team_matches (id, team_id, starts_at, opponent, home) values (:M, :T, now() - interval '5 minutes', 'הפועל אשקלון', true);

-- no primary reporter yet: a report counts at once (PR #21 behaviour)
select pg_temp.as_user(:P2);
select pg_temp.check((submit_match_report(:M, 'goal', 'home', 9) ->> 'applied')::boolean, 'without a primary reporter a report counts at once');
select pg_temp.check((select player_id from match_events where match_id = :M) = '30000000-0000-0000-0000-0000000001e1', 'shirt 9 resolved to Yonatan');

-- P1 becomes the primary reporter, starts the game
select pg_temp.as_user(:P1);
select claim_match_reporter(:M);
select pg_temp.check((match_live_state(:M) ->> 'reporter_label') like 'אבי (ההורה של יונתן)', 'reporter shown as "אבי (ההורה של יונתן)"');
select match_clock(:M, 'start');
select pg_temp.check((match_live_state(:M) ->> 'status') = 'running' and (match_live_state(:M) ->> 'period')::int = 1, 'game started, half 1');

-- P2 cannot take the role, joins the queue; P3 too
select pg_temp.as_user(:P2);
select pg_temp.fails($$select claim_match_reporter('20000000-0000-0000-0000-0000000001e0')$$, 'second parent cannot take the role');
select pg_temp.fails($$select match_clock('20000000-0000-0000-0000-0000000001e0', 'end_period')$$, 'non-reporter cannot run the clock');
select join_reporter_queue(:M);
select pg_temp.as_user(:P3);
select join_reporter_queue(:M);
select pg_temp.check(jsonb_array_length(match_live_state(:M) -> 'queue') = 2, 'two parents in the queue');

-- secondary reports wait; a similar one is merged
select pg_temp.as_user(:P2);
select pg_temp.check(not (submit_match_report(:M, 'goal', 'away', null) ->> 'applied')::boolean, 'secondary report waits for the primary');
select pg_temp.as_user(:P3);
select pg_temp.check((submit_match_report(:M, 'goal', 'away', 7) ->> 'merged')::boolean, 'similar report merged as a confirmation');
select pg_temp.check((select confirmations from match_reports where match_id = :M and status = 'pending') = 2
  and (select shirt_number from match_reports where match_id = :M and status = 'pending') = 7, 'merged report has 2 confirmations and the added number');
select pg_temp.check((select count(*) from match_events where match_id = :M and deleted_at is null) = 1, 'pending report does not change the score');
-- partial report: only a shirt number of ours -> side filled in
select pg_temp.check((submit_match_report(:M, 'yellow', null, 4) ->> 'applied') = 'false', 'card report with only a number');
select pg_temp.check((select side from match_reports where kind = 'yellow' and match_id = :M) = 'home', 'number 4 is ours: side filled in');
select pg_temp.fails($$select review_match_report((select id from match_reports where kind = 'yellow' limit 1), true)$$, 'a parent cannot approve');
select pg_temp.fails($$select remove_match_event((select id from match_events limit 1))$$, 'a parent cannot remove a counted event while there is a primary');

-- the primary approves the goal, rejects the card
select pg_temp.as_user(:P1);
select review_match_report((select id from match_reports where match_id = :M and status = 'pending' and kind = 'goal'), true);
select review_match_report((select id from match_reports where match_id = :M and status = 'pending' and kind = 'yellow'), false);
select pg_temp.check((select count(*) from match_events where match_id = :M and kind = 'goal' and side = 'away' and deleted_at is null) = 1, 'approved goal counts');
select pg_temp.check((select count(*) from match_reports where match_id = :M and status = 'approved') = 2, 'merged report approved with it');
select pg_temp.check((select created_by from match_events where match_id = :M and side = 'away') = :P2, 'event keeps the original reporter');
select pg_temp.check((select count(*) from match_events where match_id = :M and kind = 'yellow') = 0, 'rejected card not counted');
-- primary's own card counts at once
select pg_temp.check((submit_match_report(:M, 'red', 'away', 5) ->> 'applied')::boolean, 'primary reports a red card directly');

-- halves
select match_clock(:M, 'end_period');
select pg_temp.check((match_live_state(:M) ->> 'status') = 'break' and not (match_live_state(:M) ->> 'running')::boolean, 'half time: clock stopped');
select match_clock(:M, 'start_period');
select pg_temp.check((match_live_state(:M) ->> 'period')::int = 2, 'second half');

-- hand-off: P2 gets the offer, ignores it for 60 s, P3 gets it
select release_match_reporter(:M);
select pg_temp.check((match_live_state(:M) ->> 'offer_to')::uuid = :P2 and match_live_state(:M) ->> 'reporter_id' is null, 'offer goes to the first in the queue');
select pg_temp.as_user(:P3);
select pg_temp.fails($$select claim_match_reporter('20000000-0000-0000-0000-0000000001e0')$$, 'others wait while the offer is open');
select pg_temp.check(not (submit_match_report(:M, 'goal', 'home', null) ->> 'applied')::boolean, 'while an offer is open reports wait');
select pg_temp.as_user(null);
update match_live set offer_at = now() - interval '61 seconds' where match_id = :M;
select pg_temp.as_user(:P3);
select pg_temp.check((match_live_state(:M) ->> 'offer_to')::uuid = :P3, 'after 60 s the offer moves to the next');
select answer_reporter_offer(:M, true);
select pg_temp.check((match_live_state(:M) ->> 'reporter_id')::uuid = :P3, 'new primary reporter');
select pg_temp.check((match_live_state(:M) ->> 'status') = 'running' and (match_live_state(:M) ->> 'period')::int = 2, 'new reporter continues from the same state');

-- finish and confirm
select match_clock(:M, 'finish');
select finalize_match_result(:M, 1, 1);
select pg_temp.check((select score_for = 1 and score_against = 1 and status = 'played' from team_matches where id = :M), 'final result written to the club match');
select pg_temp.fails($$select finalize_match_result('20000000-0000-0000-0000-0000000001e0', 2, 1)$$, 'reporter cannot change a final result');
select pg_temp.fails($$select remove_match_event((select id from match_events limit 1))$$, 'reporter cannot remove after final');

-- staff corrects afterwards
select pg_temp.as_user(:COACH);
select remove_match_event((select id from match_events where kind = 'red' limit 1));
select finalize_match_result(:M, 2, 1);
select pg_temp.check((select score_for from team_matches where id = :M) = 2, 'staff corrects the final result');

-- outsiders see nothing
select pg_temp.as_user(:OUT);
select pg_temp.check(match_live_state(:M) is null, 'outsider: no state');
select pg_temp.check((select count(*) from match_reports) = 0 and (select count(*) from match_live) = 0, 'outsider: no rows via RLS');
select pg_temp.fails($$select submit_match_report('20000000-0000-0000-0000-0000000001e0', 'goal', 'home')$$, 'outsider cannot report');
select pg_temp.fails($$insert into match_reports (match_id, team_id) values ('20000000-0000-0000-0000-0000000001e0', '10000000-0000-0000-0000-0000000001e0')$$, 'no direct writes');

select pg_temp.as_user(null);
