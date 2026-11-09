-- Club director dashboard: results and coach per club team (decision 2026-11-09:
-- "מאזנים והשוואת מאמנים"). Read-only, function only: no table or row changes.
-- For each team of the club: its IFA league standing (same rules as
-- team_league_table(): only IFA-published results, win 3 / draw 1), last-5 form,
-- the IFA head coach's name (public on the IFA site) and the app coaches' names.
-- Who: the same people who may open the club dashboard (can_view_club_dashboard).
-- No players, no personal data beyond staff names.
-- Rollback: supabase/rollback/20261109200000_club_team_results.down.sql
begin;

create or replace function public.club_team_results(p_club uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_t record;
  v_tab jsonb;
  v_us jsonb;
begin
  if not can_view_club_dashboard(p_club) then return null; end if;
  for v_t in select id, name from teams where club_id = p_club and archived_at is null order by name loop
    v_tab := team_league_table(v_t.id);
    v_us := (select r from jsonb_array_elements(coalesce(v_tab -> 'rows', '[]'::jsonb)) r where (r ->> 'is_us')::boolean limit 1);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'team_id', v_t.id,
      'name', v_t.name,
      'linked', v_tab is not null,
      'league_name', v_tab ->> 'league_name',
      'has_results', coalesce((v_tab ->> 'has_results')::boolean, false),
      'league_teams', jsonb_array_length(coalesce(v_tab -> 'rows', '[]'::jsonb)),
      'last_result_at', v_tab ->> 'last_result_at',
      'pos', (v_us ->> 'pos')::int,
      'played', (v_us ->> 'played')::int,
      'won', (v_us ->> 'won')::int,
      'drawn', (v_us ->> 'drawn')::int,
      'lost', (v_us ->> 'lost')::int,
      'goals_for', (v_us ->> 'goals_for')::int,
      'goals_against', (v_us ->> 'goals_against')::int,
      'points', (v_us ->> 'points')::int,
      'form', coalesce(v_us ->> 'form', ''),
      'ifa_coach', (select it.coaches -> 0 ->> 'name' from ifa_teams it
                    where it.team_id = v_t.id order by it.ifa_season_id desc limit 1),
      'app_coaches', coalesce((select jsonb_agg(distinct nullif(p.full_name, '')) filter (where nullif(p.full_name, '') is not null)
                               from team_members m join profiles p on p.id = m.user_id
                               where m.team_id = v_t.id and m.role in ('coach', 'admin')), '[]'::jsonb)
    ));
  end loop;
  return jsonb_build_object('club_id', p_club, 'generated_at', now(), 'teams', v_out);
end $$;

revoke all on function public.club_team_results(uuid) from public, anon;
grant execute on function public.club_team_results(uuid) to authenticated;

commit;
