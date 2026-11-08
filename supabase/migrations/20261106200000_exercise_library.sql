-- iPlays 2.0 MVP, day 3: exercise library.
--
-- Three libraries in one table:
--   iplays   – the iPlays base library, readable by every staff member of every
--              club; nobody edits it from the app (content is added by
--              migration and reviewed by a licensed coach before it is marked
--              approved); copy it to edit.
--   club     – a club's library: read by the club's staff (not parents),
--              written by club admins / staff with training level 3 at club level.
--   personal – a coach's own exercises: only the owner reads and writes them.
-- A parent account (team_members.role = 'parent' only) sees none of it.
-- Diagrams are JSON (pitch preset + elements + lines, coordinates in metres),
-- drawn by the shared <Pitch> component; no files in Storage.
--
-- Additive only: new tables and functions. Staging first; Production only
-- after the MVP review and a separate approval.
-- Rollback: supabase/rollback/20261106200000_exercise_library.down.sql

create table if not exists public.exercise_categories (
  code text primary key check (code ~ '^[a-z_]{2,30}$'),
  label text not null check (char_length(label) between 1 and 40),
  sort int not null,
  -- the initial list is a draft until the pilot club's sporting director approves it
  approved boolean not null default false
);

insert into public.exercise_categories (code, label, sort) values
  ('warmup', 'חימום וקואורדינציה', 1),
  ('rondo', 'שמירת כדור ורונדו', 2),
  ('technique', 'טכניקה', 3),
  ('ssg', 'משחקונים', 4),
  ('transition', 'מעברים', 5),
  ('defending', 'הגנה', 6),
  ('finishing', 'סיומת', 7),
  ('goalkeeping', 'שוערים', 8),
  ('set_pieces', 'מצבים נייחים', 9),
  ('fitness', 'כושר', 10)
on conflict (code) do nothing;

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('iplays', 'club', 'personal')),
  owner_id uuid references auth.users (id) on delete set null,
  club_id uuid references public.clubs (id) on delete cascade,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  -- base-library review: original content, checked by a licensed coach
  review_status text not null default 'not_needed' check (review_status in ('not_needed', 'pending_review', 'approved')),
  title text not null check (char_length(title) between 2 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  coaching_points text not null default '' check (char_length(coaching_points) <= 600),
  category text not null references public.exercise_categories (code),
  difficulty smallint not null default 2 check (difficulty between 1 and 4),
  age_from smallint not null default 8 check (age_from between 5 and 21),
  age_to smallint not null default 18 check (age_to between 5 and 21),
  players_min smallint not null default 4 check (players_min between 1 and 30),
  players_max smallint not null default 16 check (players_max between 1 and 40),
  duration_min smallint not null default 15 check (duration_min between 1 and 120),
  pitch_preset text not null default 'half' check (pitch_preset in ('11v11', '9v9', '7v7', 'half', 'third', 'custom')),
  area_w_m smallint check (area_w_m between 5 and 120),
  area_l_m smallint check (area_l_m between 5 and 120),
  equipment text[] not null default '{}',
  diagram jsonb not null default '{"v":1,"elements":[],"lines":[]}'::jsonb
    check (jsonb_typeof(diagram) = 'object' and pg_column_size(diagram) <= 65536),
  copied_from uuid references public.exercises (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (age_from <= age_to),
  check (players_min <= players_max),
  check (
    (scope = 'iplays' and club_id is null and owner_id is null)
    or (scope = 'club' and club_id is not null)
    or (scope = 'personal' and owner_id is not null and club_id is null)
  )
);
create index if not exists exercises_scope_idx on public.exercises (scope, status);
create index if not exists exercises_club_idx on public.exercises (club_id) where club_id is not null;
create index if not exists exercises_owner_idx on public.exercises (owner_id) where owner_id is not null;
create index if not exists exercises_title_trgm on public.exercises using gin (title gin_trgm_ops);

alter table public.exercises enable row level security;
alter table public.exercise_categories enable row level security;

-- staff anywhere (coach, assistant, instructor, team manager, team admin) or club staff
create or replace function public.is_any_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members where user_id = auth.uid() and role <> 'parent')
      or exists (select 1 from club_staff where user_id = auth.uid());
