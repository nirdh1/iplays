-- Rollback of 20261101600000_open_teams.sql.
-- Keeps every team, child, membership and request created by it, and the
-- teams.opened_by column (running the migration again picks them up).

begin;

drop function if exists public.search_teams(text, int, text);
drop function if exists public.open_team(text, text, text, int, text, text, boolean, text);
drop function if exists public.adopt_team(uuid, uuid, uuid);

-- restore the previous versions
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

create or replace function public.request_join(
  p_team uuid, p_player uuid default null, p_first text default '', p_last text default '',
  p_birth_year int default null, p_message text default '',
  p_relation text default 'parent', p_declare_parent boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
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
  return v_id;
end;
$$;

drop function if exists public.team_public(uuid);
create function public.team_public(p_team uuid)
returns table (team_id uuid, name text, season text, sport text, club_id uuid, club_name text, club_status text,
               program_kind text, players int, is_member boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.season, t.sport, c.id, coalesce(c.name, nullif(t.club, '')), c.status, cp.kind,
         (select count(*)::int from player_assignments a where a.team_id = t.id and a.ended_on is null),
         is_team_member(t.id)
  from teams t
  left join clubs c on c.id = t.club_id and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where auth.uid() is not null and t.id = p_team and t.archived_at is null;
$$;

drop function if exists public.team_has_staff(uuid);
drop index if exists public.teams_birth_year_idx;
drop index if exists public.teams_name_trgm_idx;

revoke all on function public.request_join, public.team_public from public, anon;
grant execute on function public.request_join, public.team_public to authenticated;

commit;
