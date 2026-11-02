-- Load a game schedule from a file: staff and parents import, outsiders can't,
-- duplicates and IFA days are skipped, unknown times stay unconfirmed.
-- Runs after test_match_overrides.sql (uses the M4 data: A staff + C parent of T1, E outsider).
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

\set A '''00000000-0000-0000-0000-00000000000a'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set E '''00000000-0000-0000-0000-00000000000e'''
\set T1 '''10000000-0000-0000-0000-000000000001'''

select pg_temp.as_user(:E);
select pg_temp.check(not can_import_matches(:T1), 'outsider cannot import');
select pg_temp.fails(format('select import_team_matches(%L, %L)', :T1,
  '[{"starts_at": "2027-01-10T08:00:00Z", "opponent": "x"}]'), 'outsider importing');

select pg_temp.as_user(:C);
select pg_temp.check(can_import_matches(:T1), 'parent can import');
select pg_temp.check(import_team_matches(:T1, '[
  {"starts_at": "2027-01-10T08:00:00Z", "time_known": true,  "opponent": "מכבי קובץ", "home": true,  "venue": "מגרש א", "competition": "league", "note": "מחזור 1"},
  {"starts_at": "2027-01-17T22:00:00Z", "time_known": false, "opponent": "הפועל קובץ", "home": false, "venue": "", "competition": "nonsense"}
]'::jsonb) = '{"added": 2, "skipped": 0}'::jsonb, 'parent imports two games');
select pg_temp.check((select count(*) from team_matches where opponent in ('מכבי קובץ', 'הפועל קובץ') and source = 'club') = 2, 'imported games are club games');
select pg_temp.check((select time_confirmed from team_matches where opponent = 'הפועל קובץ') = false, 'unknown time stays unconfirmed');
select pg_temp.check((select competition from team_matches where opponent = 'הפועל קובץ') = 'league', 'bad competition falls back to league');
select pg_temp.check((select time_confirmed from team_matches where opponent = 'מכבי קובץ'), 'known time is confirmed');

-- same day + same opponent: skipped (also the second run of the same file)
select pg_temp.as_user(:A);
select pg_temp.check(import_team_matches(:T1, '[
  {"starts_at": "2027-01-10T10:00:00Z", "opponent": " מכבי קובץ "},
  {"starts_at": "2027-01-24T08:00:00Z", "opponent": "בית\"ר קובץ"}
]'::jsonb) = '{"added": 1, "skipped": 1}'::jsonb, 'staff import skips a duplicate');
select pg_temp.fails(format('select import_team_matches(%L, %L)', :T1, '[{"starts_at": "2027-02-01T08:00:00Z", "opponent": ""}]'), 'game without opponent');

-- setting the time confirms it
select id as unk from team_matches where opponent = 'הפועל קובץ' \gset
update team_matches set starts_at = '2027-01-18T07:30:00Z' where id = :'unk';
select pg_temp.as_user(null);
select pg_temp.check((select time_confirmed from team_matches where id = :'unk'), 'setting the time confirms it');
