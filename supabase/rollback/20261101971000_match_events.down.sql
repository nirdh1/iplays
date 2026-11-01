-- Rollback of 20261101971000_match_events.sql.
-- Keeps the match_events table and every report in it (running the migration
-- again picks them up); removes the functions and takes it off realtime.
begin;

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_events') then
    alter publication supabase_realtime drop table public.match_events;
  end if;
end;
$$;

drop function if exists public.match_events_feed(uuid);
drop function if exists public.remove_match_event(uuid);
drop function if exists public.set_match_goal_scorer(uuid, int);
drop function if exists public.report_match_goal(uuid, text, int, int);
drop function if exists public.match_scorer_by_number(uuid, int);
drop function if exists public.can_report_match(uuid);

commit;
