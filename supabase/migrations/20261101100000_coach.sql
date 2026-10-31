-- iplays — coach board: training sessions, coach announcements, and
-- absence / lateness reports (including dates marked in advance).
--
-- Run after 20261031000000_init.sql. Every table has Row Level Security:
--   * training sessions and announcements: every team member reads, staff
--     (admin / coach) write;
--   * absence reports are private: only team staff and the player's own
--     guardians can see them (other parents never see reasons).

-- ---------------------------------------------------------------- tables

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  starts_at timestamptz not null,
  duration_min int not null default 90 check (duration_min between 15 and 300),
  title text not null default 'אימון קבוצתי' check (char_length(title) between 1 and 60),
  location text not null default '' check (char_length(location) <= 80),
  note text not null default '' check (char_length(note) <= 300),
  canceled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index training_sessions_team_idx on public.training_sessions (team_id, starts_at);

create table public.team_announcements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null default '' check (char_length(body) <= 2000),
  pinned boolean not null default false,
  author_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index team_announcements_team_idx on public.team_announcements (team_id, created_at desc);

create table public.player_absences (
  id uuid primary key default gen_random_uuid(),
  -- filled from the player by a trigger, so it always matches the player's team
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  kind text not null default 'absent' check (kind in ('absent', 'late')),
  from_date date not null,
  to_date date not null,
  -- set when the report is about one specific training
  session_id uuid references public.training_sessions (id) on delete set null,
  reason text not null default 'other' check (reason in ('family_event', 'vacation', 'sick', 'school', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  minutes_late int check (minutes_late between 1 and 180),
  reported_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (to_date >= from_date),
  check (to_date - from_date <= 180),
  check (kind = 'late' or minutes_late is null)
);
create index player_absences_team_idx on public.player_absences (team_id, to_date);
create index player_absences_player_idx on public.player_absences (player_id);

-- --------------------------------------------------------------- helpers

create function public.is_player_guardian(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid());
$$;

create function public.player_absences_set_team()
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

create trigger player_absences_team
  before insert or update of player_id, session_id on public.player_absences
  for each row execute function public.player_absences_set_team();

revoke all on function public.player_absences_set_team from public, anon, authenticated;

-- -------------------------------------------------------------------- RLS

alter table public.training_sessions enable row level security;
alter table public.team_announcements enable row level security;
alter table public.player_absences enable row level security;

-- training sessions: members read, staff manage
create policy sessions_select on public.training_sessions for select to authenticated using (is_team_member(team_id));
create policy sessions_insert on public.training_sessions for insert to authenticated with check (is_team_staff(team_id));
create policy sessions_update on public.training_sessions for update to authenticated
  using (is_team_staff(team_id)) with check (is_team_staff(team_id));
create policy sessions_delete on public.training_sessions for delete to authenticated using (is_team_staff(team_id));

-- announcements: members read, staff post (as themselves) and manage
create policy announcements_select on public.team_announcements for select to authenticated using (is_team_member(team_id));
create policy announcements_insert on public.team_announcements for insert to authenticated
  with check (is_team_staff(team_id) and author_id = auth.uid());
create policy announcements_update on public.team_announcements for update to authenticated
  using (is_team_staff(team_id)) with check (is_team_staff(team_id));
create policy announcements_delete on public.team_announcements for delete to authenticated using (is_team_staff(team_id));

-- absences: staff and the player's guardians only
create policy absences_select on public.player_absences for select to authenticated
  using (is_team_staff(team_id) or is_player_guardian(player_id));
create policy absences_insert on public.player_absences for insert to authenticated
  with check (reported_by = auth.uid() and (is_player_guardian(player_id) or is_team_staff(team_id)));
create policy absences_update on public.player_absences for update to authenticated
  using (is_team_staff(team_id) or is_player_guardian(player_id))
  with check (is_team_staff(team_id) or is_player_guardian(player_id));
create policy absences_delete on public.player_absences for delete to authenticated
  using (is_team_staff(team_id) or is_player_guardian(player_id));

grant select, insert, update, delete on public.training_sessions to authenticated;
grant select, insert, update, delete on public.team_announcements to authenticated;
grant select, insert, update, delete on public.player_absences to authenticated;
