-- Unified calendar, personal / goalkeeper trainings, absences by activity
-- type, medical documents and attendance reports.
-- Runs after 20261102100000_calendar_absences.sql (self-contained data).
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

\set COACH '''00000000-0000-0000-0000-0000000000c1'''
\set TM '''00000000-0000-0000-0000-0000000000c2'''
\set MOM '''00000000-0000-0000-0000-0000000000c3'''
\set DAD '''00000000-0000-0000-0000-0000000000c4'''
\set OUT '''00000000-0000-0000-0000-0000000000c5'''
\set STR '''00000000-0000-0000-0000-0000000000c6'''
\set CT '''10000000-0000-0000-0000-0000000000c1'''
\set GK '''20000000-0000-0000-0000-0000000000c1'''
\set K2 '''20000000-0000-0000-0000-0000000000c2'''
\set K3 '''20000000-0000-0000-0000-0000000000c3'''

select pg_temp.as_user(null);
insert into auth.users (id, email) values (:COACH, 'coach@cal'), (:TM, 'tm@cal'), (:MOM, 'mom@cal'), (:DAD, 'dad@cal'), (:OUT, 'out@cal'), (:STR, 'str@cal');
insert into teams (id, name, club, sport, created_by) values (:CT, 'יומן FC', 'בדיקה', 'football', :COACH);
insert into team_members (team_id, user_id, role) values
  (:CT, :COACH, 'coach'), (:CT, :TM, 'team_manager'), (:CT, :MOM, 'parent'), (:CT, :DAD, 'parent'), (:CT, :OUT, 'parent')
on conflict (team_id, user_id) do update set role = excluded.role;
insert into players (id, team_id, first_name, last_name, birth_year, position, created_by) values
  (:GK, :CT, 'גיא', 'שוער', 2015, 'שוער', :COACH),
  (:K2, :CT, 'דן', 'בלם', 2015, 'בלם', :COACH),
  (:K3, :CT, 'עידו', 'חלוץ', 2015, 'חלוץ', :COACH);
insert into player_guardians (player_id, user_id, relation) values (:GK, :MOM, 'parent'), (:K2, :DAD, 'parent'), (:K3, :OUT, 'parent');
update player_assignments set started_on = current_date - 30 where team_id = :CT;
select pg_temp.check((select count(*) from player_assignments where team_id = :CT and ended_on is null) = 3, 'setup: three players in the team');
select pg_temp.check(is_goalkeeper(:GK) and not is_goalkeeper(:K2), 'goalkeeper from the position');

-- --------------------------------------------------- personal trainings
select pg_temp.as_user(:MOM);
select pg_temp.check(cardinality(create_trainings(:CT, 'personal', 'players',
  array[now() + interval '2 days', now() + interval '9 days'], 60, null, 'פארק הירקון', '', array[:GK, :K2]::uuid[])) = 2,
  'parent adds a weekly personal training with a teammate');
select pg_temp.check((select count(distinct series_id) from training_sessions where team_id = :CT and kind = 'personal') = 1, 'the two dates share one series');
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and kind = 'personal') = 2, 'creator sees the personal trainings');
select pg_temp.check((select title from training_sessions where team_id = :CT and kind = 'personal' limit 1) = 'אימון אישי', 'default title');
select pg_temp.fails(format('select create_trainings(%L, %L, %L, array[now() + interval ''1 day''])', :CT, 'personal', 'players'), 'personal training without players');
select pg_temp.fails(format('select create_trainings(%L, %L, %L, array[now() + interval ''1 day''])', :CT, 'personal', 'team'), 'invalid type / audience');

select pg_temp.as_user(:DAD);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and kind = 'personal') = 2, 'participant''s family sees it');
select pg_temp.check((select count(*) from training_participants tp join training_sessions s on s.id = tp.session_id where s.kind = 'personal') = 4, 'and its participants');
select pg_temp.as_user(:OUT);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and kind = 'personal') = 0, 'other parent in the team does not see it');
select pg_temp.check((select count(*) from training_participants) = 0, 'nor its participants');
select pg_temp.fails(format('select create_trainings(%L, %L, %L, array[now() + interval ''1 day''], 60, null, '''', '''', array[%L]::uuid[])', :CT, 'personal', 'players', :GK),
  'parent books a personal training for someone else''s child only');
delete from training_sessions where team_id = :CT and kind = 'personal';
select pg_temp.as_user(:COACH);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and kind = 'personal') = 0, 'coach does not see a family''s personal training');
delete from training_sessions where team_id = :CT and kind = 'personal';
select pg_temp.as_user(:STR);
select pg_temp.fails(format('select create_trainings(%L, %L, %L, array[now() + interval ''1 day''], 60, null, '''', '''', array[%L]::uuid[])', :CT, 'personal', 'players', :GK),
  'outsider adds a training');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and kind = 'personal') = 2, 'nobody else could delete them');
