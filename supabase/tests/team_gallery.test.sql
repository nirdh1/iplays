-- Checks for 20261103400000_team_gallery.sql. Run on a TEST database only (it inserts users/teams):
-- local Postgres with Supabase stubs, all migrations applied, then: psql -f this file.
\set ON_ERROR_STOP 1
-- people: A,B parents of team 1; F follower of team 1; C coach of team 1; X parent of team 2
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','a@x','{"full_name":"אמא א"}'),
 ('00000000-0000-0000-0000-00000000000b','b@x','{"full_name":"אבא ב"}'),
 ('00000000-0000-0000-0000-00000000000f','f@x','{"full_name":"סבתא"}'),
 ('00000000-0000-0000-0000-00000000000c','c@x','{"full_name":"המאמן"}'),
 ('00000000-0000-0000-0000-0000000000ee','x@x','{"full_name":"זר"}');
update profiles set full_name = (select raw_user_meta_data->>'full_name' from auth.users u where u.id = profiles.id);
insert into teams (id, name, created_by) values ('10000000-0000-0000-0000-000000000001','ילדים א','00000000-0000-0000-0000-00000000000c'),
 ('10000000-0000-0000-0000-000000000002','קבוצה אחרת','00000000-0000-0000-0000-0000000000ee');
delete from team_members;
insert into team_members (team_id,user_id,role,is_follower) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','parent',false),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','parent',false),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000f','parent',true),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','coach',false),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000ee','parent',false);
insert into training_sessions (id, team_id, starts_at, title) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', now() - interval '1 day', 'אימון קבוצתי');
insert into training_sessions (id, team_id, starts_at, title) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002', now() - interval '1 day', 'אימון אחר');
insert into team_matches (id, team_id, starts_at, opponent) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', now() - interval '2 day', 'הפועל');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, false), set_config('role', 'authenticated', false); $$;
create function pg_temp.expect_fail(q text, frag text) returns text language plpgsql as $$
begin
  execute q; return 'UNEXPECTED SUCCESS: ' || q;
exception when others then
  if position(frag in sqlerrm) > 0 then return 'ok (blocked: ' || sqlerrm || ')'; end if;
  return 'WRONG ERROR: ' || sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

\echo '--- link validation'
select p, u, gallery_link_ok(p, u) from (values
 ('google_drive','https://drive.google.com/drive/folders/1AbC?usp=sharing'),
 ('google_photos','https://photos.app.goo.gl/AbCdEf123'),
 ('google_photos','https://photos.google.com/share/AF1Qip?key=abc'),
 ('icloud','https://www.icloud.com/sharedalbum/#B0aGWZuqDGWb'),
 ('icloud','https://share.icloud.com/photos/0abcDEF'),
 ('onedrive','https://1drv.ms/f/s!Abc'),
 ('dropbox','https://www.dropbox.com/scl/fo/abc?rlkey=x&dl=0'),
 ('google_drive','http://drive.google.com/drive/folders/1'),
 ('google_drive','javascript:alert(1)'),
 ('google_drive','https://drive.google.com.evil.com/x'),
 ('google_drive','https://evil.com@drive.google.com/x'),
 ('google_drive','https://drive.google.com:8443/x'),
 ('google_drive','https://drive.google.com/x"><script>'),
 ('icloud','https://drive.google.com/drive/folders/1'),
 ('onedrive','https://evil.sharepoint.com.attacker.io/x')
) v(p,u);

\echo '--- A publishes without consent -> blocked'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_fail($q$select publish_album('10000000-0000-0000-0000-000000000001','משחק נגד הפועל','google_photos','https://photos.app.goo.gl/abc','general',null,'30000000-0000-0000-0000-000000000001',null,false,'v1')$q$, 'consent required');
\echo '--- A publishes with consent, no approval needed (linked to the match)'
select publish_album('10000000-0000-0000-0000-000000000001','משחק נגד הפועל','google_photos','https://photos.app.goo.gl/abc','general',null,'30000000-0000-0000-0000-000000000001',null,true,'v1') is not null as published;
select title, category, provider, consent_by = auth.uid() consent_saved, consent_at is not null has_time, consent_version from team_albums;
\echo '--- A links an event of another team -> blocked; bad link -> blocked'
select pg_temp.expect_fail($q$select publish_album('10000000-0000-0000-0000-000000000001','x','google_drive','https://drive.google.com/drive/folders/1','training','20000000-0000-0000-0000-000000000002',null,null,true,'v1')$q$, 'event not in this team');
select pg_temp.expect_fail($q$select publish_album('10000000-0000-0000-0000-000000000001','x','google_drive','https://evil.com/x','general',null,null,null,true,'v1')$q$, 'bad link');
\echo '--- direct insert / update by a member is blocked (RPC only)'
select pg_temp.expect_fail($q$insert into team_albums (team_id,title,provider,url,consent_at,consent_by,consent_version) values ('10000000-0000-0000-0000-000000000001','x','google_drive','https://drive.google.com/x',now(),auth.uid(),'v1')$q$, 'permission denied');
select pg_temp.expect_fail($q$update team_albums set title='hack'$q$, 'permission denied');

