-- Rollback of 20261102720000_smarter_search.sql. Only functions; no data.
-- find_teams and the helpers are dropped; find_players goes back to the
-- 20261102710000 version. search_teams was never changed.
begin;
drop function if exists public.find_teams(text, int, text);
create or replace function public.find_players(p_query text, p_birth_year int default null)
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  birth_year_est int, age_group text,
  team_id uuid, team_name text, club_id uuid, club_name text, program_kind text,
  from_ifa boolean, name_hidden boolean, same_name int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g');
  v_words text[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  -- LIKE wildcards in the query are plain characters
  v_words := string_to_array(replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_'), ' ');

  return query
  with hits as (
    select p.id as pid, p.first_name as fn, p.last_name as ln, p.birth_year as by_exact,
           trim(p.first_name || ' ' || p.last_name) as full_name,
           t.id as tid, t.name as tname, c.id as cid, coalesce(c.name, nullif(t.club, '')) as cname, cp.kind as pkind,
           exists (select 1 from ifa_players i where i.player_id = p.id) as is_ifa,
           (is_unclaimed_import(p.id) and not (is_team_member(t.id) or can(t.id, 'roster', 1))) as hide,
           ag.age_group as agrp,
           ifa_estimated_birth_year(ag.age_group, it.ifa_season_id) as by_est
    from players p
    join player_assignments a on a.player_id = p.id and a.ended_on is null
    join teams t on t.id = a.team_id and t.archived_at is null
    left join clubs c on c.id = t.club_id and c.status <> 'suspended'
    left join club_programs cp on cp.id = t.program_id
    left join ifa_teams it on it.team_id = t.id
    left join ifa_leagues il on il.ifa_season_id = it.ifa_season_id and il.ifa_league_id = it.ifa_league_id
    left join lateral (
      select coalesce(ifa_age_group(nullif(it.age_category, '')), ifa_age_group(il.name)) as age_group
    ) ag on true
    where p.archived_at is null
      and not exists (
        select 1 from unnest(v_words) w
        where trim(p.first_name || ' ' || p.last_name) not ilike '%' || w || '%'
      )
  ), shown as (
    select h.*,
           case when h.hide then split_part(h.full_name, ' ', 1) else h.fn end as show_first,
           case when h.hide then coalesce(left(nullif(split_part(h.full_name, ' ', 2), ''), 1) || '׳', '') else h.ln end as show_last
    from hits h
    where p_birth_year is null or coalesce(h.by_exact, h.by_est) = p_birth_year
  )
  select s.pid, s.show_first, s.show_last, s.by_exact,
         case when s.by_exact is null then s.by_est end, s.agrp,
         s.tid, s.tname, s.cid, s.cname, s.pkind,
         s.is_ifa, s.hide,
         (count(*) over (partition by lower(trim(s.show_first || ' ' || s.show_last))))::int
  from shown s
  order by (lower(s.full_name) = lower(v_q)) desc,   -- exact name first
           (s.full_name ilike v_words[1] || '%') desc, -- then names that start with it
           s.show_first, s.show_last, coalesce(s.by_exact, s.by_est), s.tname
  limit 50;
end;
$$;

drop function if exists public.search_year(text);
drop function if exists public.search_words(text);
drop function if exists public.search_norm(text);
commit;
