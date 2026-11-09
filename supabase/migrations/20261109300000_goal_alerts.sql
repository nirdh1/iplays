-- iplays — goal alerts: a push / bell notification to the whole team for
-- every goal that counts, with the score, minute, scorer and goal type.
--
-- Run after 20261102600000_live_match_session.sql and
-- 20261101995000_inbox_notifications.sql.
-- Rollback: supabase/rollback/20261109300000_goal_alerts.down.sql
-- Additive: one column on match_events, one more
-- notification kind, a trigger, one RPC. No row is changed or removed.
--
-- Product request (2026-11-09, project owner): goal reporting "like playday"
-- (UX inspiration only, none of its data): every parent in the team gets
-- "גול! הפועל רמת גן 1:0 הפועל אשקלון · דקה 23 · יונתן כהן (#9) · בעיטה חופשית".
-- * One notification per goal that counts (a goal by the primary reporter,
--   an approved report, or any report while no one holds the role). Pending
--   reports and cards do not notify. The person who made the goal count is not
--   notified about their own action (notify_users).
-- * Uses the existing "match results" preference, so a parent who turned
--   results off gets no goal alerts.
-- * goal_type: free_kick | penalty | header | own_goal | other (optional).

begin;

alter table public.match_events add column if not exists goal_type text
  check (goal_type in ('free_kick', 'penalty', 'header', 'own_goal', 'other'));

-- ------------------------------------------------------ notification kind

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'notification_outbox_kind_check' and conrelid = 'public.notification_outbox'::regclass;
  -- the definition is either kind IN ('a', 'b') or kind = ANY ('{a,b}'::text[]):
  -- take every lower-case word but the column name and the type
  select coalesce(array_agg(distinct m[1]), '{}') into v_kinds
  from regexp_matches(coalesce(v_def, ''), '([a-z_]+)', 'g') m
  where m[1] not in ('kind', 'text');
  if 'live_goal' = any (v_kinds) then
    return;
  end if;
  v_kinds := v_kinds || array['live_goal'];
  select array_agg(distinct k order by k) into v_kinds from unnest(v_kinds) k;
  alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
  execute format('alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind = any (%L::text[])) not valid',
                 v_kinds);
end;
$$;

-- --------------------------------------------------------------- labels

create or replace function public.goal_type_label(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'free_kick' then 'בעיטה חופשית'
    when 'penalty' then 'פנדל'
    when 'header' then 'נגיחה'
    when 'own_goal' then 'שער עצמי'
  end;
$$;

-- ---------------------------------------------------------------- trigger

create or replace function public.notify_live_goal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m team_matches%rowtype;
  v_team text;
  v_home_name text;
  v_away_name text;
  v_home int;
  v_away int;
  v_scorer text;
  v_body text;
  v_basket boolean;
begin
  if new.kind <> 'goal' or new.deleted_at is not null then
    return new;
  end if;
  select * into m from team_matches where id = new.match_id;
  if not found or m.status = 'canceled' then
    return new;
  end if;
  select name, sport = 'basketball' into v_team, v_basket from teams where id = new.team_id;
  v_home_name := case when m.home then v_team else m.opponent end;
  v_away_name := case when m.home then m.opponent else v_team end;
  select coalesce(sum(points) filter (where side = 'home'), 0), coalesce(sum(points) filter (where side = 'away'), 0)
    into v_home, v_away
  from match_events where match_id = new.match_id and kind = 'goal' and deleted_at is null;
  select nullif(trim(p.first_name || ' ' || p.last_name), '') into v_scorer from players p where p.id = new.player_id;
  v_scorer := coalesce(v_scorer, new.player_name);
  if v_scorer is not null and new.shirt_number is not null then
    v_scorer := v_scorer || ' (#' || new.shirt_number || ')';
  elsif v_scorer is null and new.shirt_number is not null then
    v_scorer := 'מספר ' || new.shirt_number;
  end if;
  v_body := concat_ws(' · ',
    case when new.minute is not null then 'דקה ' || new.minute end,
    v_scorer,
    goal_type_label(new.goal_type),
    'ל' || case when new.side = 'home' then v_home_name else v_away_name end);
  perform notify_users(
    team_member_ids(new.team_id), new.team_id, 'live_goal',
    case when v_basket then 'סל! ' else 'גול! ' end || v_home_name || ' ' || v_home || ':' || v_away || ' ' || v_away_name,
    v_body,
    '#matches/' || new.team_id || '/' || new.match_id,
    new.id, 'match_results');
  return new;
end;
$$;

drop trigger if exists match_events_notify_goal on public.match_events;
create trigger match_events_notify_goal after insert on public.match_events
  for each row execute function public.notify_live_goal();

-- ------------------------------------------------------------------ RPCs

-- Set or clear the goal type of a counted goal (same rules as the scorer:
-- whoever may edit the event, or its sender while no type is set yet).
create or replace function public.set_match_goal_type(p_event uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare
  e match_events%rowtype;
begin
  select * into e from match_events where id = p_event and deleted_at is null;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if not (can_edit_match_event(e.match_id, e.team_id) or (e.created_by = auth.uid() and e.goal_type is null and can_report_match(e.team_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('free_kick', 'penalty', 'header', 'own_goal', 'other') then
    raise exception 'unknown goal type' using errcode = '22023';
  end if;
  update match_events set goal_type = p_type where id = p_event;
end;
$$;

-- The feed gains goal_type.
drop function if exists public.match_events_feed(uuid);
create function public.match_events_feed(p_match uuid)
returns table (
  id uuid, kind text, side text, points int, shirt_number int, player_id uuid, scorer_name text,
  minute int, period int, clock_seconds int, created_at timestamptz, created_by uuid, reporter_name text,
  goal_type text
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
         e.minute::int, e.period::int, e.clock_seconds, e.created_at, e.created_by, nullif(pr.full_name, ''),
         e.goal_type
  from match_events e
  left join players p on p.id = e.player_id
  left join profiles pr on pr.id = e.created_by
  where e.match_id = p_match and e.deleted_at is null
  order by coalesce(e.clock_seconds, 0), e.created_at;
end;
$$;

revoke all on function public.notify_live_goal(), public.goal_type_label(text) from public, anon, authenticated;
revoke all on function public.set_match_goal_type(uuid, text), public.match_events_feed(uuid) from public, anon;
grant execute on function public.set_match_goal_type(uuid, text), public.match_events_feed(uuid) to authenticated;

commit;
