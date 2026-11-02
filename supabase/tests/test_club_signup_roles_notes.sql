-- Club sign-up by city, custom roles and confidential coach notes.
-- Runs after every other migration (needs inbox notifications).
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

-- users: platform admin, would-be owner, coach, second coach, treasurer,
-- permissions manager, parent, other club's owner
\set PA '''c0000000-0000-0000-0000-000000000001'''
\set OW '''c0000000-0000-0000-0000-000000000002'''
\set CO '''c0000000-0000-0000-0000-000000000003'''
\set C2 '''c0000000-0000-0000-0000-000000000004'''
\set TR '''c0000000-0000-0000-0000-000000000005'''
\set PM '''c0000000-0000-0000-0000-000000000006'''
\set PR '''c0000000-0000-0000-0000-000000000007'''
\set O2 '''c0000000-0000-0000-0000-000000000008'''
\set TA '''c1000000-0000-0000-0000-000000000001'''
\set TB '''c1000000-0000-0000-0000-000000000002'''
\set KID '''c2000000-0000-0000-0000-000000000001'''

select pg_temp.as_user(null);
insert into auth.users (id, email) values
  (:PA, 'pa@t'), (:OW, 'ow@t'), (:CO, 'co@t'), (:C2, 'c2@t'), (:TR, 'tr@t'), (:PM, 'pm@t'), (:PR, 'pr@t'), (:O2, 'o2@t');
update profiles set full_name = 'מאמן ראשון' where id = :CO;
insert into platform_admins (user_id) values (:PA) on conflict do nothing;

-- two IFA league teams with no club yet
insert into teams (id, name, created_by) values
  (:TA, 'הפועל לוד ילדים א', :PA), (:TB, 'הפועל לוד ילדים ב', :PA);
insert into ifa_teams (ifa_season_id, ifa_team_id, name, team_id) values
  (28, 990001, 'מ.ס. הפועל לוד "צו פיוס"', :TA), (28, 990002, 'מ.ס. הפועל לוד "צו פיוס"', :TB);

-- ------------------------------------------------------------ catalog

select pg_temp.as_user(:OW);
select pg_temp.fails($$select * from ifa_club_suggestions()$$, 'regular user cannot see IFA club suggestions');
select pg_temp.fails($$select catalog_club_teams(null, 'x', 'y', '{}')$$, 'regular user cannot build the catalog');

select pg_temp.as_user(:PA);
select pg_temp.check((select team_names = array['הפועל לוד ילדים א', 'הפועל לוד ילדים ב'] from ifa_club_suggestions()
                      where base_name = 'מ.ס. הפועל לוד'), 'suggestion groups both teams and drops the sponsor tag');
select catalog_club_teams(null, 'מ.ס. הפועל לוד', 'לוד', array[:TA, :TB]::uuid[]) as lod \gset
select pg_temp.check((select status = 'catalog' and ifa_registered from clubs where id = :'lod'), 'catalog club created');
select pg_temp.check((select count(*) = 2 from teams where club_id = :'lod'), 'IFA teams attached to the catalog club');
select pg_temp.check((select count(*) = 8 from club_roles where club_id = :'lod'), 'default role templates seeded');

-- -------------------------------------------------------- sign-up flow

select pg_temp.as_user(:OW);
select pg_temp.check((select count(*) = 1 from search_clubs_by_city('לוד') where club_id = :'lod' and not managed and my_status is null),
                     'city search lists the catalog club as unmanaged');
select pg_temp.check((select count(*) = 2 from signup_club_teams(array[:'lod']::uuid[])), 'teams of the picked club');
select pg_temp.check(not is_club_admin(:'lod'), 'picking a club gives no rights');
select request_club_access(array[:'lod']::uuid[], '{}', 'club_admin', 'coach', 'יו"ר', 'אני היו"ר', '050') as n \gset
select pg_temp.check(:n = 1, 'admin request sent');
select pg_temp.check((select my_status = 'pending' from search_clubs_by_city('לוד') where club_id = :'lod'), 'search shows pending');
select pg_temp.check(not is_club_admin(:'lod'), 'still no rights while pending');
select id as req from club_access_requests where user_id = :OW and club_id = :'lod' \gset
select pg_temp.fails(format('select review_club_access(%L, true)', :'req'), 'requester cannot approve own request');

select pg_temp.as_user(:CO);
select pg_temp.fails(format('select review_club_access(%L, true)', :'req'), 'outsider cannot approve');
select pg_temp.check((select count(*) = 0 from pending_club_access_requests()), 'outsider sees no requests');
select pg_temp.check((select count(*) = 0 from club_access_requests), 'outsider cannot read requests table');

