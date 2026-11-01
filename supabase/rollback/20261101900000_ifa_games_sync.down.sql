-- Rollback of 20261101900000_ifa_games_sync.sql. Keeps every table, column and
-- row (ifa_games, change history, notification queue, prefs, subscriptions,
-- team_matches rows that came from the IFA). Only functions, the guard
-- trigger and the policies are removed; running the migration again restores them.
begin;
drop trigger if exists team_matches_ifa_guard on public.team_matches;
drop function if exists public.team_matches_ifa_guard();
drop function if exists public.import_ifa_games(jsonb, boolean);
drop function if exists public.record_ifa_sync_failure(text, text, text);
drop function if exists public.set_ifa_team_category(int, int, text);
drop function if exists public.ifa_games_due(timestamptz);
drop function if exists public.set_push_mode(text);
drop function if exists public.claim_notifications(int);
drop function if exists public.complete_notification(uuid, boolean, text);
drop function if exists public.ifa_game_history(uuid, uuid, int);
drop function if exists public.notification_queue_stats();
drop function if exists public.ifa_enqueue_update(uuid);
drop function if exists public.ifa_mirror_game(uuid);
drop function if exists public.ifa_refresh_venue_hints(int);
drop function if exists public.ifa_home_venue(int, int);
drop function if exists public.ifa_time_label(time, boolean);
drop function if exists public.ifa_status_label(text);
drop policy if exists ifa_games_admin on public.ifa_games;
drop policy if exists ifa_game_updates_admin on public.ifa_game_updates;
drop policy if exists ifa_game_changes_admin on public.ifa_game_changes;
drop policy if exists app_settings_admin on public.app_settings;
drop policy if exists venue_locations_read on public.venue_locations;
drop policy if exists venue_location_history_admin on public.venue_location_history;
drop function if exists public.set_venue_location(text, text, double precision, double precision);
drop policy if exists notification_prefs_own on public.notification_prefs;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
drop policy if exists notification_outbox_own on public.notification_outbox;
commit;
