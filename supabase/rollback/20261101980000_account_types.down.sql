-- Rollback of 20261101980000_account_types.sql. Keeps the column and its data
-- (dropping it would lose users' choices); only removes the check constraint.
begin;
alter table public.profiles drop constraint if exists profiles_account_types_check;
commit;