select pg_temp.as_user(:PA);
select pg_temp.check((select count(*) = 1 from pending_club_access_requests() where id = :'req'), 'platform admin sees request for unmanaged club');
select pg_temp.check((select count(*) >= 1 from notification_outbox where user_id = :PA and kind = 'join_request'), 'platform admin notified');
select review_club_access(:'req', true, 'אומת בטלפון');

select pg_temp.as_user(:OW);
select pg_temp.check((select role = 'owner' from club_staff where club_id = :'lod' and user_id = :OW), 'approved requester is the owner');
select pg_temp.check((select status = 'verified' from clubs where id = :'lod'), 'catalog club verified on approval');
select pg_temp.check((select 'club' = any(account_types) from profiles where id = :OW), 'owner gets club tools');

-- a coach asks for one team; now the club owner reviews, not the platform
select pg_temp.as_user(:CO);
select pg_temp.fails(format('select request_club_access(array[%L]::uuid[], ''{}'', ''team_staff'')', :'lod'), 'team request needs a team');
select request_club_access(array[:'lod']::uuid[], array[:TA]::uuid[], 'team_staff', 'coach');
select id as req2 from club_access_requests where user_id = :CO \gset
select pg_temp.as_user(:OW);
select pg_temp.check((select count(*) >= 1 from notification_outbox where user_id = :OW and kind = 'join_request'), 'club owner notified');
select review_club_access(:'req2', true);
select pg_temp.check((select role = 'admin' from team_members where team_id = :TA and user_id = :CO), 'approved coach manages the team (first staff -> team admin)');
select pg_temp.check((select count(*) = 1 from my_workspaces()), 'owner workspace');
select pg_temp.as_user(:CO);
select pg_temp.check((select count(*) = 1 from my_workspaces() where club_id = :'lod'), 'coach sees the club in the workspace switcher');
select pg_temp.check(not can(:TB, 'roster', 1), 'coach of team A has no access to team B');

-- manual club: duplicate in the same city refused, academy allowed
select pg_temp.as_user(:O2);
select pg_temp.fails($$select create_club_manual('מ.ס. הפועל לוד', 'לוד')$$, 'duplicate club in the same city refused');
select create_club_manual('אקדמיית הכוכבים', 'רמלה', 'academy') as club2 \gset
select pg_temp.check((select kind = 'academy' and status = 'draft' from clubs where id = :'club2'), 'manual academy opened as draft');
select pg_temp.check((select count(*) = 1 from club_programs where club_id = :'club2'), 'academy gets one program');

-- --------------------------------------------------------------- roles

select pg_temp.as_user(:OW);
select id as treasurer from club_roles where club_id = :'lod' and name = 'גזבר' \gset
select id as admin_role from club_roles where club_id = :'lod' and name = 'מנהל מועדון' \gset
select create_club_role_invite(:'lod', :'treasurer') as code \gset
select save_club_role(:'lod', null, 'מאמן אנליזה', 'וידאו', '{"metrics": 3, "matches": 1}') as analyst \gset
select pg_temp.check((select perms = '{"metrics": 3, "matches": 1}'::jsonb from club_roles_list(:'lod') where id = :'analyst'), 'custom role saved');
select pg_temp.fails(format($$select save_club_role(%L, null, 'x', '', '{"nope": 2}')$$, :'lod'), 'unknown domain refused');

select pg_temp.as_user(:TR);
select pg_temp.check(not can_club(:'lod', 'finance', 1), 'treasurer has nothing before accepting');
select accept_club_invite(:'code');
select pg_temp.check(can_club(:'lod', 'finance', 4), 'treasurer role gives club-wide finance');
select pg_temp.check(can(:TA, 'finance', 4) and can(:TB, 'finance', 4), 'treasurer role reaches every team');
select pg_temp.check(not can(:TA, 'training', 2), 'treasurer cannot create trainings');
select pg_temp.check(not can_manage_roles(:'lod'), 'treasurer cannot manage roles');
select pg_temp.fails(format('select assign_club_role(%L, %L, %L)', :'lod', :'treasurer', :TR), 'treasurer cannot assign roles');
select pg_temp.check((select (my_club_access(:'lod')->'domains'->>'finance')::int = 4), 'my_club_access reports finance');

