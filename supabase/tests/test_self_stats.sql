-- Self-reported goals/assists on the career page: parent only writes, staff
-- read, outsiders see nothing, one report per app game, soft delete.
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

\set COACH '''00000000-0000-0000-0000-0000000002c0'''
\set PAR '''00000000-0000-0000-0000-0000000002a1'''
\set OTH '''00000000-0000-0000-0000-0000000002a2'''
\set OUT '''00000000-0000-0000-0000-0000000002ff'''
\set T '''10000000-0000-0000-0000-0000000002e0'''
\set M '''20000000-0000-0000-0000-0000000002e0'''
\set MF '''20000000-0000-0000-0000-0000000002e1'''
\set KID '''30000000-0000-0000-0000-0000000002e1'''

select pg_temp.as_user(null);
insert into auth.users (id, email, raw_user_meta_data) values
  (:COACH, 'scoach@test', '{"full_name":"מאמן"}'), (:PAR, 'spar@test', '{"full_name":"הורה"}'),
  (:OTH, 'soth@test', '{"full_name":"הורה אחר"}'), (:OUT, 'sout@test', '{"full_name":"זר"}');
insert into teams (id, name, created_by) values (:T, 'קבוצת דיווח', :COACH);
insert into team_members (team_id, user_id, role) values (:T, :COACH, 'coach'), (:T, :PAR, 'parent'), (:T, :OTH, 'parent')
  on conflict (team_id, user_id) do update set role = excluded.role;
insert into players (id, team_id, first_name, last_name) values (:KID, :T, 'נועם', 'בר');
insert into player_guardians (player_id, user_id, relation) values (:KID, :PAR, 'parent');
update player_assignments set started_on = current_date - 60 where player_id = :KID;
insert into team_matches (id, team_id, starts_at, opponent, home) values
  (:M, :T, now() - interval '3 days', 'מכבי יבנה', true),
  (:MF, :T, now() + interval '3 days', 'הפועל לוד', false);

select pg_temp.as_user(:PAR);
select pg_temp.check(jsonb_array_length(player_self_stats_view(:KID) -> 'recent_games') = 1, 'parent sees the one past game to pick');
select save_self_stat(:KID, null, :M, null, null, 2, 1, 'שני שערים מבחוץ');
select pg_temp.check((select opponent from player_self_stats where match_id = :M) = 'מכבי יבנה', 'app game fills opponent from the match');
-- reporting the same game again edits, not duplicates
select save_self_stat(:KID, null, :M, null, null, 3, 1, null);
select pg_temp.check((select count(*) from player_self_stats where player_id = :KID and deleted_at is null) = 1
  and (select goals from player_self_stats where match_id = :M) = 3, 'same game reported twice = one row, updated');
select save_self_stat(:KID, null, null, current_date - 10, 'אקדמיה פרטית', 1, 2, null);
select pg_temp.check((player_self_stats_view(:KID) -> 'totals' ->> 'goals')::int = 4
  and (player_self_stats_view(:KID) -> 'totals' ->> 'assists')::int = 3, 'totals 4 goals 3 assists');
select pg_temp.check((player_self_stats_view(:KID) -> 'recent_games' -> 0 ->> 'reported')::boolean, 'reported game is flagged');
select pg_temp.fails($$select save_self_stat('30000000-0000-0000-0000-0000000002e1', null, '20000000-0000-0000-0000-0000000002e1', null, null, 1, 0, null)$$, 'a future game cannot be reported');
select pg_temp.fails($$select save_self_stat('30000000-0000-0000-0000-0000000002e1', null, null, current_date + 1, 'x', 1, 0, null)$$, 'a future date cannot be reported');
select pg_temp.fails($$select save_self_stat('30000000-0000-0000-0000-0000000002e1', null, null, current_date, 'x', 31, 0, null)$$, 'more than 30 goals refused');
select pg_temp.check((select count(*) from match_events where match_id = '20000000-0000-0000-0000-0000000002e0') = 0, 'self report does not touch live match goals');

-- staff read, cannot write
select pg_temp.as_user(:COACH);
select pg_temp.check((player_self_stats_view(:KID) ->> 'can_edit')::boolean = false
  and (player_self_stats_view(:KID) -> 'totals' ->> 'games')::int = 2, 'coach reads, cannot edit');
select pg_temp.check(jsonb_array_length(player_self_stats_view(:KID) -> 'recent_games') = 0, 'coach gets no pick list');
select pg_temp.fails($$select save_self_stat('30000000-0000-0000-0000-0000000002e1', null, null, current_date, 'x', 1, 0, null)$$, 'coach cannot report');

-- another parent of the team, and an outsider: nothing
select pg_temp.as_user(:OTH);
select pg_temp.check(player_self_stats_view(:KID) is null, 'other team parent sees nothing');
select pg_temp.check((select count(*) from player_self_stats) = 0, 'other parent: RLS hides rows');
select pg_temp.fails($$select remove_self_stat((select id from player_self_stats limit 1))$$, 'other parent cannot delete');
select pg_temp.as_user(:OUT);
select pg_temp.check(player_self_stats_view(:KID) is null, 'outsider sees nothing');

-- parent deletes: soft
select pg_temp.as_user(:PAR);
select remove_self_stat((select id from player_self_stats where match_id = :M));
select pg_temp.check((player_self_stats_view(:KID) -> 'totals' ->> 'games')::int = 1, 'deleted report hidden');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from player_self_stats where player_id = :KID) = 2, 'deleted row kept (soft delete)');
