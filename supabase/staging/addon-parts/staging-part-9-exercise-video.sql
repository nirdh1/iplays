-- iPlays STAGING, add-on part 9 (exercise-video). NEVER run on Production.
-- Run in the SQL Editor of the Staging project, after part 8.
do $$
begin
  if to_regclass('staging.bundle_progress') is null then
    raise exception 'ABORT: this database is not a Staging project in progress (run parts 1-8 first).';
  end if;
  if not exists (select 1 from staging.bundle_progress where part = 8) then
    raise exception 'ABORT: run part 8 first.';
  end if;
  if exists (select 1 from staging.bundle_progress where part = 9) then
    raise exception 'ABORT: part 9 already ran here.';
  end if;
end $$;

-- ==== 20261106600000_exercise_video_link.sql ====
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


insert into staging.bundle_progress (part) values (9);
select 9 as part_done, 'exercise-video' as label;