$$;

-- staff of this club (not parents of its players)
create or replace function public.is_club_staff_member(p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_staff where club_id = p_club and user_id = auth.uid())
      or exists (select 1 from teams t join team_members m on m.team_id = t.id
                 where t.club_id = p_club and m.user_id = auth.uid() and m.role <> 'parent');
$$;

create or replace function public.can_read_exercise(p_scope text, p_owner uuid, p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'iplays' then is_any_staff()
    when 'club' then is_club_staff_member(p_club)
    when 'personal' then p_owner = auth.uid()
    else false end;
$$;

create or replace function public.can_write_exercise(p_scope text, p_owner uuid, p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_scope
    when 'club' then can_club(p_club, 'training', 3)
    when 'personal' then p_owner = auth.uid() and is_any_staff()
    else false end;   -- the iPlays base library is never edited from the app
$$;

drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises for select to authenticated
  using (status <> 'archived' and can_read_exercise(scope, owner_id, club_id)
         or (status = 'archived' and can_write_exercise(scope, owner_id, club_id)));

drop policy if exists exercise_categories_select on public.exercise_categories;
create policy exercise_categories_select on public.exercise_categories for select to authenticated using (true);

grant select on public.exercises, public.exercise_categories to authenticated;
revoke insert, update, delete on public.exercises from anon, authenticated;

-- Create or update one exercise. p_id null = create. Returns the id.
create or replace function public.save_exercise(p_id uuid, p_scope text, p_club uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_row exercises;
  v_id uuid;
  v_eq text[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_id is not null then
    select * into v_row from exercises where id = p_id;
    if not found then raise exception 'exercise not found'; end if;
    if not can_write_exercise(v_row.scope, v_row.owner_id, v_row.club_id) then raise exception 'not allowed'; end if;
  else
    if p_scope not in ('club', 'personal') then raise exception 'not allowed'; end if;
    if not can_write_exercise(p_scope, case when p_scope = 'personal' then auth.uid() end, case when p_scope = 'club' then p_club end) then
      raise exception 'not allowed';
    end if;
  end if;
  v_eq := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'equipment', '[]'::jsonb))), '{}');
  if p_id is null then
    insert into exercises (scope, owner_id, club_id, status, title, description, coaching_points, category, difficulty,
                           age_from, age_to, players_min, players_max, duration_min, pitch_preset, area_w_m, area_l_m,
                           equipment, diagram, copied_from)
    values (p_scope, case when p_scope = 'personal' then auth.uid() end, case when p_scope = 'club' then p_club end,
            coalesce(p ->> 'status', 'active'), trim(p ->> 'title'), coalesce(trim(p ->> 'description'), ''),
            coalesce(trim(p ->> 'coaching_points'), ''), p ->> 'category', coalesce((p ->> 'difficulty')::smallint, 2),
            coalesce((p ->> 'age_from')::smallint, 8), coalesce((p ->> 'age_to')::smallint, 18),
            coalesce((p ->> 'players_min')::smallint, 4), coalesce((p ->> 'players_max')::smallint, 16),
            coalesce((p ->> 'duration_min')::smallint, 15), coalesce(p ->> 'pitch_preset', 'half'),
            (p ->> 'area_w_m')::smallint, (p ->> 'area_l_m')::smallint, v_eq,
            coalesce(p -> 'diagram', '{"v":1,"elements":[],"lines":[]}'::jsonb), (p ->> 'copied_from')::uuid)
    returning id into v_id;
  else
    update exercises set
      status = coalesce(p ->> 'status', status),
      title = coalesce(trim(p ->> 'title'), title),
      description = coalesce(trim(p ->> 'description'), description),
      coaching_points = coalesce(trim(p ->> 'coaching_points'), coaching_points),
      category = coalesce(p ->> 'category', category),
      difficulty = coalesce((p ->> 'difficulty')::smallint, difficulty),
      age_from = coalesce((p ->> 'age_from')::smallint, age_from),
      age_to = coalesce((p ->> 'age_to')::smallint, age_to),
      players_min = coalesce((p ->> 'players_min')::smallint, players_min),
      players_max = coalesce((p ->> 'players_max')::smallint, players_max),
      duration_min = coalesce((p ->> 'duration_min')::smallint, duration_min),
      pitch_preset = coalesce(p ->> 'pitch_preset', pitch_preset),
      area_w_m = case when p ? 'area_w_m' then (p ->> 'area_w_m')::smallint else area_w_m end,
      area_l_m = case when p ? 'area_l_m' then (p ->> 'area_l_m')::smallint else area_l_m end,
      equipment = case when p ? 'equipment' then v_eq else equipment end,
      diagram = coalesce(p -> 'diagram', diagram),
      updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Copy any exercise I can read into my library or my club's library.
