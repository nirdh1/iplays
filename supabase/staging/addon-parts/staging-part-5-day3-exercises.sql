-- iPlays STAGING, add-on part 5 (day3-exercises). NEVER run on Production.
-- Run in the SQL Editor of the Staging project, after part 3.
do $$
begin
  if to_regclass('staging.bundle_progress') is null then
    raise exception 'ABORT: this database is not a Staging project in progress (run parts 1-3 first).';
  end if;
  if not exists (select 1 from staging.bundle_progress where part = 3) then
    raise exception 'ABORT: run part 3 first.';
  end if;
  if exists (select 1 from staging.bundle_progress where part = 5) then
    raise exception 'ABORT: part 5 already ran here.';
  end if;
end $$;

-- ==== 20261106200000_exercise_library.sql ====
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


-- ==== 20261106200100_iplays_base_exercises.sql ====
-- iPlays 2.0 MVP, day 3: first 10 exercises of the iPlays base library.
--
-- Original content written for iPlays (text and diagrams), not copied from
-- books, websites, videos, federation or club programmes. Generic names of
-- exercise types (rondo, 3v3) are not protected; the wording, layouts and
-- progressions here are our own.
-- review_status = 'pending_review': drafts until a licensed coach (the pilot
-- club's sporting director) approves each one. The app shows them as drafts.
-- The base library target is 25 exercises; 15 more follow after review.
-- Idempotent: skips titles that already exist in the base library.

insert into public.exercises (scope, status, review_status, title, description, coaching_points, category, difficulty,
  age_from, age_to, players_min, players_max, duration_min, pitch_preset, area_w_m, area_l_m, equipment, diagram, created_by)
select 'iplays', 'active', 'pending_review', v.*, null
from (values
('ריבוע מסירות: מוסר ורץ אחרי הכדור', 'ארבעה קונוסים בריבוע של 15 מטר, 2-3 שחקנים בכל קונוס. השחקן הראשון מוסר לקונוס הבא נגד כיוון השעון ורץ אחרי המסירה לסוף הטור שאליו מסר. אחרי 2 דקות מחליפים כיוון, ואחר כך עוברים למסירה בנגיעה אחת.', 'מסירה בצד הפנימי של כף הרגל, לרגל הרחוקה של המקבל. מבט לפני הקבלה. קבלה בתנועה לכיוון הקונוס הבא.', 'warmup', 1, 7, 14, 8, 12, 10, 'custom', 19, 19, array['קונוסים', 'כדורים']::text[], '{"v": 1, "elements": [{"type": "cone", "x": 2, "y": 2, "id": "e1"}, {"type": "cone", "x": 17, "y": 2, "id": "e2"}, {"type": "cone", "x": 17, "y": 17, "id": "e3"}, {"type": "cone", "x": 2, "y": 17, "id": "e4"}, {"type": "player", "x": 2, "y": 2, "team": "a", "label": "1", "id": "e5"}, {"type": "player", "x": 17, "y": 2, "team": "a", "label": "2", "id": "e6"}, {"type": "player", "x": 17, "y": 17, "team": "a", "label": "3", "id": "e7"}, {"type": "player", "x": 2, "y": 17, "team": "a", "label": "4", "id": "e8"}, {"type": "ball", "x": 3.2, "y": 3, "id": "e9"}], "lines": [{"type": "pass", "pts": [[2, 2], [17, 2]], "id": "l1"}, {"type": "run", "pts": [[2.5, 3], [16, 3.2]], "id": "l2"}, {"type": "pass", "pts": [[17, 2], [17, 17]], "id": "l3"}]}'::jsonb),
('רונדו 4 נגד 1 בריבוע קטן', 'ארבעה שחקנים על צלעות ריבוע של 10 מטר ושחקן אחד באמצע. הארבעה שומרים על הכדור, מקסימום שתי נגיעות. מי שאיבד כדור או מסר מחוץ לריבוע נכנס לאמצע. סבבים של 90 שניות.', 'להיפתח לזווית מסירה בכל רגע. לא למסור לשחקן שהשחקן באמצע חוסם. הגוף פתוח לשדה כבר לפני הקבלה.', 'rondo', 2, 8, 18, 5, 5, 12, 'custom', 12, 12, array['קונוסים', 'כדורים', 'אפודות']::text[], '{"v": 1, "elements": [{"type": "cone", "x": 1, "y": 1, "id": "e1"}, {"type": "cone", "x": 11, "y": 1, "id": "e2"}, {"type": "cone", "x": 11, "y": 11, "id": "e3"}, {"type": "cone", "x": 1, "y": 11, "id": "e4"}, {"type": "player", "x": 6, "y": 1, "team": "a", "id": "e5"}, {"type": "player", "x": 11, "y": 6, "team": "a", "id": "e6"}, {"type": "player", "x": 6, "y": 11, "team": "a", "id": "e7"}, {"type": "player", "x": 1, "y": 6, "team": "a", "id": "e8"}, {"type": "player", "x": 6, "y": 6, "team": "b", "id": "e9"}, {"type": "ball", "x": 6.8, "y": 1.8, "id": "e10"}], "lines": [{"type": "pass", "pts": [[6, 1], [11, 6]], "id": "l1"}, {"type": "run", "pts": [[6, 6], [9, 4.5]], "id": "l2"}]}'::jsonb),
('שערי קונוסים בזוגות', 'פזרו 6-8 שערים קטנים (2 קונוסים במרחק מטר וחצי) בשטח של 30 על 24. כל זוג עם כדור. הזוג מוסר דרך שער, ומחפש מיד שער אחר. סופרים כמה שערים בדקה. שלב ב: רק ברגל החלשה.', 'תקשורת בין בני הזוג. המקבל זז לצד השני של השער לפני המסירה. מסירה מדויקת ובעוצמה נכונה.', 'technique', 1, 7, 13, 6, 16, 10, 'custom', 24, 30, array['קונוסים', 'כדורים']::text[], '{"v": 1, "elements": [{"type": "cone", "x": 5, "y": 5, "id": "e1"}, {"type": "cone", "x": 6.8, "y": 5, "id": "e2"}, {"type": "cone", "x": 14, "y": 4, "id": "e3"}, {"type": "cone", "x": 15.8, "y": 4, "id": "e4"}, {"type": "cone", "x": 23, "y": 8, "id": "e5"}, {"type": "cone", "x": 24.8, "y": 8, "id": "e6"}, {"type": "cone", "x": 8, "y": 16, "id": "e7"}, {"type": "cone", "x": 9.8, "y": 16, "id": "e8"}, {"type": "cone", "x": 18, "y": 15, "id": "e9"}, {"type": "cone", "x": 19.8, "y": 15, "id": "e10"}, {"type": "cone", "x": 25, "y": 19, "id": "e11"}, {"type": "cone", "x": 26.8, "y": 19, "id": "e12"}, {"type": "player", "x": 4, "y": 10, "team": "a", "id": "e13"}, {"type": "player", "x": 10, "y": 11, "team": "a", "id": "e14"}, {"type": "ball", "x": 4.8, "y": 10.5, "id": "e15"}, {"type": "player", "x": 20, "y": 11, "team": "b", "id": "e16"}, {"type": "player", "x": 24, "y": 13, "team": "b", "id": "e17"}], "lines": [{"type": "pass", "pts": [[4.8, 10.5], [10, 11]], "id": "l1"}, {"type": "run", "pts": [[4, 10], [13, 6]], "id": "l2"}]}'::jsonb),
('כדרור סלאלום ושינוי כיוון', 'שני מסלולים מקבילים של 5 קונוסים במרחק 3 מטרים. כל שחקן מכדרר בין הקונוסים, מסתובב בקונוס האחרון וחוזר בקו ישר מהר. מתחלפים בטור. שלב ב: רק בצד החיצוני של כף הרגל.', 'נגיעות קטנות וקרובות לגוף. ראש למעלה בין הקונוסים. האצה אחרי שינוי הכיוון.', 'technique', 1, 6, 12, 4, 12, 10, 'custom', 15, 20, array['קונוסים', 'כדורים']::text[], '{"v": 1, "elements": [{"type": "cone", "x": 4, "y": 5, "id": "e1"}, {"type": "cone", "x": 7, "y": 5, "id": "e2"}, {"type": "cone", "x": 10, "y": 5, "id": "e3"}, {"type": "cone", "x": 13, "y": 5, "id": "e4"}, {"type": "cone", "x": 16, "y": 5, "id": "e5"}, {"type": "cone", "x": 4, "y": 10, "id": "e6"}, {"type": "cone", "x": 7, "y": 10, "id": "e7"}, {"type": "cone", "x": 10, "y": 10, "id": "e8"}, {"type": "cone", "x": 13, "y": 10, "id": "e9"}, {"type": "cone", "x": 16, "y": 10, "id": "e10"}, {"type": "player", "x": 1, "y": 5, "team": "a", "id": "e11"}, {"type": "ball", "x": 2, "y": 5, "id": "e12"}, {"type": "player", "x": 1, "y": 10, "team": "a", "id": "e13"}, {"type": "ball", "x": 2, "y": 10, "id": "e14"}], "lines": [{"type": "dribble", "pts": [[2, 5], [5.5, 6], [7, 4], [10, 6], [13, 4], [16, 5]], "id": "l1"}]}'::jsonb),
('משחקון 3 נגד 3 לשערים קטנים', 'שטח של 25 על 20 עם שער קטן בכל צד. 3 נגד 3 בלי שוערים. שער נחשב רק מתוך השליש של היריב. משחקים 3 דקות ומתחלפים עם הקבוצה הממתינה.', 'לפזר את השטח: רוחב ועומק. אחרי איבוד כדור, השחקן הקרוב לוחץ מיד. לחפש את השחקן החופשי.', 'ssg', 2, 7, 14, 6, 8, 15, 'custom', 20, 25, array['שערים קטנים', 'קונוסים', 'כדורים', 'אפודות']::text[], '{"v": 1, "elements": [{"type": "minigoal", "x": 0.5, "y": 10, "rot": 90, "id": "e1"}, {"type": "minigoal", "x": 24.5, "y": 10, "rot": 90, "id": "e2"}, {"type": "player", "x": 6, "y": 5, "team": "a", "id": "e3"}, {"type": "player", "x": 8, "y": 14, "team": "a", "id": "e4"}, {"type": "player", "x": 12, "y": 9, "team": "a", "id": "e5"}, {"type": "player", "x": 15, "y": 6, "team": "b", "id": "e6"}, {"type": "player", "x": 17, "y": 13, "team": "b", "id": "e7"}, {"type": "player", "x": 20, "y": 9, "team": "b", "id": "e8"}, {"type": "ball", "x": 12.8, "y": 9.6, "id": "e9"}], "lines": [{"type": "pass", "pts": [[12, 9], [8, 14]], "id": "l1"}, {"type": "run", "pts": [[6, 5], [11, 3]], "id": "l2"}]}'::jsonb),
('4 נגד 4 עם שני שחקני צד', '4 נגד 4 בשטח של 30 על 25, עם שחקן צד אחד בכל קו אורך שמשחק תמיד עם הקבוצה שמחזיקה בכדור. נקודה על 6 מסירות ברצף. שחקני הצד מוגבלים לשתי נגיעות.', 'לנצל את היתרון המספרי 6 נגד 4. להחליף אגף דרך שחקן הצד. הקבוצה המגינה סוגרת את המרכז.', 'ssg', 3, 10, 18, 10, 10, 15, 'custom', 25, 30, array['קונוסים', 'כדורים', 'אפודות בשלושה צבעים']::text[], '{"v": 1, "elements": [{"type": "player", "x": 8, "y": 6, "team": "a", "id": "e1"}, {"type": "player", "x": 10, "y": 18, "team": "a", "id": "e2"}, {"type": "player", "x": 15, "y": 12, "team": "a", "id": "e3"}, {"type": "player", "x": 22, "y": 8, "team": "a", "id": "e4"}, {"type": "player", "x": 12, "y": 9, "team": "b", "id": "e5"}, {"type": "player", "x": 17, "y": 16, "team": "b", "id": "e6"}, {"type": "player", "x": 20, "y": 6, "team": "b", "id": "e7"}, {"type": "player", "x": 24, "y": 15, "team": "b", "id": "e8"}, {"type": "player", "x": 15, "y": 0.5, "team": "n", "label": "צד", "id": "e9"}, {"type": "player", "x": 15, "y": 24.5, "team": "n", "label": "צד", "id": "e10"}, {"type": "ball", "x": 15.6, "y": 12.5, "id": "e11"}], "lines": [{"type": "pass", "pts": [[15, 12], [15, 0.5]], "id": "l1"}, {"type": "pass", "pts": [[15, 0.5], [22, 8]], "id": "l2"}]}'::jsonb),
('מעבר מהיר אחרי חטיפה: 3 נגד 2', 'שלושה תוקפים יוצאים מקו האמצע מול שני מגינים לשער עם שוער. אחרי סיום או חטיפה, שני המגינים ועוד שחקן שנכנס מהצד תוקפים מיד שני שערים קטנים בקו האמצע. ההתקפה הראשונה מוגבלת ל-8 שניות.', 'ההחלטה הראשונה אחרי החטיפה: קדימה. התוקף עם הכדור מושך מגן אחד. אחרי איבוד: הקרוב לוחץ, האחרים חוזרים.', 'transition', 3, 11, 18, 6, 12, 15, 'custom', 30, 40, array['שער גדול', 'שערים קטנים', 'כדורים', 'אפודות']::text[], '{"v": 1, "elements": [{"type": "goal", "x": 39.5, "y": 15, "rot": 90, "id": "e1"}, {"type": "gk", "x": 37.5, "y": 15, "id": "e2"}, {"type": "minigoal", "x": 0.5, "y": 7, "rot": 90, "id": "e3"}, {"type": "minigoal", "x": 0.5, "y": 23, "rot": 90, "id": "e4"}, {"type": "player", "x": 5, "y": 8, "team": "a", "id": "e5"}, {"type": "player", "x": 5, "y": 15, "team": "a", "id": "e6"}, {"type": "player", "x": 5, "y": 22, "team": "a", "id": "e7"}, {"type": "player", "x": 25, "y": 11, "team": "b", "id": "e8"}, {"type": "player", "x": 25, "y": 19, "team": "b", "id": "e9"}, {"type": "ball", "x": 6, "y": 15, "id": "e10"}], "lines": [{"type": "dribble", "pts": [[6, 15], [18, 15]], "id": "l1"}, {"type": "run", "pts": [[5, 8], [28, 8]], "id": "l2"}, {"type": "pass", "pts": [[18, 15], [28, 8]], "id": "l3"}, {"type": "shot", "pts": [[28, 8], [39, 14]], "id": "l4"}]}'::jsonb),
('הגנה 1 נגד 1: לכוון את התוקף לקו', 'מסדרון של 16 על 8. המגן מוסר לתוקף ויוצא אליו. התוקף מנסה לעבור את הקו הנגדי בכדרור. המגן מנצח אם חוטף או מוציא את הכדור מהצד. מתחלפים תפקידים אחרי כל ניסיון.', 'סגירה מהירה ואז האטה בשני מטרים האחרונים. עמידה בצד, לא בחזית. לכוון את התוקף לרגל החלשה ולקו הצד.', 'defending', 2, 9, 18, 2, 12, 12, 'custom', 10, 16, array['קונוסים', 'כדורים']::text[], '{"v": 1, "elements": [{"type": "cone", "x": 0, "y": 1, "id": "e1"}, {"type": "cone", "x": 0, "y": 9, "id": "e2"}, {"type": "cone", "x": 16, "y": 1, "id": "e3"}, {"type": "cone", "x": 16, "y": 9, "id": "e4"}, {"type": "player", "x": 1.5, "y": 5, "team": "a", "id": "e5"}, {"type": "player", "x": 14.5, "y": 5, "team": "b", "id": "e6"}, {"type": "ball", "x": 14, "y": 5.5, "id": "e7"}], "lines": [{"type": "pass", "pts": [[14.5, 5], [1.5, 5]], "id": "l1"}, {"type": "run", "pts": [[14.5, 5], [5, 5]], "id": "l2"}, {"type": "dribble", "pts": [[1.5, 5], [8, 7], [15, 8]], "id": "l3"}]}'::jsonb),
('סיומת אחרי מסירת רוחב', 'טור מוסרים בכנף וטור חלוצים מול השער, כ-22 מטר מהשער. הכנף מכדרר לקו האורך ומוסר רוחב נמוכה. החלוץ מתחיל ריצה מאוחרת לנקודה הקרובה או הרחוקה ובועט בנגיעה אחת או שתיים. מתחלפים טורים.', 'תזמון הריצה: לא להגיע מוקדם מדי. בעיטה צמודה לקרקע לפינה הרחוקה. מסירה לחלל, לא לרגליים.', 'finishing', 2, 9, 18, 6, 14, 15, 'half', null, null, array['שער גדול', 'קונוסים', 'כדורים']::text[], '{"v": 1, "elements": [{"type": "goal", "x": 52, "y": 34, "rot": 90, "id": "e1"}, {"type": "gk", "x": 50.5, "y": 34, "id": "e2"}, {"type": "player", "x": 30, "y": 10, "team": "a", "label": "כנף", "id": "e3"}, {"type": "ball", "x": 31, "y": 10.6, "id": "e4"}, {"type": "player", "x": 30, "y": 34, "team": "a", "label": "חלוץ", "id": "e5"}, {"type": "cone", "x": 30, "y": 8, "id": "e6"}, {"type": "cone", "x": 30, "y": 32, "id": "e7"}], "lines": [{"type": "dribble", "pts": [[31, 10.6], [46, 8]], "id": "l1"}, {"type": "pass", "pts": [[46, 8], [44, 32]], "id": "l2"}, {"type": "run", "pts": [[30, 34], [43, 32]], "id": "l3"}, {"type": "shot", "pts": [[44, 32], [51.5, 36]], "id": "l4"}]}'::jsonb),
('שוער: עמידת מוצא ותגובה לבעיטות קרובות', 'מאמן או שחקן בועט מ-8 עד 10 מטר משלושה קונוסים (ימין, מרכז, שמאל). השוער חוזר לעמידת מוצא אחרי כל בעיטה וזז למרכז הקו בין הכדור לאמצע השער. 6 בעיטות לסבב, מנוחה, 3 סבבים.', 'משקל על כריות כפות הרגליים. ידיים לפני הגוף. צעד קטן לכיוון הכדור לפני הבעיטה, לא קפיצה מוקדמת.', 'goalkeeping', 2, 8, 18, 2, 4, 10, 'custom', 16, 14, array['שער גדול', 'כדורים', 'קונוסים']::text[], '{"v": 1, "elements": [{"type": "goal", "x": 13.5, "y": 8, "rot": 90, "id": "e1"}, {"type": "gk", "x": 12, "y": 8, "id": "e2"}, {"type": "cone", "x": 4, "y": 4, "id": "e3"}, {"type": "cone", "x": 3, "y": 8, "id": "e4"}, {"type": "cone", "x": 4, "y": 12, "id": "e5"}, {"type": "player", "x": 3, "y": 8, "team": "b", "label": "בועט", "id": "e6"}, {"type": "ball", "x": 3.8, "y": 8, "id": "e7"}], "lines": [{"type": "shot", "pts": [[3.8, 8], [13, 6.5]], "id": "l1"}]}'::jsonb)
) as v(title, description, coaching_points, category, difficulty, age_from, age_to, players_min, players_max, duration_min, pitch_preset, area_w_m, area_l_m, equipment, diagram)
where not exists (select 1 from public.exercises x where x.scope = 'iplays' and x.title = v.title);


insert into staging.bundle_progress (part) values (5);
select 5 as part_done, 'day3-exercises' as label;
