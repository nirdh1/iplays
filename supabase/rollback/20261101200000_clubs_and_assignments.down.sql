-- iplays — rollback for 20261101200000_clubs_and_assignments.sql
--
-- Returns the schema to how it was after 20261101100000_coach.sql.
-- Players, teams, guardians, trainings and absences are NOT touched (they
-- existed before). What is removed is only what M1+M2 added: clubs,
-- programs, club staff, claims, audit log, assignments and transfers.
--
-- Before running: if players were added to a second team in parallel, or
-- moved, players.team_id already holds their current main team, so the old
-- app keeps showing them there. Parallel (second) teams are lost on rollback;
-- export player_assignments / player_transfers first if you need them:
--   select * from player_assignments;  select * from player_transfers;

begin;

-- a player whose only team ended keeps team_id; make sure none is null
do $$
begin
  if exists (select 1 from public.players where team_id is null) then
    raise exception 'some players have no team (added after M2 without one); assign them before rolling back';
  end if;
end;
$$;

-- ------------------------------------------------ restore original policies

drop policy if exists absences_select on public.player_absences;
create policy absences_select on public.player_absences for select to authenticated
  using (is_team_staff(team_id) or is_player_guardian(player_id));

drop policy if exists guardians_select on public.player_guardians;
create policy guardians_select on public.player_guardians for select to authenticated
  using (exists (select 1 from public.players p where p.id = player_id and is_team_member(p.team_id)));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated using (is_team_member(id));
create policy teams_delete on public.teams for delete to authenticated
  using (exists (select 1 from public.team_members m where m.team_id = id and m.user_id = auth.uid() and m.role = 'admin'));
grant delete on public.teams to authenticated;

drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated using (is_team_member(team_id));
create policy players_delete on public.players for delete to authenticated using (is_team_staff(team_id));
grant delete on public.players to authenticated;

-- ------------------------------------------------ restore original functions

create or replace function public.claim_player(p_player uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from players where id = p_player;
  if v_team is null or not is_team_member(v_team) then
    raise exception 'player not found in your teams' using errcode = '42501';
  end if;
  insert into player_guardians (player_id, user_id) values (p_player, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.player_absences_set_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from players where id = new.player_id;
  if new.team_id is null then
    raise exception 'player not found' using errcode = 'P0002';
  end if;
  if new.session_id is not null
     and not exists (select 1 from training_sessions s where s.id = new.session_id and s.team_id = new.team_id) then
    raise exception 'training not in this team' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------- drop M2 objects

drop trigger if exists players_guard_team on public.players;
drop trigger if exists players_create_assignment on public.players;
drop trigger if exists player_assignments_sync on public.player_assignments;
drop table if exists public.player_transfers;
drop table if exists public.player_assignments;
drop function if exists public.end_player_assignment(uuid, uuid, text, date);
drop function if exists public.transfer_player(uuid, uuid, text, uuid, text, int, date);
drop function if exists public.can_manage_team_roster(uuid);
drop function if exists public.players_before_update();
drop function if exists public.players_after_insert();
drop function if exists public.player_assignments_after();
drop function if exists public.sync_player_primary(uuid);
drop function if exists public.is_player_staff(uuid);
drop function if exists public.can_view_player(uuid);
drop function if exists public.player_team_ids(uuid);

alter table public.players drop constraint players_team_id_fkey;
alter table public.players
  add constraint players_team_id_fkey foreign key (team_id) references public.teams (id) on delete cascade;
alter table public.players alter column team_id set not null;

-- ------------------------------------------------------- drop M1 objects

drop trigger if exists teams_guard_club on public.teams;
drop function if exists public.archive_team(uuid, boolean);
drop function if exists public.set_club_status(uuid, text);
drop function if exists public.request_club_verification(uuid, text);
drop function if exists public.set_team_program(uuid, uuid);
drop function if exists public.update_club(uuid, text, text);
drop function if exists public.add_program(uuid, text, text);
drop function if exists public.create_club(text, text);
drop function if exists public.teams_guard_club();
drop function if exists public.write_audit(text, uuid, text, uuid, jsonb);

alter table public.players drop column if exists archived_at;
alter table public.teams
  drop column if exists archived_at,
  drop column if exists birth_year_to,
  drop column if exists birth_year_from,
  drop column if exists age_group,
  drop column if exists program_id,
  drop column if exists club_id;

drop table if exists public.audit_log;
drop table if exists public.club_claims;
drop table if exists public.club_staff;
drop table if exists public.club_programs;
drop table if exists public.clubs;

drop function if exists public.is_trusted_context();
drop function if exists public.is_team_admin(uuid);
drop function if exists public.is_club_member(uuid);
drop function if exists public.is_club_admin(uuid);
drop table if exists public.platform_admins;
drop function if exists public.is_platform_admin();

commit;
