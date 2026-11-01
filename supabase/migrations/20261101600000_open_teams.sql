-- iplays — teams without a coach + team search by birth year.
--
-- Run after 20261101500000_matches_lineups_attendance.sql.
-- Rollback: supabase/rollback/20261101600000_open_teams.down.sql
-- (the rollback keeps the new teams.opened_by column and every team, child and
-- membership created here).
--
-- Product decisions (2026-11-01, project owner):
--   * A team can exist before any coach registered: a parent can open it
--     (name, club name, sport, birth year). The parent who opens it is a
--     regular parent member, not staff.
--   * Teams are searchable directly by the child's birth year and by team /
--     club name, not only through a club.
--   * In a team with no staff (no team admin / coach, no club admin, no staff
--     grant), a parent request with the parent declaration is approved
--     automatically. As soon as the team has staff, staff approve as before.
--     Follow requests (family) still need the child's declared parent.
--   * A club admin can adopt a team that has no staff into the club; from then
--     on the club (and the coaches it assigns) manage it.

begin;

alter table public.teams add column if not exists opened_by text not null default 'staff'
  check (opened_by in ('staff', 'parent'));
create index if not exists teams_birth_year_idx on public.teams (birth_year_from, birth_year_to) where archived_at is null;
create index if not exists teams_name_trgm_idx on public.teams using gin (name gin_trgm_ops);

-- --------------------------------------------------------------- helpers

-- Does anyone manage this team? (team admin / coach, club owner / admin, or a
-- staff grant that covers the team)
create function public.team_has_staff(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members m where m.team_id = p_team and m.role in ('admin', 'coach'))
      or exists (select 1 from teams t join club_staff s on s.club_id = t.club_id
                 where t.id = p_team and s.role in ('owner', 'admin'))
      or exists (select 1 from teams t join permission_grants g on g.club_id = t.club_id
                 where t.id = p_team and g.domain = 'staff' and g.level >= 2
                   and (g.team_id = t.id or (g.team_id is null and (g.program_id = t.program_id or g.program_id is null))));
$$;

-- --------------------------------------------------------------- search

-- Teams by birth year and / or name (team, club, club city, age group).
-- Needs a birth year or 2+ characters.
create function public.search_teams(p_query text default '', p_birth_year int default null, p_sport text default null)
returns table (
  team_id uuid, name text, club_id uuid, club_name text, city text, program_kind text, sport text, season text,
  age_group text, birth_year_from int, birth_year_to int, players int, has_staff boolean, is_member boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 and p_birth_year is null then
    return;
  end if;
  return query
  select t.id, t.name, c.id, coalesce(c.name, nullif(t.club, '')), c.city, cp.kind, t.sport, t.season,
         t.age_group, t.birth_year_from, t.birth_year_to,
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null),
         team_has_staff(t.id), is_team_member(t.id)
  from teams t
  left join clubs c on c.id = t.club_id
  left join club_programs cp on cp.id = t.program_id
  where t.archived_at is null
    and (c.id is null or (c.status <> 'suspended' and c.archived_at is null))
    and (p_sport is null or t.sport = p_sport)
    and (char_length(v_q) < 2
         or t.name ilike '%' || v_q || '%' or t.club ilike '%' || v_q || '%' or t.age_group ilike '%' || v_q || '%'
         or c.name ilike '%' || v_q || '%' or c.city ilike '%' || v_q || '%')
    and (p_birth_year is null
         or (t.birth_year_from is not null and p_birth_year between t.birth_year_from and coalesce(t.birth_year_to, t.birth_year_from))
         or exists (select 1 from player_assignments a join players p on p.id = a.player_id
                    where a.team_id = t.id and a.ended_on is null and p.birth_year = p_birth_year))
  order by (c.status = 'verified') desc nulls last, coalesce(c.name, t.club), t.name
  limit 40;
end;
$$;

-- ------------------------------------------------------------ open a team

