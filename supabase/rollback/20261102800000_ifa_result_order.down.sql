-- Rollback of 20261102800000_ifa_result_order.sql: puts back the previous
-- import_ifa_games (scores as the client sent them) and drops the two helpers.
-- The corrected scores in ifa_games stay as they are: they match the IFA.
begin;

create or replace function public.import_ifa_games(p jsonb, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season int := (p->>'ifa_season_id')::int;
  v_league int := nullif(p->>'ifa_league_id', '')::int;
  v_source text := left(coalesce(p->>'source_url', ''), 400);
  v_scope_team int := nullif(p #>> '{scope,ifa_team_id}', '')::int;
  v_actor uuid := coalesce(auth.uid(), (select user_id from platform_admins order by user_id limit 1));
  v_run uuid;
  r jsonb;
  old ifa_games%rowtype;
  new ifa_games%rowtype;
  v_found boolean;
  v_gid bigint;
  v_key text;
  v_keys text[] := '{}';
  v_seen uuid[] := '{}';
  v_changes jsonb;
  v_kinds text[];
  v_sig boolean;
  v_notify boolean;
  v_update uuid;
  v_new int := 0;
  v_changed int := 0;
  v_same int := 0;
  v_queued int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_report jsonb := '[]'::jsonb;
  v_min date;
  v_max date;
  v_missing jsonb;
  v_time text;
  c record;
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'add a platform admin first (platform_admins)' using errcode = '22023';
  end if;
  if v_season is null or jsonb_typeof(p->'games') is distinct from 'array' then
    raise exception 'ifa_season_id and games[] are required' using errcode = '22023';
  end if;

  -- run row first so updates can point at it; counts are filled in at the end
  insert into ifa_sync_runs (kind, source, status, created_by)
  values ('games', v_source, case when p_apply then 'ok' else 'dry_run' end, v_actor)
  returning id into v_run;

  for r in select * from jsonb_array_elements(p->'games') loop
    begin
      -- the site shows game_id=-1 for games that have no id yet
      v_gid := case when r->>'ifa_game_id' ~ '^[0-9]+$' and (r->>'ifa_game_id')::bigint > 0 then (r->>'ifa_game_id')::bigint end;
      if v_gid is null and coalesce(r->>'ifa_game_id', '') not in ('', '-1', '0') then
        raise exception 'invalid ifa_game_id %', r->>'ifa_game_id';
      end if;
      if coalesce(r->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'missing or invalid date';
      end if;
      v_time := nullif(trim(coalesce(r->>'time', '')), '');
      if v_time is not null and v_time !~ '^\d{1,2}:\d{2}$' then
        raise exception 'invalid time %', v_time;
      end if;
      if coalesce(r->>'home_ifa_team_id', '') !~ '^[0-9]+$' or coalesce(r->>'away_ifa_team_id', '') !~ '^[0-9]+$' then
        raise exception 'home and away IFA team ids are required (names alone are not used)';
      end if;

      new := null;
      new.ifa_game_id := v_gid;
      new.ifa_season_id := v_season;
      new.ifa_league_id := coalesce(nullif(r->>'ifa_league_id', '')::int, v_league);
      new.home_ifa_team_id := (r->>'home_ifa_team_id')::int;
      new.away_ifa_team_id := (r->>'away_ifa_team_id')::int;
      new.home_name := left(trim(coalesce(r->>'home_name', '')), 120);
      new.away_name := left(trim(coalesce(r->>'away_name', '')), 120);
      new.game_date := (r->>'date')::date;
      new.kickoff_time := v_time::time;
      -- 00:00 is "not set yet" unless the source says otherwise
      new.time_confirmed := new.kickoff_time is not null
                            and (new.kickoff_time <> time '00:00' or coalesce((r->>'time_confirmed')::boolean, false));
      if not new.time_confirmed then
        new.kickoff_time := null;
      end if;
      new.venue := left(trim(coalesce(r->>'venue', '')), 120);
      new.address := left(trim(coalesce(r->>'address', '')), 160);
      new.status := case when r->>'status' in ('scheduled', 'played', 'postponed', 'canceled', 'unknown') then r->>'status' else 'unknown' end;
      new.result_raw := left(trim(coalesce(r->>'result_raw', '')), 30);
      new.home_score := case when r->>'home_score' ~ '^[0-9]+$' then (r->>'home_score')::smallint end;
      new.away_score := case when r->>'away_score' ~ '^[0-9]+$' then (r->>'away_score')::smallint end;
      if (new.home_score is null) <> (new.away_score is null) then
        raise exception 'only one score given';
      end if;

      -- one row per pairing in a payload; a second one would be a guess
      v_key := new.home_ifa_team_id || '-' || new.away_ifa_team_id;
      if v_key = any (v_keys) then
        raise exception 'pairing % appears twice in this payload; not matched', v_key;
      end if;
      v_keys := v_keys || v_key;

      v_min := least(coalesce(v_min, new.game_date), new.game_date);
      v_max := greatest(coalesce(v_max, new.game_date), new.game_date);

      -- match: IFA game id first, then season + home id + away id
      v_found := false;
      if v_gid is not null then
        select * into old from ifa_games where ifa_game_id = v_gid;
        v_found := found;
      end if;
      if not v_found then
        select * into old from ifa_games
        where ifa_season_id = v_season and home_ifa_team_id = new.home_ifa_team_id and away_ifa_team_id = new.away_ifa_team_id;
        v_found := found;
        if v_found and v_gid is not null and old.ifa_game_id is not null and old.ifa_game_id <> v_gid then
          raise exception 'pairing % already has game id %, payload says %', v_key, old.ifa_game_id, v_gid;
        end if;
      end if;
      if v_found and p_apply then
        select * into old from ifa_games where id = old.id for update;
      end if;

      if not v_found then
        v_new := v_new + 1;
        v_report := v_report || jsonb_build_object('ifa_game_id', v_gid, 'pairing', v_key, 'change', 'new');
        if p_apply then
          insert into ifa_games (ifa_game_id, ifa_season_id, ifa_league_id, home_ifa_team_id, away_ifa_team_id, home_name, away_name,
                                 game_date, kickoff_time, time_confirmed, venue, address, status, result_raw, home_score, away_score, source)
          values (new.ifa_game_id, new.ifa_season_id, new.ifa_league_id, new.home_ifa_team_id, new.away_ifa_team_id, new.home_name, new.away_name,
                  new.game_date, new.kickoff_time, new.time_confirmed, new.venue, new.address, new.status, new.result_raw,
                  new.home_score, new.away_score, v_source)
          returning id into new.id;
          v_seen := v_seen || new.id;
          perform ifa_mirror_game(new.id);
        end if;
        continue;
      end if;
      v_seen := v_seen || old.id;

      -- compare field by field (names are kept, never notified)
      v_changes := '[]'::jsonb;
      v_kinds := '{}';
      if old.game_date is distinct from new.game_date then
        v_changes := v_changes || jsonb_build_object('field', 'date', 'old', to_char(old.game_date, 'DD/MM/YYYY'), 'new', to_char(new.game_date, 'DD/MM/YYYY'));
        v_kinds := v_kinds || 'date'::text;
      end if;
      if (old.kickoff_time, old.time_confirmed) is distinct from (new.kickoff_time, new.time_confirmed) then
        v_changes := v_changes || jsonb_build_object('field', 'time',
          'old', ifa_time_label(old.kickoff_time, old.time_confirmed), 'new', ifa_time_label(new.kickoff_time, new.time_confirmed));
        v_kinds := v_kinds || case when new.time_confirmed then 'time' else 'time_unset' end;
      end if;
      if old.venue is distinct from new.venue then
        v_changes := v_changes || jsonb_build_object('field', 'venue', 'old', old.venue, 'new', new.venue);
        v_kinds := v_kinds || 'venue'::text;
      end if;
      if new.address <> '' and old.address is distinct from new.address then
        v_changes := v_changes || jsonb_build_object('field', 'address', 'old', old.address, 'new', new.address);
        v_kinds := v_kinds || 'address'::text;
      end if;
      if old.status is distinct from new.status then
        v_changes := v_changes || jsonb_build_object('field', 'status', 'old', ifa_status_label(old.status), 'new', ifa_status_label(new.status));
        v_kinds := v_kinds || 'status'::text;
      end if;
      if (old.home_score, old.away_score, old.result_raw) is distinct from (new.home_score, new.away_score, new.result_raw) then
        v_changes := v_changes || jsonb_build_object('field', 'result',
          'old', nullif(concat_ws('–', old.home_score, old.away_score), ''), 'new', nullif(concat_ws('–', new.home_score, new.away_score), ''));
        v_kinds := v_kinds || 'result'::text;
      end if;
      if v_gid is not null and old.ifa_game_id is null then
        v_changes := v_changes || jsonb_build_object('field', 'ifa_game_id', 'old', null, 'new', v_gid);
        v_kinds := v_kinds || 'id_assigned'::text;
      end if;

      if jsonb_array_length(v_changes) = 0 then
        v_same := v_same + 1;
        if p_apply then
          update ifa_games set last_seen_at = now(),
            home_name = case when new.home_name <> '' then new.home_name else home_name end,
            away_name = case when new.away_name <> '' then new.away_name else away_name end
          where id = old.id;
        end if;
        continue;
      end if;

      -- significant: date, venue, a time becoming known or moving, status.
      -- A confirmed time falling back to 00:00 is recorded but not notified
      -- (more likely a page glitch than a real change; staff see it in history).
      -- A newly assigned IFA game id is recorded only.
      v_sig := v_kinds && array['date', 'venue', 'time', 'status'];
      v_notify := v_kinds && array['date', 'venue', 'time', 'address', 'status', 'result'];
      v_changed := v_changed + 1;
      v_report := v_report || jsonb_build_object('ifa_game_id', coalesce(v_gid, old.ifa_game_id), 'pairing', v_key, 'change', 'updated',
                                                 'fields', v_changes, 'notify', v_notify);
      if p_apply then
        insert into ifa_game_updates (game_id, run_id, kinds, significant, notify, source)
        values (old.id, v_run, v_kinds, v_sig, v_notify, v_source)
        returning id into v_update;
        for c in select * from jsonb_array_elements(v_changes) loop
          insert into ifa_game_changes (update_id, field, old_value, new_value)
          values (v_update, c.value->>'field', c.value->>'old', c.value->>'new');
        end loop;
        update ifa_games set
          ifa_game_id = coalesce(ifa_game_id, v_gid),
          ifa_league_id = coalesce(new.ifa_league_id, ifa_league_id),
          home_name = case when new.home_name <> '' then new.home_name else home_name end,
          away_name = case when new.away_name <> '' then new.away_name else away_name end,
          game_date = new.game_date, kickoff_time = new.kickoff_time, time_confirmed = new.time_confirmed,
          venue = new.venue, address = case when new.address <> '' then new.address else address end,
          status = new.status, result_raw = new.result_raw, home_score = new.home_score, away_score = new.away_score,
          source = v_source, last_seen_at = now(),
          last_changed_at = case when v_kinds <@ array['id_assigned'] then last_changed_at else now() end
        where id = old.id;
        perform ifa_mirror_game(old.id);
        v_queued := v_queued + ifa_enqueue_update(v_update);
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('game', coalesce(r->>'ifa_game_id', ''), 'date', r->>'date', 'error', sqlerrm);
    end;
  end loop;

  if p_apply then
    perform ifa_refresh_venue_hints(v_season);
    -- the league as the page states it, e.g. "ליגת ילדים טרום ב' דן" (the roster page does not show it)
    if v_league is not null and coalesce(p->>'league_name', '') <> '' then
      insert into ifa_leagues (ifa_season_id, ifa_league_id, name, source_url)
      values (v_season, v_league, left(trim(regexp_replace(p->>'league_name', '^\d{4}/\d{4}\s*', '')), 120), v_source)
      on conflict (ifa_season_id, ifa_league_id) do update set name = excluded.name, synced_at = now();
      if v_scope_team is not null then
        update ifa_teams set ifa_league_id = v_league
        where ifa_season_id = v_season and ifa_team_id = v_scope_team and ifa_league_id is null;
        update teams t set league = left(l.name, 80)
        from ifa_teams it join ifa_leagues l on l.ifa_season_id = it.ifa_season_id and l.ifa_league_id = it.ifa_league_id
        where it.ifa_season_id = v_season and it.ifa_team_id = v_scope_team and t.id = it.team_id and t.league = '';
      end if;
    end if;
  end if;

  -- games we have for this scope and date range that the payload did not list: report only
  select coalesce(jsonb_agg(jsonb_build_object('ifa_game_id', g.ifa_game_id, 'date', g.game_date,
                                               'pairing', g.home_ifa_team_id || '-' || g.away_ifa_team_id) order by g.game_date), '[]'::jsonb)
    into v_missing
  from ifa_games g
  where p_apply and g.ifa_season_id = v_season and v_min is not null and g.game_date between v_min and v_max
    and (v_scope_team is null or v_scope_team in (g.home_ifa_team_id, g.away_ifa_team_id))
    and (v_scope_team is not null or v_league is null or g.ifa_league_id = v_league)
    and not (g.id = any (v_seen));

  update ifa_sync_runs set
    status = case when not p_apply then 'dry_run'
                  when jsonb_array_length(v_errors) = 0 then 'ok'
                  when v_new + v_changed + v_same = 0 then 'failed' else 'partial' end,
    counts = jsonb_build_object('ifa_league_id', v_league, 'ifa_team_id', v_scope_team,
                                'games_in_payload', jsonb_array_length(p->'games'), 'new', v_new, 'changed', v_changed,
                                'unchanged', v_same, 'queued', v_queued, 'not_in_payload', coalesce(v_missing, '[]'::jsonb),
                                'from', v_min, 'to', v_max),
    errors = v_errors
  where id = v_run;

  return jsonb_build_object('run_id', v_run, 'applied', p_apply, 'new', v_new, 'changed', v_changed, 'unchanged', v_same,
                            'queued', v_queued, 'not_in_payload', coalesce(v_missing, '[]'::jsonb), 'errors', v_errors, 'changes', v_report);
end;
$$;


drop function if exists public.ifa_result_home(text);
drop function if exists public.ifa_result_away(text);

commit;
