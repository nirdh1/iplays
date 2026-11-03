-- Rollback of 20261103500000_team_contacts.sql.
-- Removes the directory functions and their RLS policies, and makes the
-- profiles table fully readable to team mates again (as before).
-- Keeps the data: contact_details, player_contacts and player_extra_contacts
-- stay (RLS on, no policies = nobody reads them from the app) so re-running
-- the migration brings everything back as it was.

begin;

drop function if exists public.remove_extra_contact(uuid);
drop function if exists public.save_extra_contact(uuid, uuid, text, text, text, text, boolean, boolean, boolean);
drop function if exists public.set_player_phone_share(uuid, boolean);
drop function if exists public.save_player_phone(uuid, text);
drop function if exists public.set_my_contact_share(text, boolean);
drop function if exists public.save_my_contact_card(text, text, text, text, text, text, text);
drop function if exists public.player_contact_book(uuid);
drop function if exists public.team_directory(uuid);
drop function if exists public.my_contact_card();

drop policy if exists contact_details_select on public.contact_details;
drop policy if exists player_contacts_select on public.player_contacts;
drop policy if exists player_extra_contacts_select on public.player_extra_contacts;

drop function if exists public.contacts_people(uuid, boolean);
drop function if exists public.contacts_is_parent(uuid);
drop function if exists public.contacts_full_for_user(uuid);
drop function if exists public.contacts_full_for_player(uuid);
drop function if exists public.contacts_can_view_team(uuid);
drop function if exists public.contacts_full_access(uuid);
drop function if exists public.contacts_player_teams(uuid);

-- profiles: back to the whole row for the existing policies
grant select on public.profiles to authenticated;

commit;