-- A parent opens a team that is not in the app yet, together with their
-- child (declared as the parent). The parent is a regular member, not staff.
create function public.open_team(
  p_name text, p_club text, p_sport text, p_birth_year int,
  p_child_first text, p_child_last text, p_declare_parent boolean, p_season text default '2026/27'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_player uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_club text := trim(coalesce(p_club, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not coalesce(p_declare_parent, false) then
    raise exception 'parent declaration required' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 60 or char_length(v_club) > 60 then
    raise exception 'team name must be 2-60 characters' using errcode = '22023';
  end if;
  if p_birth_year is null or p_birth_year not between 2000 and 2030 then
    raise exception 'birth year required' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_child_first, ''))) = 0 then
    raise exception 'child name required' using errcode = '22023';
  end if;
  -- the same team opened twice (same name, club and birth year)
  select t.id into v_team from teams t
  left join clubs c on c.id = t.club_id
  where t.archived_at is null and lower(t.name) = lower(v_name)
    and lower(coalesce(c.name, t.club)) = lower(v_club)
    and p_birth_year between coalesce(t.birth_year_from, p_birth_year) and coalesce(t.birth_year_to, t.birth_year_from, p_birth_year)
  limit 1;
  if v_team is not null then
    raise exception 'team already exists: %', v_team using errcode = '23505';
  end if;

  insert into teams (name, club, season, sport, created_by, birth_year_from, birth_year_to, opened_by)
  values (v_name, v_club, coalesce(nullif(trim(p_season), ''), '2026/27'),
          case when p_sport in ('football', 'basketball') then p_sport else 'other' end,
          auth.uid(), p_birth_year, p_birth_year, 'parent')
  returning id into v_team;
  insert into team_members (team_id, user_id, role) values (v_team, auth.uid(), 'parent');
  insert into players (team_id, first_name, last_name, birth_year, created_by)
  values (v_team, left(trim(p_child_first), 40), left(trim(coalesce(p_child_last, '')), 40), p_birth_year, auth.uid())
  returning id into v_player;
  insert into player_guardians (player_id, user_id, relation) values (v_player, auth.uid(), 'parent');
  perform write_audit('team.open_by_parent', null, 'team', v_team, jsonb_build_object('player_id', v_player));
  return v_team;
end;
$$;

-- The club guard also lets a club admin adopt a team nobody manages.
create or replace function public.teams_guard_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.program_id is not null then
    select club_id into new.club_id from club_programs where id = new.program_id;
  end if;
  if new.club_id is not distinct from old.club_id and new.program_id is not distinct from old.program_id then
    return new;
  end if;
  if is_trusted_context() or is_platform_admin() then
    return new;
  end if;
  -- a club admin adopts a team nobody manages yet (see adopt_team)
  if old.club_id is null and new.club_id is not null and is_club_admin(new.club_id) and not team_has_staff(new.id) then
    return new;
  end if;
  if not is_team_admin(new.id) then
    raise exception 'only the team admin can move the team between clubs' using errcode = '42501';
  end if;
  if new.club_id is not null and not is_club_admin(new.club_id) then
    raise exception 'only a club admin can add teams to the club' using errcode = '42501';
  end if;
  if old.club_id is not null and new.club_id is distinct from old.club_id and not is_club_admin(old.club_id) then
    raise exception 'only a club admin can remove teams from the club' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A club admin takes a team that has no staff into the club.