select pg_temp.check((select count(*) from notification_outbox where kind = 'training' and user_id = :DAD and url = '#calendar') = 1, 'teammate''s family notified once for the series');
select pg_temp.check((select count(*) from notification_outbox where kind = 'training' and user_id in (:OUT, :COACH) and url = '#calendar') = 0, 'nobody else notified');

-- creator keeps type / audience
select pg_temp.as_user(:MOM);
update training_sessions set audience = 'team', kind = 'team', location = 'גן העיר' where team_id = :CT and kind = 'personal';
select pg_temp.as_user(null);
select pg_temp.check((select bool_and(audience = 'players' and location = 'גן העיר') from training_sessions where team_id = :CT and kind = 'personal'),
  'edit keeps the audience, changes the place');

-- ------------------------------------------------- goalkeeper trainings
select pg_temp.as_user(:DAD);
select pg_temp.fails(format('select create_trainings(%L, %L, %L, array[now() + interval ''3 days''])', :CT, 'goalkeeper', 'goalkeepers'),
  'parent of a non-goalkeeper adds a goalkeepers'' training');
select pg_temp.as_user(:COACH);
select create_trainings(:CT, 'goalkeeper', 'goalkeepers', array[now() + interval '3 days']);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and audience = 'goalkeepers') = 1, 'coach sees the goalkeepers'' training');
select pg_temp.as_user(:MOM);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and audience = 'goalkeepers') = 1, 'goalkeeper''s parent sees it');
select pg_temp.as_user(:DAD);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and audience = 'goalkeepers') = 0, 'other parents do not');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) from notification_outbox where user_id = :MOM and title = 'אימון שוערים חדש') = 1, 'goalkeeper''s parent notified');
select pg_temp.check((select count(*) from notification_outbox where user_id = :DAD and title like '%שוערים%') = 0, 'other parents not notified');

-- goalkeeper coach picks any player (not only goalkeepers)
select pg_temp.as_user(:COACH);
select create_trainings(:CT, 'goalkeeper', 'players', array[now() - interval '2 days'], 60, 'שוערים + בלמים', '', '', array[:K2]::uuid[]);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and title = 'שוערים + בלמים') = 1, 'coach sees the session they built');
select pg_temp.check((select count(*) from event_attendance('training', (select id from training_sessions where title = 'שוערים + בלמים'))) = 1,
  'its attendance roster is only the picked player');
select pg_temp.fails(format('select mark_attendance(%L, %L, %L, %L)', 'training', (select id from training_sessions where title = 'שוערים + בלמים'), :K3, 'present'),
  'marking a player who was not picked');
select pg_temp.as_user(:DAD);
select pg_temp.check((select count(*) from training_sessions where title = 'שוערים + בלמים') = 1, 'the picked player''s family sees it');
select pg_temp.as_user(:MOM);
select pg_temp.check((select count(*) from training_sessions where title = 'שוערים + בלמים') = 0, 'others do not');

-- team training: everybody, as before
select pg_temp.as_user(:COACH);
insert into training_sessions (team_id, starts_at, title) values (:CT, now() - interval '1 day', 'אימון קבוצתי');
select pg_temp.as_user(:OUT);
select pg_temp.check((select count(*) from training_sessions where team_id = :CT and audience = 'team') = 1, 'team training visible to every parent');

-- ------------------------------------------------------------ absences
select pg_temp.as_user(null);
insert into team_matches (team_id, starts_at, opponent, home) values (:CT, now() - interval '1 day' + interval '2 hours', 'יריבה', true);
select id as tr from training_sessions where team_id = :CT and audience = 'team' \gset
select id as mt from team_matches where team_id = :CT and opponent = 'יריבה' \gset

select pg_temp.as_user(:DAD);
insert into player_absences (player_id, from_date, to_date, reason, applies_to, reported_by)
values (:K2, current_date - 3, current_date + 30, 'injury', 'match', :DAD);
select pg_temp.check((select applies_to from player_absences where player_id = :K2) = 'match', 'injury absence for matches only');
select pg_temp.fails(format('insert into player_absences (player_id, from_date, to_date, reason, reported_by) values (%L, current_date, current_date, %L, %L)', :K2, 'boredom', :DAD),
  'unknown reason');
select pg_temp.as_user(:COACH);
select pg_temp.check((select expected from event_attendance('match', :'mt') where player_id = :K2) = 'absent', 'range covers the match');
select pg_temp.check((select expected from event_attendance('training', :'tr') where player_id = :K2) = 'coming', 'but not the training');
-- a match added later inside the range is covered automatically
select pg_temp.as_user(null);
insert into team_matches (team_id, starts_at, opponent, home) values (:CT, now() + interval '10 days', 'חדשה', false);
select pg_temp.as_user(:COACH);
select pg_temp.check((select expected from event_attendance('match', (select id from team_matches where opponent = 'חדשה')) where player_id = :K2) = 'absent',
  'new match inside the range is marked');

