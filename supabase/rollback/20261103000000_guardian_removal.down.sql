-- Rollback of 20261103000000_guardian_removal.sql: drops its functions. No data changes
-- (links already removed stay removed; the audit log keeps the record).
begin;
drop function if exists public.admin_remove_guardian(uuid, uuid, text);
drop function if exists public.admin_child_guardians(text);
drop function if exists public.leave_child(uuid);
drop function if exists public.drop_parent_membership(uuid, uuid);
commit;