create function public.adopt_team(p_team uuid, p_club uuid, p_program uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_club_admin(p_club) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from teams where id = p_team and archived_at is null and club_id is null) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if team_has_staff(p_team) then
    raise exception 'team already has staff' using errcode = '42501';
  end if;
  if p_program is not null and not exists (select 1 from club_programs where id = p_program and club_id = p_club) then
    raise exception 'program not in this club' using errcode = '22023';
  end if;
  update teams set club_id = p_club, program_id = p_program where id = p_team;
  perform write_audit('team.adopt', p_club, 'team', p_team, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------- requests: auto-approve

-- Same as before, plus: a declared parent's request to a team with no staff
-- is approved on the spot.
create or replace function public.request_join(
  p_team uuid, p_player uuid default null, p_first text default '', p_last text default '',
  p_birth_year int default null, p_message text default '',
  p_relation text default 'parent', p_declare_parent boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_player uuid;
  v_declaration constant text := 'אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה';
begin
  if p_relation not in ('parent', 'family') then
    raise exception 'relation must be parent or family' using errcode = '22023';
  end if;
  if p_relation = 'parent' and not coalesce(p_declare_parent, false) then
    raise exception 'parent declaration required' using errcode = '22023';
  end if;
  if p_relation = 'family' and p_player is null then
    raise exception 'follow requests need an existing child' using errcode = '22023';
  end if;
  if p_relation = 'family' and not exists (
    select 1 from player_guardians where player_id = p_player and relation = 'parent'
  ) then
    raise exception 'child has no parent yet' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from teams where id = p_team and archived_at is null) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if p_player is not null and not exists (
    select 1 from player_assignments where player_id = p_player and team_id = p_team and ended_on is null
  ) then
    raise exception 'player not in this team' using errcode = '22023';
  end if;
  if p_player is not null and exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid())
     and is_team_member(p_team) then
    raise exception 'already linked' using errcode = '23505';
  end if;
  insert into join_requests (team_id, user_id, player_id, child_first, child_last, birth_year, message,
                             relation, declaration, declared_at)
  values (p_team, auth.uid(), p_player, trim(coalesce(p_first, '')), trim(coalesce(p_last, '')), p_birth_year,
          trim(coalesce(p_message, '')), p_relation,
          case when p_relation = 'parent' then v_declaration else '' end,
          case when p_relation = 'parent' then now() end)
  returning id into v_id;

  -- no one manages the team yet: a declared parent gets in right away
  -- (an existing child that already has a declared parent still goes through approval)
  if p_relation = 'parent' and not team_has_staff(p_team)
     and (p_player is null or not exists (select 1 from player_guardians where player_id = p_player and relation = 'parent')) then
    insert into team_members (team_id, user_id, role) values (p_team, auth.uid(), 'parent')
    on conflict (team_id, user_id) do nothing;
    v_player := p_player;
    if v_player is null then
      insert into players (team_id, first_name, last_name, birth_year, created_by)
      values (p_team, left(trim(p_first), 40), left(trim(coalesce(p_last, '')), 40), p_birth_year, auth.uid())
      returning id into v_player;
    end if;
    insert into player_guardians (player_id, user_id, relation) values (v_player, auth.uid(), 'parent')
    on conflict (player_id, user_id) do update set relation = 'parent';
    update join_requests set status = 'approved', player_id = v_player, reviewed_at = now() where id = v_id;
    perform write_audit('join.auto_approve', (select club_id from teams where id = p_team), 'join_request', v_id,
                        jsonb_build_object('team_id', p_team, 'user_id', auth.uid()));
  end if;
  return v_id;
end;
$$;

-- team_public gains has_staff (the team page says "approved automatically")
drop function if exists public.team_public(uuid);
create function public.team_public(p_team uuid)
returns table (team_id uuid, name text, season text, sport text, club_id uuid, club_name text, club_status text,
               program_kind text, players int, is_member boolean, has_staff boolean, birth_year_from int, birth_year_to int)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.season, t.sport, c.id, coalesce(c.name, nullif(t.club, '')), c.status, cp.kind,
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null),
         is_team_member(t.id), team_has_staff(t.id), t.birth_year_from, t.birth_year_to
  from teams t
  left join clubs c on c.id = t.club_id and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where auth.uid() is not null and t.id = p_team and t.archived_at is null;
$$;

-- ----------------------------------------------------------------- grants

revoke all on function public.team_has_staff, public.search_teams, public.open_team, public.adopt_team,
  public.request_join, public.team_public
from public, anon;
grant execute on function public.team_has_staff, public.search_teams, public.open_team, public.adopt_team,
  public.request_join, public.team_public
to authenticated;

commit;
