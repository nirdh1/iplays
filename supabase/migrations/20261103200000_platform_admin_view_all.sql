-- iplays — Super Admin sees every player's details (owner request 2026-11-02).
--
-- Run after all earlier migrations. Additive: only functions and two extra
-- read policies; no table or row changes.
-- Rollback: supabase/rollback/20261103200000_platform_admin_view_all.down.sql
--
-- Owner's decision: a platform admin (platform_admins) sees everything about
-- every player — full name (also for IFA-imported kids with no parent yet),
-- teams, games, lineups, attendance, kit, medical clearances, assessments,
-- the career card and the club's coach notes — EXCEPT the parent-only
-- body measurements, nutrition and goals (can_see_child_private(), untouched).
--
-- Read only. Super Admin gets "view" (level 1) everywhere; nothing here lets
-- them create, edit or delete. Every write path asks for level >= 2, or uses
-- my_level() / can_club() directly, which this file does not change.

begin;

-- 1. View level in every team domain. All read checks in RLS and in the
--    read functions (attendance reports, lineups, match feed, kit, roster,
--    the masking in find_players() / team_roster_public()) go through
--    can(team, domain, 1), so this one change opens them to the admin.
create or replace function public.can(p_team uuid, p_domain text, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select my_level(p_team, p_domain) >= p_level
      or (p_level <= 1 and is_platform_admin());
$$;

-- 2. Player rows, guardians, career card (player_career checks this first).
create or replace function public.can_view_player(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid())
      or exists (
        select 1 from player_assignments a join team_members m on m.team_id = a.team_id
        where a.player_id = p_player and m.user_id = auth.uid()
          and (a.ended_on is null or m.role <> 'parent')
      )
      or exists (
        select 1 from player_assignments a
        where a.player_id = p_player and a.ended_on is null
          and (my_level(a.team_id, 'roster') >= 1 or my_level(a.team_id, 'attendance') >= 1
               or my_level(a.team_id, 'metrics') >= 1)
      )
      or exists (select 1 from players p where p.id = p_player and p.team_id is not null and is_team_member(p.team_id)
                 and not exists (select 1 from player_assignments a where a.player_id = p.id));
$$;

-- 3. Names of parents / coaches shown next to a player.
drop policy if exists profiles_select_platform_admin on public.profiles;
create policy profiles_select_platform_admin on public.profiles for select to authenticated
  using (is_platform_admin());

-- 4. The older search (search_players) left unclaimed IFA kids out; the admin sees them.
create or replace function public.search_players(p_query text, p_birth_year int default null)
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  team_id uuid, team_name text, club_id uuid, club_name text, program_kind text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
  v_admin boolean := is_platform_admin();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  select p.id, p.first_name, p.last_name, p.birth_year,
         t.id, t.name, c.id, coalesce(c.name, nullif(t.club, '')), cp.kind
  from players p
  join player_assignments a on a.player_id = p.id and a.ended_on is null
  join teams t on t.id = a.team_id and t.archived_at is null
  left join clubs c on c.id = t.club_id and c.status <> 'suspended'
  left join club_programs cp on cp.id = t.program_id
  where p.archived_at is null
    and (p.first_name || ' ' || p.last_name) ilike '%' || v_q || '%'
    and (p_birth_year is null or p.birth_year = p_birth_year)
    and (v_admin or not is_unclaimed_import(p.id))
  order by p.first_name, p.last_name
  limit 30;
end;
$$;

-- 5. Coach notes (player_pro_notes): read for the admin. Only when the
--    club-roles migration (iplays-club-signup-roles-notes.sql) is already in;
--    if it is run later, run this file again afterwards.
--    The child's own parents still never see the notes, even as admin.
do $do$
begin
  if to_regclass('public.player_pro_notes') is not null
     and to_regclass('public.club_role_assignments') is not null then
    execute $f$
      create or replace function public.pro_notes_level(p_club uuid, p_player uuid)
      returns smallint language sql stable security definer set search_path = public as $$
        select case
          when auth.uid() is null then 0
          when exists (select 1 from player_guardians g where g.player_id = p_player and g.user_id = auth.uid()) then 0
          else greatest(
            case when is_club_admin(p_club) then 4 else 0 end,
            case when can_club(p_club, 'pro_notes', 4) then 4 when can_club(p_club, 'pro_notes', 3) then 3
                 when can_club(p_club, 'pro_notes', 2) then 2 when can_club(p_club, 'pro_notes', 1) then 1 else 0 end,
            coalesce((select max(my_level(a.team_id, 'pro_notes')) from player_assignments a join teams t on t.id = a.team_id
                      where a.player_id = p_player and a.ended_on is null and t.club_id = p_club), 0),
            case when is_platform_admin() then 1 else 0 end
          ) end::smallint;
      $$;
    $f$;
  else
    raise notice 'player_pro_notes not installed yet: coach notes skipped (run this file again after iplays-club-signup-roles-notes.sql)';
  end if;
end
$do$;

commit;

-- Check (as the Super Admin, in the app): search a child by name — the full
-- name shows; tapping it opens the player's card.