-- edit: shorten the range, reporter kept
select pg_temp.as_user(:DAD);
update player_absences set to_date = current_date - 2, applies_to = 'all' where player_id = :K2;
select pg_temp.as_user(null);
select pg_temp.check((select reported_by = :DAD and updated_at is not null from player_absences where player_id = :K2), 'shortened; reporter kept, update time set');
select pg_temp.as_user(:COACH);
select pg_temp.check((select expected from event_attendance('match', :'mt') where player_id = :K2) = 'coming', 'shortened range no longer covers the match');
select pg_temp.as_user(:DAD);
update player_absences set to_date = current_date + 5 where player_id = :K2;

-- ------------------------------------------------------ attendance data
select pg_temp.as_user(:COACH);
select mark_attendance('training', :'tr', :GK, 'late', 10);
select pg_temp.check((select count(*) from attendance_report(:CT, current_date - 30, current_date)) = 3 + 3 + 1,
  'report: 3 players x (training + match) + the picked player''s session');
select pg_temp.check((select status from attendance_report(:CT, current_date - 30, current_date) where player_id = :K2 and kind = 'match') = 'absent'
  and (select reason from attendance_report(:CT, current_date - 30, current_date) where player_id = :K2 and kind = 'match') = 'injury',
  'report has the status and the reason');
select pg_temp.check((select source from attendance_report(:CT, current_date - 30, current_date) where player_id = :GK and kind = 'training') = 'mark', 'report source: mark');
select pg_temp.check((select rate from team_attendance_summary(:CT, current_date - 30, current_date) where player_id = :K2) = 0, 'summary rate: all three inside the absence range');

select pg_temp.as_user(:DAD);
select pg_temp.check((select count(*) from attendance_report(:CT, current_date - 30, current_date)) = 0, 'parents get no team report');
select pg_temp.check((select count(*) from player_attendance(:K2, current_date - 30, current_date)) = 3, 'parent sees own child''s attendance');
select pg_temp.check((select count(*) from player_attendance(:GK, current_date - 30, current_date)) = 0, 'but not another child''s');

-- personal training in the past: counted for the family, not in the team report
select pg_temp.as_user(:MOM);
select create_trainings(:CT, 'personal', 'players', array[now() - interval '3 days'], 60, 'אימון כוח', '', '', array[:GK]::uuid[]);
select pg_temp.check((select count(*) from player_attendance(:GK, current_date - 30, current_date) where kind = 'training') = 2, 'family stats include the personal training');
select pg_temp.check(((player_career(:GK)) -> 'totals' ->> 'trainings')::int = 2, 'career counts it too');
select pg_temp.as_user(:COACH);
select pg_temp.check((select count(*) from attendance_report(:CT, current_date - 30, current_date) where player_id = :GK) = 2, 'team report leaves it out');
select pg_temp.check(((player_career(:GK)) -> 'totals' ->> 'trainings')::int = 1, 'staff career view leaves it out');

-- ---------------------------------------------------- medical documents
select pg_temp.as_user(:DAD);
select id as ab from player_absences where player_id = :K2 \gset
insert into storage.objects (bucket_id, name) values ('medical-docs', :'ab' || '/a.pdf');
insert into absence_documents (absence_id, player_id, team_id, storage_path, file_name, mime, size_bytes, uploaded_by)
values (:'ab', :K2, :CT, :'ab' || '/a.pdf', 'אישור.pdf', 'application/pdf', 1000, :DAD);
select pg_temp.check((select count(*) from absence_documents) = 1, 'parent uploads and sees the document');
select pg_temp.fails(format('insert into absence_documents (absence_id, player_id, team_id, storage_path, mime, size_bytes, uploaded_by) values (%L, %L, %L, %L, %L, 10, %L)',
  :'ab', :K2, :CT, 'elsewhere/a.pdf', 'application/pdf', :DAD), 'document stored outside its absence folder');
select pg_temp.as_user(:OUT);
select pg_temp.fails(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'medical-docs', :'ab' || '/b.pdf'), 'other parent uploads to that absence');
select pg_temp.check((select count(*) from absence_documents) = 0 and (select count(*) from storage.objects) = 0, 'other parent sees no documents');
select pg_temp.as_user(:COACH);
select pg_temp.check((select count(*) from absence_documents) = 0 and (select count(*) from storage.objects) = 0, 'coach (medical level 1) sees no documents');
select pg_temp.check((select count(*) from player_absences where player_id = :K2) = 1, 'coach still sees the absence itself');
select pg_temp.as_user(:TM);
select pg_temp.check((select count(*) from absence_documents) = 1 and (select count(*) from storage.objects) = 1, 'team manager (medical level 3) sees the document');
delete from absence_documents;
select pg_temp.check((select count(*) from absence_documents) = 1, 'team manager cannot delete it');
select pg_temp.as_user(null);
