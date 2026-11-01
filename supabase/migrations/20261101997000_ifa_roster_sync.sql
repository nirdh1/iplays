-- iplays — IFA roster sync (stage B MVP): change detection for team rosters.
--
-- Run after 20261101996000_family_members.sql. Additive only: new columns with
-- defaults, one new table, one new function. Nothing is deleted or renamed.
-- Rollback: supabase/rollback/20261101997000_ifa_roster_sync.down.sql
-- (drops the function only; keeps the columns, the change log and every row).
--
-- Steps (kept apart, as in the spec):
--   extract   -> tools/ifa (parser on a saved page; no network)
--   validate  -> tools/ifa + again here (ids, duplicates, empty / sudden drop)
--   detect    -> sync_ifa_roster(p, false): dry run, writes only a run log row
--   apply     -> sync_ifa_roster(p, true): import_ifa_team (upsert) + statuses
--                + change log, in one transaction
--
-- Rules:
--   * a player no longer on the page is marked 'missing', never deleted; the
--     app player, parent links and anything typed by hand stay as they are;
--   * a missing player who appears again is marked 'returned' (active again);
--   * a name change is logged and updates only ifa_players.name: the name a
--     parent edited in the app (players.first_name) is not touched;
--   * an empty roster, or one that drops below half of the active roster
--     (when it has 6 or more), is refused and logged as a failed run, unless
--     the payload says "allow_large_drop": true after a human checked it.

begin;

alter table public.ifa_rosters add column if not exists status text not null default 'active';
alter table public.ifa_rosters drop constraint if exists ifa_rosters_status_check;
alter table public.ifa_rosters add constraint ifa_rosters_status_check check (status in ('active', 'missing'));
alter table public.ifa_rosters add column if not exists missing_since timestamptz;

create table if not exists public.ifa_roster_changes (
  id bigint generated always as identity primary key,
  run_id uuid references public.ifa_sync_runs (id) on delete set null,
  ifa_season_id int not null,
  ifa_team_id int not null,
  ifa_player_id bigint not null references public.ifa_players (ifa_player_id) on delete restrict,
  kind text not null check (kind in ('added', 'missing', 'returned', 'renamed')),
  old_value text,
  new_value text,
  detected_at timestamptz not null default now()
);
create index if not exists ifa_roster_changes_team_idx on public.ifa_roster_changes (ifa_season_id, ifa_team_id, detected_at desc);

alter table public.ifa_roster_changes enable row level security;
drop policy if exists ifa_roster_changes_admin on public.ifa_roster_changes;
create policy ifa_roster_changes_admin on public.ifa_roster_changes for select to authenticated using (is_platform_admin());
revoke insert, update, delete on public.ifa_roster_changes from authenticated, anon;
grant select on public.ifa_roster_changes to authenticated;

