-- iplays — league table from a screenshot ("טבלה מצילום מסך").
--
-- Run after 20261102400000_league_table.sql (needs ifa_teams / ifa_games and
-- the existing team_league_table). Additive only: one new table and three
-- functions. Nothing existing is changed; the table computed from the IFA
-- results (league_table / team_league_table) stays exactly as it is.
-- Rollback: supabase/rollback/20261103800000_league_table_snapshots.down.sql
--
-- What it is
--   A member of a team (a parent too) uploads a screenshot / PDF of the league
--   table. The app reads it in the browser (free OCR), the user reviews every
--   row and saves it here as a snapshot. The app shows the latest snapshot
--   next to the computed table, clearly marked "from a screenshot", with the
--   rows that differ; when the team has no computed table it shows the
--   snapshot alone, still marked.
--
-- Who
--   * save: any member of the team (is_team_member) or a platform admin.
--   * read: members of the team, and members of other app teams linked to the
--     same IFA league (a league table is public information). The uploader's
--     name is shown only inside the team that uploaded it.
--   * delete (hide): the uploader, staff of that team, or a platform admin.
--     Rows are kept (deleted_at), never removed.
--
-- The roster from a screenshot needs no SQL: it uses the existing add-player
-- and end_player_assignment (history kept).

begin;

create table if not exists public.league_table_snapshots (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  ifa_season_id int,
  ifa_league_id int,
  league_name text not null default '',
  taken_on date not null default current_date,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null
);
create index if not exists league_table_snapshots_team_idx on public.league_table_snapshots (team_id, created_at desc) where deleted_at is null;
create index if not exists league_table_snapshots_league_idx on public.league_table_snapshots (ifa_season_id, ifa_league_id, created_at desc) where deleted_at is null;

-- only through the functions below
alter table public.league_table_snapshots enable row level security;
revoke all on public.league_table_snapshots from anon, authenticated;

-- The IFA league of an app team: the same rule as team_league_table.
create or replace function public.team_ifa_league(p_team uuid)
returns table (ifa_season_id int, ifa_league_id int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_season int;
  v_ifa_team int;
  v_league int;
begin
  select it.ifa_season_id, it.ifa_team_id, it.ifa_league_id into v_season, v_ifa_team, v_league
  from ifa_teams it where it.team_id = p_team order by it.ifa_season_id desc limit 1;
  if v_season is null then
    return;
  end if;
  if v_league is null then
    select g.ifa_league_id into v_league
    from ifa_games g
    where g.ifa_season_id = v_season and g.ifa_league_id is not null
      and v_ifa_team in (g.home_ifa_team_id, g.away_ifa_team_id)
    group by g.ifa_league_id order by count(*) desc limit 1;
  end if;
  if v_league is null then
    return;
  end if;
  ifa_season_id := v_season;
  ifa_league_id := v_league;
  return next;
end;
$$;

-- p_rows: [{pos, name, played, won, drawn, lost, goals_for, goals_against, points}]
create or replace function public.save_league_snapshot(p_team uuid, p_rows jsonb, p_taken_on date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
  v_season int;
  v_league int;
  v_name text := '';
  v_id uuid;
  v_n int;
begin
  if auth.uid() is null or not (is_team_member(p_team) or is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows must be a list' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n < 2 or v_n > 40 then
    raise exception 'a league table has 2 to 40 rows' using errcode = '22023';
  end if;
  if p_taken_on is null or p_taken_on > current_date + 1 or p_taken_on < current_date - 400 then
    raise exception 'bad date' using errcode = '22023';
  end if;

  -- keep only known fields; numbers 0..999 (or null), names up to 60 letters
  select jsonb_agg(jsonb_build_object(
           'pos', least(greatest(coalesce(case when r->>'pos' ~ '^\d{1,3}$' then (r->>'pos')::int end, ord::int), 1), 99),
           'name', left(btrim(coalesce(r->>'name', '')), 60),
           'played', case when r->>'played' ~ '^\d{1,3}$' then (r->>'played')::int end,
           'won', case when r->>'won' ~ '^\d{1,3}$' then (r->>'won')::int end,
           'drawn', case when r->>'drawn' ~ '^\d{1,3}$' then (r->>'drawn')::int end,
           'lost', case when r->>'lost' ~ '^\d{1,3}$' then (r->>'lost')::int end,
           'goals_for', case when r->>'goals_for' ~ '^\d{1,3}$' then (r->>'goals_for')::int end,
           'goals_against', case when r->>'goals_against' ~ '^\d{1,3}$' then (r->>'goals_against')::int end,
           'points', case when r->>'points' ~ '^-?\d{1,3}$' then (r->>'points')::int end)
         order by ord)
    into v_rows
  from jsonb_array_elements(p_rows) with ordinality as e(r, ord)
  where btrim(coalesce(r->>'name', '')) <> '';
  if coalesce(jsonb_array_length(v_rows), 0) < 2 then
    raise exception 'each row needs a team name' using errcode = '22023';
  end if;

  select l.ifa_season_id, l.ifa_league_id into v_season, v_league from team_ifa_league(p_team) l;
  if v_league is not null then
    select coalesce(name, '') into v_name from ifa_leagues where ifa_season_id = v_season and ifa_league_id = v_league;
  end if;

  insert into league_table_snapshots (team_id, ifa_season_id, ifa_league_id, league_name, taken_on, rows, uploaded_by)
  values (p_team, v_season, v_league, coalesce(v_name, ''), p_taken_on, v_rows, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- The latest snapshot for the team: its own, or one of another app team in the
-- same IFA league, whichever is newer. Null when there is none.
create or replace function public.team_league_snapshot(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_season int;
  v_league int;
  s league_table_snapshots;
begin
  if auth.uid() is null or not (is_team_member(p_team) or is_platform_admin()) then
    return null;
  end if;
  select l.ifa_season_id, l.ifa_league_id into v_season, v_league from team_ifa_league(p_team) l;
  select * into s from league_table_snapshots x
  where x.deleted_at is null
    and (x.team_id = p_team or (v_league is not null and x.ifa_season_id = v_season and x.ifa_league_id = v_league))
  order by x.taken_on desc, x.created_at desc
  limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', s.id,
    'team_id', s.team_id,
    'taken_on', s.taken_on,
    'created_at', s.created_at,
    'league_name', s.league_name,
    'same_team', s.team_id = p_team,
    'from_team_name', (select name from teams where id = s.team_id),
    'uploaded_by_name', case when s.team_id = p_team then (select full_name from profiles where id = s.uploaded_by) end,
    'can_delete', s.uploaded_by = auth.uid() or is_team_staff(s.team_id) or is_platform_admin(),
    'rows', s.rows);
end;
$$;

create or replace function public.delete_league_snapshot(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s league_table_snapshots;
begin
  select * into s from league_table_snapshots where id = p_id for update;
  if not found or s.deleted_at is not null then
    return;
  end if;
  if auth.uid() is null or not (s.uploaded_by = auth.uid() or is_team_staff(s.team_id) or is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update league_table_snapshots set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
end;
$$;

revoke all on function public.team_ifa_league(uuid), public.save_league_snapshot(uuid, jsonb, date),
  public.team_league_snapshot(uuid), public.delete_league_snapshot(uuid) from public, anon;
grant execute on function public.save_league_snapshot(uuid, jsonb, date), public.team_league_snapshot(uuid),
  public.delete_league_snapshot(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
