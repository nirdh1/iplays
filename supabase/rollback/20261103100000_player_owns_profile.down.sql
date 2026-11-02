-- Rollback of 20261103100000_player_owns_profile.sql.
-- Puts back the functions as they were before. Players lose the link to their
-- own profile (the 'self' rows are removed, and they leave the teams where
-- they had no other link); profiles, careers and history are not touched.

begin;

drop function if exists public.pending_self_claims(), public.my_self_claims(),
  public.review_player_self(uuid, boolean), public.cancel_player_self(uuid), public.request_player_self(uuid, text),
  public.can_review_self_claim(uuid), public.self_claim_approver_ids(uuid), public.self_claim_approver(uuid);
drop table if exists public.player_self_claims;

do $$
declare r record;
begin
  for r in select player_id, user_id from player_guardians where relation = 'self' loop
    delete from player_guardians where player_id = r.player_id and user_id = r.user_id;
    perform drop_parent_membership(r.player_id, r.user_id);
  end loop;
end $$;
drop index if exists public.player_guardians_one_self_per_player;
drop index if exists public.player_guardians_one_self_per_user;
alter table public.player_guardians drop constraint if exists player_guardians_relation_check;
alter table public.player_guardians add constraint player_guardians_relation_check check (relation in ('parent', 'family'));

update public.profiles set account_types = coalesce(nullif(array_remove(account_types, 'player'), '{}'), '{parent}')
where 'player' = any(account_types);
alter table public.profiles drop constraint if exists profiles_account_types_check;
alter table public.profiles add constraint profiles_account_types_check
  check (account_types <@ array['parent', 'club']::text[] and cardinality(account_types) between 1 and 2);

drop policy if exists player_self_stats_read on public.player_self_stats;
create policy player_self_stats_read on public.player_self_stats for select to authenticated
  using (deleted_at is null and can_view_player_metrics(player_id));

create or replace function public.family_join_child_teams(p_player uuid, p_user uuid, p_relation text)
returns void language sql security definer set search_path = public as $$
  insert into team_members (team_id, user_id, role, is_follower)
  select a.team_id, p_user, 'parent', p_relation = 'family'
  from player_assignments a where a.player_id = p_player and a.ended_on is null
  on conflict (team_id, user_id) do update
    set is_follower = team_members.is_follower and excluded.is_follower;
$$;

create or replace function public.attach_child_to_team(p_player uuid, p_team uuid, p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_has_primary boolean;
  v_to uuid;
  g record;
begin
  if exists (select 1 from player_assignments where player_id = p_player and team_id = p_team and ended_on is null) then
    return;
  end if;
  perform 1 from player_assignments where player_id = p_player for update;
  select exists (select 1 from player_assignments where player_id = p_player and is_primary and ended_on is null)
  into v_has_primary;
  insert into player_assignments (player_id, team_id, is_primary, started_on)
  values (p_player, p_team, not v_has_primary, current_date)
  returning id into v_to;
  insert into player_transfers (player_id, kind, to_team_id, to_assignment_id, reason, effective_on)
  values (p_player, 'add', p_team, v_to, 'הצטרפות עם פרופיל קיים', current_date);
  for g in select user_id, relation from player_guardians where player_id = p_player loop
    insert into team_members (team_id, user_id, role, is_follower)
    values (p_team, g.user_id, 'parent', g.relation = 'family')
    on conflict (team_id, user_id) do update
      set is_follower = team_members.is_follower and excluded.is_follower;
  end loop;
  perform write_audit('player.join_with_profile', (select club_id from teams where id = p_team), 'player', p_player,
                      jsonb_build_object('team', p_team, 'request', p_request));
end;
$$;

create or replace function public.request_join_with_child(p_team uuid, p_player uuid, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  p players%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from teams where id = p_team and archived_at is null) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from player_assignments where player_id = p_player and team_id = p_team and ended_on is null) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  select * into p from players where id = p_player;
  insert into join_requests (team_id, user_id, player_id, child_first, child_last, birth_year, message,
                             relation, declaration, declared_at, brings_player)
  values (p_team, auth.uid(), p_player, left(p.first_name, 40), left(coalesce(p.last_name, ''), 40), p.birth_year,
          left(trim(coalesce(p_message, '')), 300), 'parent',
          'אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה', now(), true)
  returning id into v_id;

  -- no one manages the team yet: a declared parent gets in right away
  if not team_has_staff(p_team) then
    perform attach_child_to_team(p_player, p_team, v_id);
    update join_requests set status = 'approved', reviewed_at = now() where id = v_id;
    perform write_audit('join.auto_approve', (select club_id from teams where id = p_team), 'join_request', v_id,
                        jsonb_build_object('team_id', p_team, 'user_id', auth.uid(), 'brings_player', true));
  end if;
  return v_id;