-- p = the import_ifa_team payload (+ optional "allow_large_drop": true).
create or replace function public.sync_ifa_roster(p jsonb, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season int := case when p->>'ifa_season_id' ~ '^[0-9]+$' then (p->>'ifa_season_id')::int end;
  v_ifa_team int := case when p->>'ifa_team_id' ~ '^[0-9]+$' then (p->>'ifa_team_id')::int end;
  v_players jsonb := coalesce(p->'players', '[]'::jsonb);
  v_actor uuid := coalesce(auth.uid(), (select user_id from platform_admins order by user_id limit 1));
  v_error text;
  v_active int;
  v_count int;
  v_added jsonb;
  v_missing jsonb;
  v_returned jsonb;
  v_renamed jsonb;
  v_run uuid;
  v_import jsonb;
  v_summary jsonb;
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'add a platform admin first (platform_admins)' using errcode = '22023';
  end if;

  -- validate
  if v_season is null or v_ifa_team is null or char_length(trim(coalesce(p->>'team_name', ''))) = 0 then
    v_error := 'ifa_season_id, ifa_team_id and team_name are required';
  elsif jsonb_typeof(v_players) <> 'array' or jsonb_array_length(v_players) = 0 then
    v_error := 'empty roster: refused, nothing changed';
  elsif exists (select 1 from jsonb_array_elements(v_players) e
                where coalesce(e->>'ifa_player_id', '') !~ '^[0-9]+$' or char_length(trim(coalesce(e->>'name', ''))) = 0) then
    v_error := 'a player has no numeric ifa_player_id or no name: refused, nothing changed';
  elsif (select count(*) <> count(distinct e->>'ifa_player_id') from jsonb_array_elements(v_players) e) then
    v_error := 'the same ifa_player_id appears twice: refused, nothing changed';
  end if;

  if v_error is null then
    v_count := jsonb_array_length(v_players);
    select count(*) into v_active from ifa_rosters
    where ifa_season_id = v_season and ifa_team_id = v_ifa_team and status = 'active';
    if v_active >= 6 and v_count * 2 < v_active and coalesce((p->>'allow_large_drop')::boolean, false) is not true then
      v_error := format('roster dropped from %s to %s players: refused as a possible load failure; check the page and resend with allow_large_drop', v_active, v_count);
    end if;
  end if;

  if v_error is not null then
    insert into ifa_sync_runs (kind, source, status, counts, errors, created_by)
    values ('roster', coalesce(p->>'source_url', ''), 'failed',
            jsonb_build_object('ifa_team_id', v_ifa_team, 'players_in_payload', jsonb_array_length(case when jsonb_typeof(v_players) = 'array' then v_players else '[]'::jsonb end),
                               'apply', p_apply),
            jsonb_build_array(jsonb_build_object('error', v_error)), v_actor)
    returning id into v_run;
    return jsonb_build_object('ok', false, 'run_id', v_run, 'error', v_error);
  end if;

  -- detect
  with pl as (
    select (e->>'ifa_player_id')::bigint as pid, left(trim(e->>'name'), 40) as name from jsonb_array_elements(v_players) e
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('ifa_player_id', pl.pid, 'name', pl.name)) filter (where r.ifa_player_id is null), '[]'),
    coalesce(jsonb_agg(jsonb_build_object('ifa_player_id', pl.pid, 'name', pl.name)) filter (where r.status = 'missing'), '[]'),
    coalesce(jsonb_agg(jsonb_build_object('ifa_player_id', pl.pid, 'old', ip.name, 'new', pl.name))
             filter (where ip.ifa_player_id is not null and ip.name <> pl.name), '[]')
  into v_added, v_returned, v_renamed
  from pl
  left join ifa_rosters r on r.ifa_season_id = v_season and r.ifa_team_id = v_ifa_team and r.ifa_player_id = pl.pid
  left join ifa_players ip on ip.ifa_player_id = pl.pid;

  select coalesce(jsonb_agg(jsonb_build_object('ifa_player_id', r.ifa_player_id, 'name', ip.name) order by ip.name), '[]')
  into v_missing
  from ifa_rosters r join ifa_players ip on ip.ifa_player_id = r.ifa_player_id
  where r.ifa_season_id = v_season and r.ifa_team_id = v_ifa_team and r.status = 'active'
    and not exists (select 1 from jsonb_array_elements(v_players) e where (e->>'ifa_player_id')::bigint = r.ifa_player_id);

  v_summary := jsonb_build_object('ifa_team_id', v_ifa_team, 'players_in_payload', v_count, 'active_before', v_active,
                                  'added', jsonb_array_length(v_added), 'missing', jsonb_array_length(v_missing),
                                  'returned', jsonb_array_length(v_returned), 'renamed', jsonb_array_length(v_renamed));

  if not p_apply then
    insert into ifa_sync_runs (kind, source, status, counts, created_by)
    values ('roster', coalesce(p->>'source_url', ''), 'dry_run', v_summary, v_actor)
    returning id into v_run;
    return jsonb_build_object('ok', true, 'applied', false, 'run_id', v_run, 'summary', v_summary,
                              'added', v_added, 'missing', v_missing, 'returned', v_returned, 'renamed', v_renamed);
  end if;

  -- apply (same transaction: all or nothing)
  v_import := import_ifa_team(p - 'allow_large_drop');
  v_run := (v_import->>'run_id')::uuid;

  update ifa_rosters set status = 'active', missing_since = null
  where ifa_season_id = v_season and ifa_team_id = v_ifa_team
    and ifa_player_id in (select (e->>'ifa_player_id')::bigint from jsonb_array_elements(v_players) e);
  update ifa_rosters r set status = 'missing', missing_since = now()
  where r.ifa_season_id = v_season and r.ifa_team_id = v_ifa_team
    and r.ifa_player_id in (select (m->>'ifa_player_id')::bigint from jsonb_array_elements(v_missing) m);

  insert into ifa_roster_changes (run_id, ifa_season_id, ifa_team_id, ifa_player_id, kind, old_value, new_value)
  select v_run, v_season, v_ifa_team, (x->>'ifa_player_id')::bigint, 'added', null, x->>'name' from jsonb_array_elements(v_added) x
  union all
  select v_run, v_season, v_ifa_team, (x->>'ifa_player_id')::bigint, 'missing', x->>'name', null from jsonb_array_elements(v_missing) x
  union all
  select v_run, v_season, v_ifa_team, (x->>'ifa_player_id')::bigint, 'returned', null, x->>'name' from jsonb_array_elements(v_returned) x
  union all
  select v_run, v_season, v_ifa_team, (x->>'ifa_player_id')::bigint, 'renamed', x->>'old', x->>'new' from jsonb_array_elements(v_renamed) x;

  update ifa_sync_runs
  set kind = 'roster',
      status = case when jsonb_array_length(errors) > 0 then 'partial' else 'ok' end,
      counts = counts || v_summary
  where id = v_run;

  return jsonb_build_object('ok', true, 'applied', true, 'run_id', v_run, 'team_id', v_import->'team_id', 'summary', v_summary,
                            'added', v_added, 'missing', v_missing, 'returned', v_returned, 'renamed', v_renamed,
                            'errors', v_import->'errors');
end;
$$;

-- the admin overview counts only players still on the page
create or replace function public.ifa_sync_overview()
returns table (ifa_season_id int, ifa_team_id int, name text, team_id uuid, players int, synced_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.ifa_season_id, t.ifa_team_id, t.name, t.team_id,
         (select count(*)::int from ifa_rosters r where r.ifa_season_id = t.ifa_season_id and r.ifa_team_id = t.ifa_team_id and r.status = 'active'),
         t.synced_at
  from ifa_teams t
  where is_platform_admin()
  order by t.synced_at desc;
$$;

revoke all on function public.sync_ifa_roster(jsonb, boolean) from public, anon;
grant execute on function public.sync_ifa_roster(jsonb, boolean) to authenticated;

commit;
