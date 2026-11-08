-- iPlays STAGING, add-on part 10 (club-os-pilot). NEVER run on Production.
-- Run in the SQL Editor of the Staging project, after part 9.
do $$
begin
  if to_regclass('staging.bundle_progress') is null then
    raise exception 'ABORT: this database is not a Staging project in progress (run parts 1-9 first).';
  end if;
  if not exists (select 1 from staging.bundle_progress where part = 9) then
    raise exception 'ABORT: run part 9 first.';
  end if;
  if exists (select 1 from staging.bundle_progress where part = 10) then
    raise exception 'ABORT: part 10 already ran here.';
  end if;
end $$;

-- ==== 20261106700000_club_os_pilot.sql ====
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


insert into staging.bundle_progress (part) values (10);
select 10 as part_done, 'club-os-pilot' as label;
