-- iPlays 2.0 PRODUCTION part 5 of 6: exercise-video
-- Run ONLY in the Production SQL editor, ONLY after: backup PASSED + your approval of this part.
-- Additive. Rollback files: supabase/rollback/<same name>.down.sql
-- Built from: 20261106600000_exercise_video_link.sql
do $guard$ begin
  if to_regnamespace('staging') is not null then raise exception 'ABORT: this is the Staging database. Use the staging parts there.'; end if;
  if to_regclass('public.ifa_players') is null or (select count(*) from public.ifa_players) < 1000 then raise exception 'ABORT: this does not look like iPlays Production.'; end if;
  if not (to_regclass('public.exercise_topics') is not null) then raise exception 'ABORT: part 5 needs part 4 to run first. Nothing changed.'; end if;
  if (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exercises' and column_name = 'video_url')) then raise exception 'ABORT: part 5 already ran here. Nothing changed.'; end if;
end $guard$;

-- ===== 20261106600000_exercise_video_link.sql
-- iPlays 2.0 MVP: an optional video link per exercise (YouTube, Vimeo or
-- Google Drive). Only a link: iPlays stores no video. The app embeds YouTube
-- with youtube-nocookie and opens other links in a new tab.
-- A copy keeps the source's link. set_exercise_video() edits it with the same
-- rights as editing the exercise; the iPlays base library is never edited from
-- the app.
--
-- Additive only. Idempotent.
-- Rollback: supabase/rollback/20261106600000_exercise_video_link.down.sql

alter table public.exercises add column if not exists video_url text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'exercises_video_url_check') then
    alter table public.exercises add constraint exercises_video_url_check check (
      video_url is null or (char_length(video_url) <= 300
        and video_url ~ '^https://(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com)/[^[:space:]<>"]+$'));
  end if;
end $$;

-- Same trigger function as 20261106500000, plus: a copy keeps the video link.
create or replace function public.exercises_topics_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.copied_from is not null then
    if coalesce(cardinality(new.topics), 0) = 0 then
      select x.topics into new.topics from exercises x where x.id = new.copied_from;
    end if;
    if new.video_url is null then
      select x.video_url into new.video_url from exercises x where x.id = new.copied_from;
    end if;
  end if;
  new.topics := coalesce(array(select distinct t from unnest(coalesce(new.topics, '{}')) t
                               where t in (select code from exercise_topics) order by t), '{}');
  if cardinality(new.topics) > 6 then raise exception 'too many topics'; end if;
  return new;
end $$;

create or replace function public.set_exercise_video(p_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare v exercises; v_url text := nullif(trim(coalesce(p_url, '')), '');
begin
  select * into v from exercises where id = p_id;
  if not found or not can_write_exercise(v.scope, v.owner_id, v.club_id) then raise exception 'not allowed'; end if;
  update exercises set video_url = v_url, updated_at = now() where id = p_id;
end $$;
revoke all on function public.set_exercise_video(uuid, text) from public, anon;
grant execute on function public.set_exercise_video(uuid, text) to authenticated;

select 5 as part_done, 'exercise-video' as label;