end;
$$;

create or replace function public.parent_end_affiliation(
  p_player uuid, p_team uuid, p_moved_to text default '', p_effective date default current_date
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_a player_assignments%rowtype;
  v_next uuid;
  v_moved text := left(trim(coalesce(p_moved_to, '')), 80);
  v_name text;
  v_team text;
begin
  if not is_player_parent(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_effective is null or p_effective > current_date + 60 then
    raise exception 'bad date' using errcode = '22023';
  end if;
  select * into v_a from player_assignments where player_id = p_player and team_id = p_team and ended_on is null for update;
  if v_a.id is null then
    raise exception 'player is not in this team' using errcode = 'P0002';
  end if;
  update player_assignments
  set ended_on = greatest(p_effective, started_on),
      end_reason = case when v_moved <> '' then 'עבר ל' || v_moved else 'עזב (דיווח הורה)' end,
      is_primary = false
  where id = v_a.id;
  if v_a.is_primary then
    select id into v_next from player_assignments
    where player_id = p_player and ended_on is null order by started_on, created_at limit 1;
    if v_next is not null then
      update player_assignments set is_primary = true where id = v_next;
    end if;
  end if;
  insert into player_transfers (player_id, kind, from_team_id, from_assignment_id, reason, effective_on)
  values (p_player, 'end', p_team, v_a.id,
          case when v_moved <> '' then 'הורה: עבר ל' || v_moved else 'הורה: עזב' end, p_effective);
  -- a club that isn't in iPlays is still part of the career
  if v_moved <> '' then
    insert into player_external_affiliations (player_id, name, kind, started_on)
    values (p_player, v_moved, 'club', p_effective);
  end if;

  select trim(first_name || ' ' || last_name) into v_name from players where id = p_player;
  select name into v_team from teams where id = p_team;
  perform notify_users(team_staff_ids(p_team), p_team, 'player_left',
    v_name || ' עזב/ה את ' || v_team,
    case when v_moved <> '' then 'לפי ההורה: עבר/ה ל' || v_moved || '.' else 'דיווח של ההורה.' end
      || ' ההיסטוריה נשמרת. הרישום בהתאחדות לא השתנה.',
    'myteam/' || p_team, p_player, 'team_updates');
  perform write_audit('player.end_by_parent', (select club_id from teams where id = p_team), 'player', p_player,
                      jsonb_build_object('team', p_team, 'moved_to', v_moved));
end;
$$;

create or replace function public.can_edit_player_profile(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_player_parent(p_player)
      or exists (select 1 from player_assignments a
                 where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'roster', 3));
$$;

create or replace function public.player_profile_extra(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not can_view_player(p_player) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'position', (select position from players where id = p_player),
    'secondary_positions', (select to_jsonb(secondary_positions) from players where id = p_player),
    'position_list', (select to_jsonb(position_list(t.sport)) from player_assignments a join teams t on t.id = a.team_id
                      where a.player_id = p_player and a.ended_on is null order by a.is_primary desc limit 1),
    'can_edit', can_edit_player_profile(p_player),
    'is_parent', is_player_parent(p_player),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'team_id', t.id, 'team_name', t.name, 'club', coalesce(c.name, nullif(t.club, '')),
               'program', p.kind, 'sport', t.sport, 'season', t.season,
               'started_on', a.started_on, 'ended_on', a.ended_on, 'end_reason', a.end_reason,
               'is_primary', a.is_primary, 'shirt_number', a.shirt_number)
             order by (a.ended_on is null) desc, a.started_on desc)
      from player_assignments a
      join teams t on t.id = a.team_id
      left join clubs c on c.id = t.club_id
      left join club_programs p on p.id = t.program_id
      where a.player_id = p_player), '[]'::jsonb),
    'external', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'started_on', x.started_on,
               'ended_on', x.ended_on, 'note', x.note)
             order by (x.ended_on is null) desc, x.started_on desc nulls last)
      from player_external_affiliations x where x.player_id = p_player and x.deleted_at is null), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_self_stat(
  p_player uuid, p_id uuid, p_match uuid, p_date date, p_opponent text,
  p_goals int, p_assists int, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_date date := p_date;
  v_opp text := nullif(btrim(coalesce(p_opponent, '')), '');
  v_match team_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not is_player_parent(p_player) then
    raise exception 'only the child''s parent can report goals and assists';
  end if;
  if coalesce(p_goals, 0) < 0 or coalesce(p_goals, 0) > 30 or coalesce(p_assists, 0) < 0 or coalesce(p_assists, 0) > 30 then
    raise exception 'goals and assists must be between 0 and 30';
  end if;

  if p_match is not null then
    -- an app game: must be a past, not-canceled game of a team the child was in on that day
    select tm.* into v_match from team_matches tm
    where tm.id = p_match and tm.status <> 'canceled' and tm.starts_at < now()
      and exists (select 1 from player_assignments a
                  where a.player_id = p_player and a.team_id = tm.team_id
                    and (tm.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
                    and (a.ended_on is null or (tm.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on));
    if not found then raise exception 'this game is not one of the child''s past games'; end if;
    v_date := (v_match.starts_at at time zone 'Asia/Jerusalem')::date;
    v_opp := left(v_match.opponent, 80);
  else
    if v_date is null or v_date > current_date then raise exception 'pick a date that is not in the future'; end if;
    if v_opp is null then raise exception 'opponent is required'; end if;
  end if;

  if v_id is null and p_match is not null then
    -- reporting the same game again edits the existing report
    select id into v_id from player_self_stats
    where player_id = p_player and match_id = p_match and deleted_at is null;
  end if;

  if v_id is null then
    insert into player_self_stats (player_id, match_id, played_on, opponent, goals, assists, note)
    values (p_player, p_match, v_date, left(v_opp, 80), coalesce(p_goals, 0), coalesce(p_assists, 0),
            nullif(left(btrim(coalesce(p_note, '')), 200), ''))
    returning id into v_id;
  else
    update player_self_stats set match_id = p_match, played_on = v_date, opponent = left(v_opp, 80),
           goals = coalesce(p_goals, 0), assists = coalesce(p_assists, 0),
           note = nullif(left(btrim(coalesce(p_note, '')), 200), ''), updated_at = now()
    where id = v_id and player_id = p_player and deleted_at is null;
    if not found then raise exception 'report not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.remove_self_stat(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  select player_id into v_player from player_self_stats where id = p_id and deleted_at is null;
  if v_player is null or not is_player_parent(v_player) then raise exception 'report not found'; end if;
  update player_self_stats set deleted_at = now(), updated_at = now() where id = p_id;
end $$;

create or replace function public.player_self_stats_view(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not can_view_player_metrics(p_player) then return null; end if;
  return jsonb_build_object(
    'can_edit', is_player_parent(p_player),
    'totals', (select jsonb_build_object('games', count(*), 'goals', coalesce(sum(goals), 0), 'assists', coalesce(sum(assists), 0))
               from player_self_stats where player_id = p_player and deleted_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'match_id', s.match_id, 'date', s.played_on,
               'opponent', s.opponent, 'goals', s.goals, 'assists', s.assists, 'note', s.note,
               'team_name', t.name) order by s.played_on desc, s.created_at desc)
      from player_self_stats s
      left join team_matches tm on tm.id = s.match_id
      left join teams t on t.id = tm.team_id
      where s.player_id = p_player and s.deleted_at is null), '[]'::jsonb),
    -- the child's past games of the last 200 days, to pick from (parents only)
    'recent_games', case when is_player_parent(p_player) then coalesce((
      select jsonb_agg(jsonb_build_object('id', tm.id, 'date', (tm.starts_at at time zone 'Asia/Jerusalem')::date,
               'opponent', tm.opponent, 'team_name', t.name,
               'reported', exists (select 1 from player_self_stats s where s.player_id = p_player
                                   and s.match_id = tm.id and s.deleted_at is null))
             order by tm.starts_at desc)
      from team_matches tm join teams t on t.id = tm.team_id
      where tm.status <> 'canceled' and tm.starts_at < now() and tm.starts_at > now() - interval '200 days'
        and exists (select 1 from player_assignments a
                    where a.player_id = p_player and a.team_id = tm.team_id
                      and (tm.starts_at at time zone 'Asia/Jerusalem')::date >= a.started_on
                      and (a.ended_on is null or (tm.starts_at at time zone 'Asia/Jerusalem')::date <= a.ended_on))
      ), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

drop function if exists public.my_children();
create function public.my_children()
returns table (player_id uuid, first_name text, last_name text, birth_year int,
               team_ids uuid[], team_names text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.birth_year,
         coalesce(array_agg(t.id order by a.is_primary desc, t.name) filter (where t.id is not null), '{}'),
         coalesce(array_agg(t.name order by a.is_primary desc, t.name) filter (where t.id is not null), '{}')
  from player_guardians g
  join players p on p.id = g.player_id
  left join player_assignments a on a.player_id = p.id and a.ended_on is null
  left join teams t on t.id = a.team_id
  where g.user_id = auth.uid() and g.relation = 'parent'
  group by p.id, p.first_name, p.last_name, p.birth_year
  order by p.first_name;
$$;

drop function if exists public.is_player_owner(uuid), public.is_player_self(uuid), public.player_is_minor(uuid);

revoke all on function public.my_children() from public, anon;
grant execute on function public.my_children() to authenticated;
revoke all on function public.family_join_child_teams(uuid, uuid, text), public.attach_child_to_team(uuid, uuid, uuid)
from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
