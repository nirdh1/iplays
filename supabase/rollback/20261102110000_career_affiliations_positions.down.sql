-- Rollback for 20261102110000_career_affiliations_positions.sql.
-- Removes the RPCs and the read policy. Kept: players.secondary_positions,
-- player_external_affiliations and its rows, the 'player_left' notification
-- kind (old notifications of that kind stay valid). Running the migration
-- again picks them up.

begin;

drop function if exists public.player_profile_extra(uuid);
drop function if exists public.parent_end_affiliation(uuid, uuid, text, date);
drop function if exists public.remove_external_affiliation(uuid);
drop function if exists public.save_external_affiliation(uuid, uuid, text, text, date, date, text);
drop function if exists public.set_player_profile(uuid, text, text[], text);
drop policy if exists player_external_affiliations_read on public.player_external_affiliations;
drop function if exists public.can_edit_player_profile(uuid);
drop function if exists public.position_list(text);

commit;
