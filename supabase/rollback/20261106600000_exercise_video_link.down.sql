-- Rollback of 20261106600000_exercise_video_link.sql (removes saved links). Run only with a separate approval.
drop function if exists public.set_exercise_video(uuid, text);
create or replace function public.exercises_topics_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.copied_from is not null and coalesce(cardinality(new.topics), 0) = 0 then
    select x.topics into new.topics from exercises x where x.id = new.copied_from;
  end if;
  new.topics := coalesce(array(select distinct t from unnest(coalesce(new.topics, '{}')) t
                               where t in (select code from exercise_topics) order by t), '{}');
  if cardinality(new.topics) > 6 then raise exception 'too many topics'; end if;
  return new;
end $$;
alter table public.exercises drop constraint if exists exercises_video_url_check;
alter table public.exercises drop column if exists video_url;
