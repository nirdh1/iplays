-- Rollback of 20261106200000_exercise_library.sql (drops the library and its content).
drop function if exists public.my_exercise_clubs();
drop function if exists public.archive_exercise(uuid, boolean);
drop function if exists public.copy_exercise(uuid, text, uuid);
drop function if exists public.save_exercise(uuid, text, uuid, jsonb);
drop table if exists public.exercises;
drop table if exists public.exercise_categories;
drop function if exists public.can_write_exercise(text, uuid, uuid);
drop function if exists public.can_read_exercise(text, uuid, uuid);
drop function if exists public.is_club_staff_member(uuid);
drop function if exists public.is_any_staff();
