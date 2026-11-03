-- Rollback of 20261103400000_team_gallery.sql.
-- Drops the gallery tables (album links, reports) and their functions.
-- Nothing in anyone's cloud is affected: iplays only kept the links.
-- The notification kinds stay allowed (old gallery notifications remain in the bell).

begin;

drop function if exists public.album_reports(uuid);
drop function if exists public.resolve_album_reports(uuid);
drop function if exists public.report_album(uuid, text, text);
drop function if exists public.restore_album(uuid);
drop function if exists public.remove_album(uuid, text);
drop function if exists public.update_album(uuid, text, text, text, text, uuid, uuid, date, boolean, text);
drop function if exists public.publish_album(uuid, text, text, text, text, uuid, uuid, date, boolean, text);
drop function if exists public.team_gallery(uuid);

drop table if exists public.team_album_reports;
drop table if exists public.team_albums;

drop function if exists public.team_albums_before();
drop function if exists public.gallery_check_event(uuid, uuid, uuid);
drop function if exists public.gallery_actor();
drop function if exists public.gallery_moderator_ids(uuid);
drop function if exists public.gallery_can_moderate(uuid);
drop function if exists public.gallery_can_post(uuid);
drop function if exists public.gallery_can_view(uuid);
drop function if exists public.gallery_link_ok(text, text);

commit;
