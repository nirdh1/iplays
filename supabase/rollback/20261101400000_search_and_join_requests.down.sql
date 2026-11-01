-- iplays — rollback for 20261101400000_search_and_join_requests.sql
-- Removes open search, join requests, shirt-number and kit functions, and
-- restores is_player_guardian / claim_player as they were.
-- No data is deleted: join_requests and player_kit stay (no access policies,
-- so nobody can read them through the API) and are reused if the migration
-- is run again. Guardians added through approved requests stay linked.

begin;

drop policy if exists join_requests_select on public.join_requests;
drop policy if exists player_kit_select on public.player_kit;
revoke all on public.join_requests, public.player_kit from authenticated;

drop function if exists public.search_players(text, int);
drop function if exists public.search_clubs(text);
drop function if exists public.club_teams_public(uuid, int);
drop function if exists public.request_join(uuid, uuid, text, text, int, text, text, boolean);
drop function if exists public.cancel_join_request(uuid);
drop function if exists public.review_join_request(uuid, boolean);
drop function if exists public.pending_join_requests(uuid);
drop function if exists public.my_follow_requests();
drop function if exists public.my_join_requests();
drop function if exists public.team_public(uuid);
drop function if exists public.team_roster_public(uuid);
drop function if exists public.set_shirt_number(uuid, uuid, int);
drop function if exists public.set_player_kit(uuid, int, int, int, int, int, text, text, text, text);
drop function if exists public.can_edit_kit(uuid);

-- any guardian again (20261101100000_coach.sql)
create or replace function public.is_player_guardian(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid());
$$;
drop function if exists public.is_player_parent(uuid);

-- as in 20261101200000_clubs_and_assignments.sql
create or replace function public.claim_player(p_player uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from player_assignments a
    where a.player_id = p_player and a.ended_on is null and is_team_member(a.team_id)
  ) then
    raise exception 'player not found in your teams' using errcode = '42501';
  end if;
  insert into player_guardians (player_id, user_id) values (p_player, auth.uid())
  on conflict do nothing;
end;
$$;

drop index if exists public.players_name_trgm_idx;
drop index if exists public.clubs_name_trgm_idx;

do $$
begin
  raise notice 'iplays: search and join requests rolled back (data kept)';
end;
$$;

commit;
