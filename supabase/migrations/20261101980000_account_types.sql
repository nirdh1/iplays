-- iplays — what the user uses the app for: parent of a player and / or club.
--
-- Run after 20261101971000_match_events.sql.
-- Rollback: supabase/rollback/20261101980000_account_types.down.sql
-- Adds one column with a default (club staff get "club" added); nothing is removed.
--
-- Product decision (2026-11-01, project owner): at sign-up the user picks
-- "parent of a player", "club", or both. Club tools ("ניהול מועדון") show only
-- to users who picked club. It can be changed later in the Family tab. This is
-- a display preference only: permissions stay in club_staff / permission_grants.

begin;

alter table public.profiles
  add column if not exists account_types text[] not null default '{parent}';

alter table public.profiles drop constraint if exists profiles_account_types_check;
alter table public.profiles add constraint profiles_account_types_check
  check (account_types <@ array['parent', 'club']::text[] and cardinality(account_types) between 1 and 2);

-- existing club staff see their club tools without having to pick again
update public.profiles p set account_types = array(select distinct unnest(p.account_types || array['club']))
where exists (select 1 from club_staff s where s.user_id = p.id)
  and not ('club' = any(p.account_types));

commit;
