-- iplays — the team coach's name as the IFA site lists it.
--
-- Run after 20261101800000_ifa_import.sql (needs ifa_teams). Additive only:
-- two columns and two functions; nothing existing is changed.
-- Rollback: supabase/rollback/20261103900000_ifa_team_coaches.down.sql
--
-- Source: the staff list (#teamStaff) of the roster page saved from the IFA
-- site. Only people whose role names a coach (מאמן הקבוצה, עוזר מאמן, מאמן
-- שוערים, מאמן כושר) are kept: name + role, head coach first. Club officials
-- (board, secretary, medic) are not stored. A coach's name is public on the
-- IFA site; in the app it is shown to members of the team only.
--
-- The data itself is loaded by a separate file generated from the saved pages
-- (iplays-ifa-coaches-data.sql), and later by the admin roster import.

begin;

alter table public.ifa_teams add column if not exists coaches jsonb not null default '[]'::jsonb
  check (jsonb_typeof(coaches) = 'array');
alter table public.ifa_teams add column if not exists coaches_seen_at timestamptz;

-- The IFA coaches of an app team ([] when none are known).
create or replace function public.team_ifa_coaches(p_team uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('coaches', it.coaches, 'seen_at', it.coaches_seen_at)
    from ifa_teams it
    where it.team_id = p_team
    order by it.ifa_season_id desc
    limit 1), jsonb_build_object('coaches', '[]'::jsonb))
  where auth.uid() is not null and (is_team_member(p_team) or is_platform_admin());
$$;

-- Platform admin: store the coaches read from a roster page. p_coaches: [{name, role}]
create or replace function public.set_ifa_team_coaches(p_season int, p_ifa_team int, p_coaches jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_coaches) is distinct from 'array' or jsonb_array_length(p_coaches) > 12 then
    raise exception 'coaches must be a short list' using errcode = '22023';
  end if;
  update ifa_teams set
    coaches = coalesce((
      select jsonb_agg(jsonb_build_object('name', left(btrim(c->>'name'), 80), 'role', left(btrim(coalesce(c->>'role', '')), 80)) order by ord)
      from jsonb_array_elements(p_coaches) with ordinality as e(c, ord)
      where btrim(coalesce(c->>'name', '')) <> ''), '[]'::jsonb),
    coaches_seen_at = now()
  where ifa_season_id = p_season and ifa_team_id = p_ifa_team;
end;
$$;

revoke all on function public.team_ifa_coaches(uuid), public.set_ifa_team_coaches(int, int, jsonb) from public, anon;
grant execute on function public.team_ifa_coaches(uuid), public.set_ifa_team_coaches(int, int, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