create or replace function public.copy_exercise(p_id uuid, p_scope text, p_club uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v exercises; v_id uuid;
begin
  select * into v from exercises where id = p_id and status <> 'archived';
  if not found or not can_read_exercise(v.scope, v.owner_id, v.club_id) then raise exception 'exercise not found'; end if;
  if p_scope not in ('club', 'personal')
     or not can_write_exercise(p_scope, case when p_scope = 'personal' then auth.uid() end, case when p_scope = 'club' then p_club end) then
    raise exception 'not allowed';
  end if;
  insert into exercises (scope, owner_id, club_id, status, title, description, coaching_points, category, difficulty,
                         age_from, age_to, players_min, players_max, duration_min, pitch_preset, area_w_m, area_l_m,
                         equipment, diagram, copied_from)
  values (p_scope, case when p_scope = 'personal' then auth.uid() end, case when p_scope = 'club' then p_club end,
          'active', left(v.title || ' (עותק)', 80), v.description, v.coaching_points, v.category, v.difficulty,
          v.age_from, v.age_to, v.players_min, v.players_max, v.duration_min, v.pitch_preset, v.area_w_m, v.area_l_m,
          v.equipment, v.diagram, v.id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.archive_exercise(p_id uuid, p_archived boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v exercises;
begin
  select * into v from exercises where id = p_id;
  if not found or not can_write_exercise(v.scope, v.owner_id, v.club_id) then raise exception 'not allowed'; end if;
  update exercises set status = case when p_archived then 'archived' else 'active' end, updated_at = now() where id = p_id;
end $$;

-- clubs whose library I may write to (for the "save to club" choice)
create or replace function public.my_exercise_clubs()
returns table (club_id uuid, name text, can_write boolean) language sql stable security definer set search_path = public as $$
  select c.id, c.name, can_club(c.id, 'training', 3)
  from clubs c
  where c.archived_at is null and is_club_staff_member(c.id)
  order by c.name;
$$;

revoke all on function public.is_any_staff(), public.is_club_staff_member(uuid), public.can_read_exercise(text, uuid, uuid),
  public.can_write_exercise(text, uuid, uuid), public.save_exercise(uuid, text, uuid, jsonb), public.copy_exercise(uuid, text, uuid),
  public.archive_exercise(uuid, boolean), public.my_exercise_clubs() from public, anon;
grant execute on function public.is_any_staff(), public.is_club_staff_member(uuid), public.can_read_exercise(text, uuid, uuid),
  public.can_write_exercise(text, uuid, uuid), public.save_exercise(uuid, text, uuid, jsonb), public.copy_exercise(uuid, text, uuid),
  public.archive_exercise(uuid, boolean), public.my_exercise_clubs() to authenticated;
