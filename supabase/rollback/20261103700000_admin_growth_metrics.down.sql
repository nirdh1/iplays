-- Rollback of 20261103700000_admin_growth_metrics.sql.
-- Removes the growth-metrics functions and the daily activity table (it holds
-- only user ids + dates). Keeps user_presence and touch_presence() (heartbeat
-- only); to drop them too, uncomment the last two lines.
begin;
drop function if exists public.admin_multi_child_users();
drop function if exists public.admin_growth_metrics(int);
drop function if exists public.admin_metric_count(text);
drop table if exists public.user_activity_days;
-- touch_presence() is restored to the presence-only version.
create or replace function public.touch_presence()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  insert into user_presence (user_id, last_seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at
  where user_presence.last_seen_at < now() - interval '30 seconds';
end;
$$;
drop function if exists public.il_today();
-- drop function if exists public.touch_presence();
-- drop table if exists public.user_presence;
commit;
