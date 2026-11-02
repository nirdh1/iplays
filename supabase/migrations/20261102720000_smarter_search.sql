-- iplays — smarter team and player search (owner report 2026-11-02:
-- "מכבי תל אביב" and "מכבי תל אביב 2010" did not find מכבי תל אביב עודד, נערים א׳).
--
-- Run after 20261102710000_find_players_by_name.sql. Additive: a new
-- find_teams() next to search_teams() (kept as is), find_players() replaced
-- with the same columns, and one helper. No table or row changes.
-- Rollback: supabase/rollback/20261102720000_smarter_search.down.sql
--
-- Why it was missed: search_teams() matched the whole query as one piece of
-- text and returned only the first 40 teams in alphabetical order. A club
-- with teams in every age group fills those 40 before reaching "נערים", and
-- "2010" inside the query had to be part of the team name. Now:
--   * every word of the query must appear (any order), in the team name, the
--     name on the IFA page, the club, the city, the age group or the league;
--   * a year in the query ("מכבי תל אביב 2010") is a birth-year filter, and
--     a team's birth year is estimated from its IFA age group when no exact
--     year was set (2026/27: נערים א׳ 2010, ב׳ 2011, ג׳ 2012, ילדים א׳ 2013 …);
--   * common abbreviations equal the full name, on both sides: ת"א = תל אביב,
--     ר"ג = רמת גן, פ"ת = פתח תקווה, ב"ש = באר שבע, כ"ס = כפר סבא (and a few more);
--   * best matches first (exact phrase, then the rest), up to 80 results;
--   * each hit carries the age group and the estimated birth year.

begin;