-- a permissions manager (non-admin) — limited
select pg_temp.as_user(:PM);
select pg_temp.as_user(:OW);
select create_club_invite(:'lod', 'staff') as pmcode \gset
select pg_temp.as_user(:PM);
select accept_club_invite(:'pmcode');
select pg_temp.as_user(:OW);
select set_permission(:'lod', :PM, 'permissions', 4);
select pg_temp.as_user(:PM);
select pg_temp.check(can_manage_roles(:'lod'), 'permissions manager can manage roles');
select pg_temp.fails(format($$select save_club_role(%L, null, 'על', '', '{"permissions": 4}')$$, :'lod'), 'manager cannot hand out the permissions domain');
select pg_temp.fails(format('select assign_club_role(%L, %L, %L)', :'lod', :'admin_role', :CO), 'manager cannot assign a sensitive role');
select pg_temp.fails(format('select assign_club_role(%L, %L, %L)', :'lod', :'treasurer', :PM), 'manager cannot give roles to themselves');
select assign_club_role(:'lod', :'analyst', :CO, null, :TB::uuid) as asg \gset
select pg_temp.as_user(:CO);
select pg_temp.check(can(:TB, 'metrics', 3) and not can(:TB, 'metrics', 4), 'team-scoped custom role gives its level on that team');
select pg_temp.check(can_see_team(:TB), 'team-scoped role lets the coach see the team');
select pg_temp.as_user(:OW);
select archive_club_role(:'analyst');
select pg_temp.as_user(:CO);
select pg_temp.check(not can(:TB, 'metrics', 1), 'archived role stops giving access');

-- isolation between clubs
select pg_temp.as_user(:O2);
select pg_temp.check((select count(*) = 0 from club_roles_list(:'lod')), 'other club owner cannot list our roles');
select pg_temp.check((select count(*) = 0 from club_roles where club_id = :'lod'), 'other club owner cannot read our roles table');
select pg_temp.check((select count(*) = 0 from club_role_assignment_list(:'lod')), 'other club owner cannot list our assignments');
select pg_temp.check(not can_club(:'lod', 'finance', 1), 'other club owner has no finance in our club');
select pg_temp.fails(format('select save_club_role(%L, null, ''x'', '''', ''{}'')', :'lod'), 'other club owner cannot create roles here');

-- --------------------------------------------------------------- notes

select pg_temp.as_user(:OW);
insert into players (id, team_id, first_name, last_name, created_by) values (:KID, :TA, 'יואב', 'כהן', :OW);
select pg_temp.as_user(null);
insert into player_guardians (player_id, user_id) values (:KID, :PR);
insert into team_members (team_id, user_id, role) values (:TA, :PR, 'parent'), (:TB, :C2, 'coach');

select pg_temp.as_user(:CO);
select pg_temp.check(pro_notes_level(:'lod', :KID) >= 2, 'coach of the team can write notes');
select add_pro_note(:'lod', :KID, 'improvement', 'לעבוד על רגל שמאל', :TA::uuid) as note \gset
select pg_temp.check((select author_name = 'מאמן ראשון' from player_pro_notes where id = :'note'), 'note keeps the author name');

select pg_temp.as_user(:PR);
select pg_temp.check(pro_notes_level(:'lod', :KID) = 0, 'parent has no access to notes');
select pg_temp.check((select count(*) = 0 from player_pro_notes), 'parent cannot read notes');
select pg_temp.fails(format('select add_pro_note(%L, %L, ''note'', ''x'')', :'lod', :KID), 'parent cannot write notes');

select pg_temp.as_user(:TR);
select pg_temp.check((select count(*) = 0 from player_pro_notes), 'treasurer (no pro_notes) cannot read notes');

select pg_temp.as_user(:O2);
select pg_temp.check((select count(*) = 0 from player_pro_notes), 'other club cannot read notes');

select pg_temp.as_user(:C2);
select pg_temp.check((select count(*) = 0 from player_pro_notes), 'coach of another team cannot read notes yet');
select pg_temp.fails(format('select update_pro_note(%L, ''note'', ''x'')', :'note'), 'coach of another team cannot edit');

-- the player moves to team B in the same club: team B coach now sees the history
select pg_temp.as_user(:OW);
select transfer_player(:KID, :TB, 'move', :TA, 'מעבר קבוצה');
select pg_temp.as_user(:C2);
select pg_temp.check((select count(*) = 1 from player_pro_notes where id = :'note'), 'new coach in the same club sees earlier notes');
select pg_temp.as_user(:CO);
select pg_temp.check((select count(*) = 0 from player_pro_notes), 'old team coach loses access after the move');

-- the coach leaves the club: the note stays with the club
select pg_temp.as_user(null);
delete from team_members where user_id = :CO;
delete from club_staff where user_id = :CO;
select pg_temp.as_user(:OW);
select pg_temp.check((select count(*) = 1 from player_pro_notes where id = :'note' and author_name = 'מאמן ראשון'), 'club keeps the note after the coach leaves');
select archive_pro_note(:'note');
select pg_temp.check((select archived_at is not null from player_pro_notes where id = :'note'), 'owner archives (no delete)');
select pg_temp.check(not has_table_privilege('authenticated', 'public.player_pro_notes', 'DELETE'), 'no delete grant on notes');

select pg_temp.as_user(null);
