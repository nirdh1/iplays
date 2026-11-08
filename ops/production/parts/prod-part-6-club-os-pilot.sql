-- iPlays 2.0 PRODUCTION part 6 of 6: club-os-pilot
-- Run ONLY in the Production SQL editor, ONLY after: backup PASSED + your approval of this part.
-- Additive. Rollback files: supabase/rollback/<same name>.down.sql
-- Built from: 20261106700000_club_os_pilot.sql
do $guard$ begin
  if to_regnamespace('staging') is not null then raise exception 'ABORT: this is the Staging database. Use the staging parts there.'; end if;
  if to_regclass('public.ifa_players') is null or (select count(*) from public.ifa_players) < 1000 then raise exception 'ABORT: this does not look like iPlays Production.'; end if;
  if not (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exercises' and column_name = 'video_url')) then raise exception 'ABORT: part 6 needs part 5 to run first. Nothing changed.'; end if;
  if (to_regclass('public.os_pilot_users') is not null) then raise exception 'ABORT: part 6 already ran here. Nothing changed.'; end if;
end $guard$;

-- ===== 20261106700000_club_os_pilot.sql
-- iPlays 2.0: Club OS pilot list. In a Production build Club OS opens only for
-- accounts in os_pilot_users; everyone else keeps V1. Rows are added by the
-- operator in the SQL editor only (no app path writes this table).
-- On Staging the list is not used (the app opens Club OS for everyone there).
--
-- Additive only. Rollback: supabase/rollback/20261106700000_club_os_pilot.down.sql

create table if not exists public.os_pilot_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 200),
  added_at timestamptz not null default now()
);
alter table public.os_pilot_users enable row level security;
revoke all on public.os_pilot_users from anon, authenticated;

create or replace function public.os_pilot_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from os_pilot_users where user_id = auth.uid());
$$;
revoke all on function public.os_pilot_enabled() from public, anon;
grant execute on function public.os_pilot_enabled() to authenticated;

select 6 as part_done, 'club-os-pilot' as label;
