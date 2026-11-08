-- Rollback of 20261106700000_club_os_pilot.sql. Club OS then closes for everyone in Production.
drop function if exists public.os_pilot_enabled();
drop table if exists public.os_pilot_users;
