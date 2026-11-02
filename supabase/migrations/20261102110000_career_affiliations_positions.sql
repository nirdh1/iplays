-- iplays — career: positions (primary + secondary) and affiliation history.
--
-- Run after 20261101985000_player_career.sql (and the 2026-11-02 migrations).
-- Rollback: supabase/rollback/20261102110000_career_affiliations_positions.down.sql
-- Additive only: one nullable-safe column, one table, RPCs, a wider
-- notification kind list. No row is deleted or rewritten.
--
-- Positions (spec section 6): one primary position (players.position, as
-- before) and any number of secondary ones, both from a fixed list for
-- football and basketball. Empty primary = "טרם נקבעה". The child's parents
-- and roster staff edit them.
--
-- Affiliations (spec section 5): the career shows every team the child was
-- ever assigned to (player_assignments, ended ones too) plus frameworks
-- outside iPlays that a parent records (a private academy, a club not in
-- the app). A parent can mark that the child left a team, optionally saying
-- where they moved: the assignment ends (history stays), the move is logged
-- in player_transfers, and the team's staff and club admins get a
-- notification. This never changes anything at the IFA.

begin;

-- ------------------------------------------------------------- positions

alter table public.players add column if not exists secondary_positions text[] not null default '{}';

create or replace function public.position_list(p_sport text)
returns text[] language sql immutable as $$
  select case p_sport
    when 'football' then array['שוער', 'בלם', 'מגן ימני', 'מגן שמאלי', 'קשר אחורי', 'קשר מרכזי', 'קשר התקפי', 'כנף ימין', 'כנף שמאל', 'חלוץ']
    when 'basketball' then array['רכז', 'קלע', 'סמול פורוורד', 'פאוור פורוורד', 'סנטר']
  end;
$$;

-- The child's parents, or staff with roster >= 3 in a current team.
create or replace function public.can_edit_player_profile(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_player_parent(p_player)
      or exists (select 1 from player_assignments a
                 where a.player_id = p_player and a.ended_on is null and can(a.team_id, 'roster', 3));
$$;

create or replace function public.set_player_profile(
  p_player uuid, p_primary text, p_secondary text[], p_strong_foot text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sport text;
  v_list text[];
  v_primary text := coalesce(trim(p_primary), '');
  v_secondary text[];
begin
  if not can_edit_player_profile(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_strong_foot is not null and p_strong_foot not in ('right', 'left', 'both') then
    raise exception 'bad strong foot' using errcode = '22023';
  end if;
  select t.sport into v_sport
  from player_assignments a join teams t on t.id = a.team_id
  where a.player_id = p_player and a.ended_on is null order by a.is_primary desc limit 1;
  v_list := position_list(v_sport);
  select coalesce(array_agg(distinct trim(x)) filter (where trim(x) <> '' and trim(x) <> v_primary), '{}')
  into v_secondary from unnest(coalesce(p_secondary, '{}')) x;
  if v_list is not null then
    if v_primary <> '' and not v_primary = any (v_list) then
      raise exception 'unknown position' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_secondary) x where not x = any (v_list)) then
      raise exception 'unknown position' using errcode = '22023';
    end if;
  elsif char_length(v_primary) > 30 then
    raise exception 'position too long' using errcode = '22023';
  end if;
  if cardinality(v_secondary) > 6 then
    raise exception 'too many positions' using errcode = '22023';
  end if;
  update players
  set position = v_primary, secondary_positions = v_secondary, strong_foot = p_strong_foot
  where id = p_player;
end;
$$;

-- ------------------------------------------------- frameworks outside iPlays

create table if not exists public.player_external_affiliations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'club' check (kind in ('club', 'academy', 'private_coach', 'other')),
  started_on date,
  ended_on date,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ended_on is null or started_on is null or ended_on >= started_on)
);
create index if not exists player_external_affiliations_player_idx on public.player_external_affiliations (player_id);

alter table public.player_external_affiliations enable row level security;
drop policy if exists player_external_affiliations_read on public.player_external_affiliations;
create policy player_external_affiliations_read on public.player_external_affiliations for select to authenticated
  using (deleted_at is null and can_view_player(player_id));

create or replace function public.save_external_affiliation(
  p_player uuid, p_id uuid, p_name text, p_kind text, p_started date, p_ended date, p_note text default ''
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
begin
  if not can_edit_player_profile(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_id is null then
    insert into player_external_affiliations (player_id, name, kind, started_on, ended_on, note)
    values (p_player, left(trim(p_name), 80), coalesce(p_kind, 'club'), p_started, p_ended, left(coalesce(p_note, ''), 200))
    returning id into v_id;
  else
    update player_external_affiliations
    set name = left(trim(p_name), 80), kind = coalesce(p_kind, 'club'), started_on = p_started, ended_on = p_ended,
        note = left(coalesce(p_note, ''), 200)
    where id = v_id and player_id = p_player and deleted_at is null;
    if not found then
      raise exception 'not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.remove_external_affiliation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  select player_id into v_player from player_external_affiliations where id = p_id and deleted_at is null;
  if v_player is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not can_edit_player_profile(v_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update player_external_affiliations set deleted_at = now() where id = p_id;
end;
$$;

-- ----------------------------------------------- parent: "my child left"

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'match_change', 'match_result', 'training', 'announcement', 'absence',
  'join_request', 'join_decision', 'team_claim', 'team_claim_decision', 'player_left')) not valid;

-- A parent marks that the child left a team (p_moved_to = the new club's
-- name, optional). Staff use end_player_assignment / transfer_player.
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

-- ------------------------------------------------------------- read side

-- Positions, the full affiliation history and what the caller may do.
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

revoke all on function public.set_player_profile(uuid, text, text[], text) from public, anon;
grant execute on function public.set_player_profile(uuid, text, text[], text) to authenticated;
revoke all on function public.save_external_affiliation(uuid, uuid, text, text, date, date, text) from public, anon;
grant execute on function public.save_external_affiliation(uuid, uuid, text, text, date, date, text) to authenticated;
revoke all on function public.remove_external_affiliation(uuid) from public, anon;
grant execute on function public.remove_external_affiliation(uuid) to authenticated;
revoke all on function public.parent_end_affiliation(uuid, uuid, text, date) from public, anon;
grant execute on function public.parent_end_affiliation(uuid, uuid, text, date) to authenticated;
revoke all on function public.player_profile_extra(uuid) from public, anon;
grant execute on function public.player_profile_extra(uuid) to authenticated;

commit;
