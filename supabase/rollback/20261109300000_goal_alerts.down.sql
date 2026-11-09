-- Rollback of 20261109300000_goal_alerts.sql.
-- Keeps the goal_type columns and every notification already queued; stops new
-- goal alerts and restores the live-session version of match_events_feed.
-- (The 'live_goal' notification kind stays allowed so queued rows stay valid.)
begin;

drop trigger if exists match_events_notify_goal on public.match_events;
drop function if exists public.notify_live_goal();
drop function if exists public.set_match_goal_type(uuid, text);
drop function if exists public.goal_type_label(text);

drop function if exists public.match_events_feed(uuid);
create function public.match_events_feed(p_match uuid)
returns table (
  id uuid, kind text, side text, points int, shirt_number int, player_id uuid, scorer_name text,
  minute int, period int, clock_seconds int, created_at timestamptz, created_by uuid, reporter_name text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_matches where team_matches.id = p_match;
  if v_team is null or not (is_team_member(v_team) or can(v_team, 'matches', 1)) then
    return;
  end if;
  return query
  select e.id, e.kind, e.side, e.points::int, e.shirt_number::int, e.player_id,
         coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), e.player_name),
         e.minute::int, e.period::int, e.clock_seconds, e.created_at, e.created_by, nullif(pr.full_name, '')
  from match_events e
  left join players p on p.id = e.player_id
  left join profiles pr on pr.id = e.created_by
  where e.match_id = p_match and e.deleted_at is null
  order by coalesce(e.clock_seconds, 0), e.created_at;
end;
$$;

revoke all on function public.match_events_feed(uuid) from public, anon;
grant execute on function public.match_events_feed(uuid) to authenticated;

commit;
