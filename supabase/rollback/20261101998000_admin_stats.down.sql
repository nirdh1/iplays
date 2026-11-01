-- Rollback of 20261101998000_admin_stats.sql. Removes the stats functions and
-- the presence table (it holds only user ids + last-seen times).
begin;
drop function if exists public.admin_stats();
drop function if exists public.admin_stats_count(text);
drop function if exists public.touch_presence();
drop table if exists public.user_presence;
commit;