\echo '--- B publishes an iCloud training album'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select publish_album('10000000-0000-0000-0000-000000000001','אימון שלישי','icloud','https://www.icloud.com/sharedalbum/#B0x','training','20000000-0000-0000-0000-000000000001',null,null,true,'v1') is not null as published;
\echo '--- follower F sees the gallery but cannot publish'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select count(*) as f_sees from team_gallery('10000000-0000-0000-0000-000000000001');
select pg_temp.expect_fail($q$select publish_album('10000000-0000-0000-0000-000000000001','x','google_drive','https://drive.google.com/drive/folders/1','general',null,null,null,true,'v1')$q$, 'not allowed');
\echo '--- X (other team) sees nothing: RLS rows = 0, RPC blocked, cannot report'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000ee');
select count(*) as x_rows from team_albums;
select pg_temp.expect_fail($q$select * from team_gallery('10000000-0000-0000-0000-000000000001')$q$, 'not allowed');
select pg_temp.expect_fail($q$select report_album((select id from team_albums limit 1),'privacy','')$q$, 'not allowed');
select pg_temp.expect_fail($q$select publish_album('10000000-0000-0000-0000-000000000001','x','google_drive','https://drive.google.com/drive/folders/1','general',null,null,null,true,'v1')$q$, 'not allowed');
\echo '--- anon sees nothing'
reset role; select set_config('request.jwt.claim.sub','',false); set role anon;
select pg_temp.expect_fail($q$select count(*) from team_albums$q$, 'permission denied');
reset role;

\echo '--- A edits title (no new consent) ; changes link without consent -> blocked ; with consent ok'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select update_album(a.id,'משחק נגד הפועל - מחצית 2','google_photos','https://photos.app.goo.gl/abc','match',null,a.match_id,null,false,'v1') from team_albums a where title like 'משחק%';
select pg_temp.expect_fail($q$select update_album((select id from team_albums where created_by=auth.uid()),'t','google_drive','https://drive.google.com/drive/folders/9','general',null,null,null,false,'v1')$q$, 'consent required');
select update_album(id,'משחק - דרייב','google_drive','https://drive.google.com/drive/folders/9','general',null,null,null,true,'v1') from team_albums where created_by=auth.uid();
select title, provider, url, category from team_albums where created_by=auth.uid();
\echo '--- A cannot edit or delete B album'
select pg_temp.expect_fail($q$select update_album((select id from team_albums where title like 'אימון%'),'hack','icloud','https://www.icloud.com/sharedalbum/#B0x','training',null,null,null,true,'v1')$q$, 'not allowed');
select pg_temp.expect_fail($q$select remove_album((select id from team_albums where title like 'אימון%'))$q$, 'not allowed');
\echo '--- A reports B album for privacy; twice -> blocked'
select report_album(id,'minor','הבן שלי מופיע, בבקשה להסיר') from team_albums where title like 'אימון%';
select pg_temp.expect_fail($q$select report_album((select id from team_albums where title like 'אימון%'),'minor','')$q$, 'already reported');
\echo '--- coach C sees open report and removes B album (moderation)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select title, open_reports from team_gallery('10000000-0000-0000-0000-000000000001') order by title;
select reason, reporter from album_reports((select id from team_albums where title like 'אימון%'));
select remove_album(id,'בקשת הורה - פרטיות') from team_albums where title like 'אימון%';
\echo '--- A no longer sees it; B (publisher) sees it as removed'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select title from team_gallery('10000000-0000-0000-0000-000000000001');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select title, removed_at is not null as removed, removed_reason from team_gallery('10000000-0000-0000-0000-000000000001') where title like 'אימון%';
\echo '--- A deletes own album (row gone)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select remove_album(id) from team_albums where created_by=auth.uid();
select count(*) as a_left from team_albums where created_by=auth.uid();
reset role;
\echo '--- notifications'
select p.full_name as to_user, n.kind, n.title, n.body from notification_outbox n join profiles p on p.id=n.user_id order by n.created_at, p.full_name;
\echo '--- no storage objects were created'
select count(*) storage_objects from storage.objects;
