-- Rollback of 20261103200000_player_ifa_stats.sql. The table and its rows stay.
begin;
drop function if exists public.remove_ifa_stats(uuid);
drop function if exists public.save_ifa_stats(uuid, text, text, jsonb, text);
drop function if exists public.player_ifa_links(uuid);
commit;