-- Text made comparable: one kind of quote mark, abbreviations written out,
-- one spelling of תקווה, single spaces, lower case.
create or replace function public.search_norm(p text)
returns text language sql immutable set search_path = public as $$
  select lower(trim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(
      replace(replace(replace(replace(replace(coalesce(p, ''), '״', '"'), '''''', '"'), '׳', ''''), '“', '"'), '”', '"'),
      'ת"א', 'תל אביב', 'g'),
      'ר"ג', 'רמת גן', 'g'),
      'פ"ת', 'פתח תקווה', 'g'),
      'ב"ש', 'באר שבע', 'g'),
      'כ"ס', 'כפר סבא', 'g'),
      'ראשל"צ', 'ראשון לציון', 'g'),
      'ק"ג', 'קרית גת', 'g'),
      'ק"ש', 'קרית שמונה', 'g'),
      'נ"צ', 'נס ציונה', 'g'),
      'ר"ה', 'רמת השרון', 'g'),
      'תקוה', 'תקווה', 'g'),
      'קריית', 'קרית', 'g'),
    '\s+', ' ', 'g')));
$$;

-- Query words for LIKE (wildcards escaped), without a 4-digit year.
create or replace function public.search_words(p text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_')), '{}')
  from unnest(string_to_array(search_norm(p), ' ')) w
  where w <> '' and w !~ '^(19|20)[0-9]{2}$';
$$;

-- The 4-digit year written in the query, if any.
create or replace function public.search_year(p text)
returns int language sql immutable set search_path = public as $$
  select (regexp_match(coalesce(p, ''), '(?:^|\s)((?:19|20)[0-9]{2})(?:\s|$)'))[1]::int;
$$;

-- --------------------------------------------------------------- teams

create or replace function public.find_teams(p_query text default '', p_birth_year int default null, p_sport text default null)
returns table (
  team_id uuid, name text, club_id uuid, club_name text, city text, program_kind text, sport text, season text,
  age_group text, birth_year_from int, birth_year_to int, birth_year_est int,
  players int, has_staff boolean, is_member boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_words text[] := search_words(p_query);
  v_year int := coalesce(p_birth_year, search_year(p_query));
  v_phrase text := array_to_string(search_words(p_query), ' ');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_phrase) < 2 and v_year is null then
    return;
  end if;
  return query
  with base as (
    select t.id as tid, t.name as tname, c.id as cid, coalesce(c.name, nullif(t.club, '')) as cname, c.city as ccity,
           cp.kind as pkind, t.sport as tsport, t.season as tseason,
           t.birth_year_from as yfrom, t.birth_year_to as yto, c.status as cstatus,
           it.name as ifa_name, il.name as league_name, t.club as tclub,
           coalesce(ifa_age_group(nullif(it.age_category, '')), ifa_age_group(il.name),
                    ifa_age_group(t.age_group), nullif(t.age_group, '')) as agrp,
           coalesce(it.ifa_season_id, (substring(t.season from '^(20[0-9]{2})'))::int - 1998) as season_id
    from teams t
    left join clubs c on c.id = t.club_id
    left join club_programs cp on cp.id = t.program_id
    left join ifa_teams it on it.team_id = t.id
    left join ifa_leagues il on il.ifa_season_id = it.ifa_season_id and il.ifa_league_id = it.ifa_league_id
    where t.archived_at is null
      and (c.id is null or (c.status <> 'suspended' and c.archived_at is null))
      and (p_sport is null or t.sport = p_sport)
  ), hits as (
    select b.*, ifa_estimated_birth_year(b.agrp, b.season_id) as yest,
           search_norm(concat_ws(' ', b.tname, b.ifa_name, b.tclub, b.cname, b.ccity, b.agrp, b.league_name)) as hay
    from base b
  )
  select h.tid, h.tname, h.cid, h.cname, h.ccity, h.pkind, h.tsport, h.tseason,
         coalesce(h.agrp, ''), h.yfrom, h.yto, case when h.yfrom is null then h.yest end,
         (select count(*)::int from player_assignments a where a.team_id = h.tid and a.ended_on is null),
         team_has_staff(h.tid), is_team_member(h.tid)
  from hits h
  where not exists (select 1 from unnest(v_words) w where h.hay not like '%' || w || '%')
    and (v_year is null
         or (h.yfrom is not null and v_year between h.yfrom and coalesce(h.yto, h.yfrom))
         or (h.yfrom is null and h.yest = v_year)
         or exists (select 1 from player_assignments a join players p on p.id = a.player_id
                    where a.team_id = h.tid and a.ended_on is null and p.birth_year = v_year))
  order by (v_phrase <> '' and search_norm(concat_ws(' ', h.tname, h.ifa_name)) like '%' || v_phrase || '%') desc,  -- the whole phrase in the team name
           is_team_member(h.tid) desc,
           (h.cstatus = 'verified') desc nulls last,
           coalesce(h.yfrom, h.yest) desc nulls last,   -- youngest first, as a parent picks by birth year
           h.tname
  limit 80;
end;
$$;

-- --------------------------------------------------------------- players
-- Same columns as before. New: abbreviations, a year in the query as a
-- birth-year filter, and words may also name the team ("דניאל מכבי") as long
-- as at least one word is in the player's name.

create or replace function public.find_players(p_query text, p_birth_year int default null)
returns table (
  player_id uuid, first_name text, last_name text, birth_year int,
  birth_year_est int, age_group text,
  team_id uuid, team_name text, club_id uuid, club_name text, program_kind text,
  from_ifa boolean, name_hidden boolean, same_name int
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_words text[] := search_words(p_query);
  v_year int := coalesce(p_birth_year, search_year(p_query));
  v_phrase text := array_to_string(search_words(p_query), ' ');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_phrase) < 2 then
    return;
  end if;

  return query
  with hits as (
    select p.id as pid, p.first_name as fn, p.last_name as ln, p.birth_year as by_exact,
           trim(p.first_name || ' ' || p.last_name) as full_name,
           search_norm(p.first_name || ' ' || p.last_name) as name_n,
           t.id as tid, t.name as tname, c.id as cid, coalesce(c.name, nullif(t.club, '')) as cname, cp.kind as pkind,
           exists (select 1 from ifa_players i where i.player_id = p.id) as is_ifa,
           (is_unclaimed_import(p.id) and not (is_team_member(t.id) or can(t.id, 'roster', 1))) as hide,
           ag.age_group as agrp,
           ifa_estimated_birth_year(ag.age_group, coalesce(it.ifa_season_id, (substring(t.season from '^(20[0-9]{2})'))::int - 1998)) as by_est,
           search_norm(concat_ws(' ', p.first_name, p.last_name, t.name, c.name, t.club)) as hay
    from players p
    join player_assignments a on a.player_id = p.id and a.ended_on is null
    join teams t on t.id = a.team_id and t.archived_at is null
    left join clubs c on c.id = t.club_id and c.status <> 'suspended'
    left join club_programs cp on cp.id = t.program_id
    left join ifa_teams it on it.team_id = t.id
    left join ifa_leagues il on il.ifa_season_id = it.ifa_season_id and il.ifa_league_id = it.ifa_league_id
    left join lateral (
      select coalesce(ifa_age_group(nullif(it.age_category, '')), ifa_age_group(il.name), ifa_age_group(t.age_group)) as age_group
    ) ag on true
    where p.archived_at is null
  ), matched as (
    select h.* from hits h
    where not exists (select 1 from unnest(v_words) w where h.hay not like '%' || w || '%')
      and exists (select 1 from unnest(v_words) w where h.name_n like '%' || w || '%')
  ), shown as (
    select m.*,
           case when m.hide then split_part(m.full_name, ' ', 1) else m.fn end as show_first,
           case when m.hide then coalesce(left(nullif(split_part(m.full_name, ' ', 2), ''), 1) || '׳', '') else m.ln end as show_last
    from matched m
    where v_year is null or coalesce(m.by_exact, m.by_est) = v_year
  )
  select s.pid, s.show_first, s.show_last, s.by_exact,
         case when s.by_exact is null then s.by_est end, s.agrp,
         s.tid, s.tname, s.cid, s.cname, s.pkind,
         s.is_ifa, s.hide,
         (count(*) over (partition by lower(trim(s.show_first || ' ' || s.show_last))))::int
  from shown s
  order by (s.name_n = v_phrase) desc,                 -- exact name first
           (s.name_n like v_words[1] || '%') desc,     -- then names that start with it
           s.show_first, s.show_last, coalesce(s.by_exact, s.by_est), s.tname
  limit 50;
end;
$$;

revoke all on function public.find_teams(text, int, text) from public, anon;
grant execute on function public.find_teams(text, int, text), public.find_players(text, int) to authenticated;
grant execute on function public.search_norm(text), public.search_words(text), public.search_year(text) to authenticated;

commit;
