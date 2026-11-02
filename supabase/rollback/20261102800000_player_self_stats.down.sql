-- Rollback of 20261102800000_player_self_stats.sql.
-- WARNING: drops the self-reported goals/assists table and its rows.
begin;
drop function if exists public.player_self_stats_view(uuid);
drop function if exists public.remove_self_stat(uuid);
drop function if exists public.save_self_stat(uuid, uuid, uuid, date, text, int, int, text);
drop table if exists public.player_self_stats;
commit;
