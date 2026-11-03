-- iplays — a child's numbers from their IFA player page, loaded from a file.
--
-- Run after 20261103100000_schedule_import.sql. Additive only: one table and
-- three functions. Rollback: supabase/rollback/20261103200000_player_ifa_stats.down.sql
-- (drops the functions, keeps the table and every row).
--
-- Owner's decisions (2026-11-02):
--   * the career page links to the child's player page on football.org.il
--     (or the team page when the child is not linked to an IFA player);
--   * the parent saves a screenshot or PDF of that page and uploads it; the app
--     reads it in the browser for free (no AI), the parent checks the numbers,
--     and they are saved per season;
--   * these numbers are shown NEXT TO the self-reported goals and assists
--     (player_self_stats), never added to or replacing them, marked
--     "לפי ההתאחדות (מקובץ)" with the upload date.
--
-- Nothing is fetched from the IFA site; only what the family uploads.
-- Who may save: the child's parent, or a platform admin. Who sees: the same
-- people who see the child's metrics (can_view_player_metrics).

begin;

create table if not exists public.player_ifa_stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  season text not null check (season ~ '^\d{4}/\d{2}$'),
  team_name text not null default '' check (char_length(team_name) <= 80),
  games int check (games between 0 and 200),
  starts int check (starts between 0 and 200),
  minutes int check (minutes between 0 and 20000),
  goals int check (goals between 0 and 300),
  assists int check (assists between 0 and 300),
  yellow int check (yellow between 0 and 100),
  red int check (red between 0 and 50),
  source_file text not null default '' check (char_length(source_file) <= 200),
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create unique index if not exists player_ifa_stats_one_per_season on public.player_ifa_stats (player_id, season, team_name);

alter table public.player_ifa_stats enable row level security;
drop policy if exists player_ifa_stats_read on public.player_ifa_stats;
create policy player_ifa_stats_read on public.player_ifa_stats for select to authenticated
  using (can_view_player_metrics(player_id));
revoke insert, update, delete on public.player_ifa_stats from authenticated, anon;
grant select on public.player_ifa_stats to authenticated;

-- Where to see the child on the IFA site: their player page if the roster
-- import linked them, and the page of their current team.
create or replace function public.player_ifa_links(p_player uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_player text;
  v_team text;
begin
  if not can_view_player_metrics(p_player) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select nullif(profile_url, '') into v_player from ifa_players where player_id = p_player;
  select format('https://www.football.org.il/team-details/?team_id=%s&season_id=%s', it.ifa_team_id, it.ifa_season_id)
    into v_team
  from player_assignments a join ifa_teams it on it.team_id = a.team_id
  where a.player_id = p_player and a.ended_on is null
  order by it.ifa_season_id desc
  limit 1;
  return jsonb_build_object('player_url', v_player, 'team_url', v_team,
                            'can_edit', is_player_parent(p_player) or is_platform_admin());
end;
$$;

-- Save one season's numbers (the file is read in the app; the parent checked them).
-- p_stats: {games, starts, minutes, goals, assists, yellow, red} (each optional)
create or replace function public.save_ifa_stats(p_player uuid, p_season text, p_team text, p_stats jsonb, p_file text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  n jsonb := coalesce(p_stats, '{}'::jsonb);
  f text;
begin
  if auth.uid() is null or not (is_player_parent(p_player) or is_platform_admin()) then
    raise exception 'only the child''s parent can load IFA numbers' using errcode = '42501';
  end if;
  if p_season is null or p_season !~ '^\d{4}/\d{2}$' then
    raise exception 'season must look like 2026/27' using errcode = '22023';
  end if;
  foreach f in array array['games', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red'] loop
    if n ? f and jsonb_typeof(n->f) not in ('number', 'null') then
      raise exception '% must be a number', f using errcode = '22023';
    end if;
  end loop;

  insert into player_ifa_stats (player_id, season, team_name, games, starts, minutes, goals, assists, yellow, red, source_file)
  values (p_player, p_season, left(btrim(coalesce(p_team, '')), 80),
          (n->>'games')::int, (n->>'starts')::int, (n->>'minutes')::int, (n->>'goals')::int,
          (n->>'assists')::int, (n->>'yellow')::int, (n->>'red')::int, left(coalesce(p_file, ''), 200))
  on conflict (player_id, season, team_name) do update set
    games = excluded.games, starts = excluded.starts, minutes = excluded.minutes, goals = excluded.goals,
    assists = excluded.assists, yellow = excluded.yellow, red = excluded.red,
    source_file = excluded.source_file, uploaded_by = auth.uid(), uploaded_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_ifa_stats(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
begin
  select player_id into v_player from player_ifa_stats where id = p_id;
  if v_player is null then return; end if;
  if not (is_player_parent(v_player) or is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from player_ifa_stats where id = p_id;
end;
$$;

revoke all on function public.player_ifa_links(uuid), public.save_ifa_stats(uuid, text, text, jsonb, text), public.remove_ifa_stats(uuid) from public, anon;
grant execute on function public.player_ifa_links(uuid), public.save_ifa_stats(uuid, text, text, jsonb, text), public.remove_ifa_stats(uuid) to authenticated;

commit;
