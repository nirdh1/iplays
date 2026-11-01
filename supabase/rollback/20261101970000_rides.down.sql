-- Rollback of 20261101970000_rides.sql. Deletes every ride, seat and "needs a ride" mark.
begin;
drop function if exists public.rides_summary(uuid);
drop function if exists public.event_rides(text, uuid);
drop function if exists public.set_ride_need(text, uuid, uuid, text, text);
drop function if exists public.leave_ride(uuid, uuid);
drop function if exists public.join_ride(uuid, uuid);
drop function if exists public.cancel_ride(uuid);
drop function if exists public.offer_ride(text, uuid, text, int, time, text, text);
drop function if exists public.ride_need_after(text, text);
drop function if exists public.ride_player_on_team(uuid, uuid);
drop function if exists public.ride_dirs_overlap(text, text);
drop function if exists public.ride_event_team(text, uuid);
drop table if exists public.ride_needs;
drop table if exists public.ride_passengers;
drop table if exists public.rides;
commit;
