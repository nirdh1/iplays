-- iplays — find a player by name (owner request 2026-11-02).
--
-- Run after 20261101800000_ifa_import.sql (and 20261101900000_ifa_games_sync.sql,
-- which adds ifa_teams.age_category). Additive: one new search function and two
-- small helpers. search_players() and every table stay as they are.
-- Rollback: supabase/rollback/20261102710000_find_players_by_name.down.sql
--
-- What is new compared with search_players():
--   * players imported from the IFA catalog appear too, also before a parent
--     claimed them. The privacy rule for such minors is kept: someone who is
--     not a member / staff of the child's team sees only the first name and
--     the initial of the last name (same rule as team_roster_public()).
--     Nothing else about the child is shown (no IFA profile link, no photo).
--   * every hit carries the team, the club and a birth year:
--       - birth_year     — the exact year, only when a parent / coach entered it;
--       - birth_year_est — otherwise an estimate from the IFA league's age group
--                          ("נערים ג׳" in season 2026/27 -> 2012), labelled
--                          "משוער" in the app;
--       - age_group      — the age group itself ("נערים ג׳").
--   * same_name tells how many hits show the same name, so the app can point
--     out that the team and birth year tell them apart. Two IFA players with
--     the same name are always two rows: each has its own IFA id and its own
--     player record.
--   * the words of the query may come in any order ("לוי נועם" finds "נועם לוי").
--   * the birth-year filter also matches the estimated year.
--
-- Uses only data already in the database; nothing is fetched from the IFA site.

begin;

-- The age group a league / category name states, e.g.
-- "2026/2027 ליגת ילדים טרום ב' דן" -> "טרום ב׳", "נערים ג' מחוז מרכז" -> "נערים ג׳".
-- "טרום" first: in "ילדים טרום ב'" the age group is "טרום ב׳". Girls' leagues
-- (ילדות / נערות) and "נוער" get no single year and return the name only.
create or replace function public.ifa_age_group(p_name text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    (regexp_match(coalesce(p_name, ''), '(טרום) ([אבג])(?:[''׳`"]|\s|$)'))[1] || ' ' ||
    (regexp_match(coalesce(p_name, ''), '(טרום) ([אבג])(?:[''׳`"]|\s|$)'))[2] || '׳',
    (regexp_match(coalesce(p_name, ''), '(ילדים|נערים) ([אבג])(?:[''׳`"]|\s|$)'))[1] || ' ' ||
    (regexp_match(coalesce(p_name, ''), '(ילדים|נערים) ([אבג])(?:[''׳`"]|\s|$)'))[2] || '׳',
    case when coalesce(p_name, '') ~ '(^|\s)נוער(\s|$)' then 'נוער' end
  );
$$;

-- Estimated birth year for an age group in an IFA season. IFA season ids run
-- one per year: 28 = 2026/27, so the season starts in 1998 + id. Age at the
-- start year: נערים א 16 … טרום ג 8 (2026/27: נערים א 2010 … טרום ג 2018).
-- "נוער" spans two years and returns null.
create or replace function public.ifa_estimated_birth_year(p_age_group text, p_ifa_season int)
returns int language sql immutable set search_path = public as $$
  select case when p_ifa_season is null then null else
    1998 + p_ifa_season - case p_age_group
      when 'נערים א׳' then 16 when 'נערים ב׳' then 15 when 'נערים ג׳' then 14
      when 'ילדים א׳' then 13 when 'ילדים ב׳' then 12 when 'ילדים ג׳' then 11
      when 'טרום א׳' then 10 when 'טרום ב׳' then 9 when 'טרום ג׳' then 8
    end
  end;
$$;

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

revoke all on function public.find_players(text, int) from public, anon;
grant execute on function public.find_players(text, int) to authenticated;
grant execute on function public.ifa_age_group(text), public.ifa_estimated_birth_year(text, int) to authenticated;

commit;
