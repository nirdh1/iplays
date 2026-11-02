-- iplays — IFA roster review: a re-saved roster page never overwrites the team.
--
-- Run after 20261101999000_team_ifa_link.sql. Additive only: one new table and
-- new functions. Nothing existing is changed, deleted or renamed.
-- Rollback: supabase/rollback/20261102100000_ifa_roster_review.down.sql
-- (drops the functions and policy; keeps the table and every row).
--
-- Flow (product decision 2026-11-01: IFA gives the first roster, then the
-- coach manages it):
--   1. first import of a team      -> import_ifa_team / sync_ifa_roster(p, true)
--   2. a newer saved roster page    -> propose_ifa_roster(p)  (admin)
--                                      agent_propose_ifa_roster(key, p) (Mac)
--      The difference is stored as pending rows. Nothing in the team changes.
--   3. team staff who may manage the roster (can_manage_team_roster) review
--      each row: accept (apply that one change) or keep (leave the team as it
--      is). Several rows can be decided at once.
--
-- Rules:
--   * a player missing from the page is a difference to review, never a delete;
--     accepting it ends the player's assignment (history kept);
--   * a "keep" decision is remembered: the same difference is not asked again
--     while the page keeps showing it; once the page stops showing it, the
--     decision is closed ('superseded') and a later difference is asked anew;
--   * pending rows the newer page no longer shows are closed as 'superseded';
--   * the IFA page has no shirt numbers, so there is nothing to compare there.

begin;

create table if not exists public.ifa_roster_review (
  id bigint generated always as identity primary key,
  ifa_season_id int not null,
  ifa_team_id int not null,
  team_id uuid not null references public.teams (id) on delete restrict,
  ifa_player_id bigint not null,
  kind text not null check (kind in ('added', 'missing', 'returned', 'renamed')),
  old_value text,
  new_value text,
  item jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'kept', 'superseded')),
  run_id uuid references public.ifa_sync_runs (id) on delete set null,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz
);
create unique index if not exists ifa_roster_review_open_idx
  on public.ifa_roster_review (ifa_season_id, ifa_team_id, ifa_player_id, kind) where status in ('pending', 'kept');
create index if not exists ifa_roster_review_team_idx on public.ifa_roster_review (team_id) where status = 'pending';

alter table public.ifa_roster_review enable row level security;
drop policy if exists ifa_roster_review_select on public.ifa_roster_review;
create policy ifa_roster_review_select on public.ifa_roster_review for select to authenticated
  using (can_manage_team_roster(team_id));
revoke insert, update, delete on public.ifa_roster_review from authenticated, anon;
grant select on public.ifa_roster_review to authenticated;

-- The inbox (20261101995000) lists the allowed notification kinds; add ours.
-- Same list as there plus 'roster_review' (a wider check, no row affected).
do $$
begin
  if to_regclass('public.notification_outbox') is not null then
    alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
    alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
      'match_change', 'match_result', 'training', 'announcement', 'absence',
      'join_request', 'join_decision', 'team_claim', 'team_claim_decision', 'roster_review'));
  end if;
end;
$$;

-- ------------------------------------------------------------------ propose
-- Not granted to anyone: called by the two wrappers below.
create or replace function public.ifa_roster_propose_core(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season int := case when p->>'ifa_season_id' ~ '^[0-9]+$' then (p->>'ifa_season_id')::int end;
  v_ifa_team int := case when p->>'ifa_team_id' ~ '^[0-9]+$' then (p->>'ifa_team_id')::int end;
  v_team uuid;
  v_dry jsonb;
  v_run uuid;
  v_diff jsonb;
  v_new int := 0;
  v_kept int := 0;
  v_superseded int := 0;
  v_staff uuid[];
begin
  select team_id into v_team from ifa_teams where ifa_season_id = v_season and ifa_team_id = v_ifa_team;
  if v_team is null or not exists (select 1 from ifa_rosters where ifa_season_id = v_season and ifa_team_id = v_ifa_team) then
    return jsonb_build_object('ok', false, 'error', 'team not imported yet: run the first import (import_ifa_team) for it');
  end if;

  v_dry := sync_ifa_roster(p - 'allow_large_drop', false);
  if not coalesce((v_dry->>'ok')::boolean, false) then
    return v_dry;
  end if;
  v_run := (v_dry->>'run_id')::uuid;

  -- one row per difference: kind, player, the value that identifies it
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_diff from (
    select jsonb_build_object('kind', 'added', 'pid', x->>'ifa_player_id', 'old', null, 'new', x->>'name', 'item', x) d
      from jsonb_array_elements(v_dry->'added') x
    union all
    select jsonb_build_object('kind', 'missing', 'pid', x->>'ifa_player_id', 'old', x->>'name', 'new', null, 'item', x)
      from jsonb_array_elements(v_dry->'missing') x
    union all
    select jsonb_build_object('kind', 'returned', 'pid', x->>'ifa_player_id', 'old', null, 'new', x->>'name', 'item', x)
      from jsonb_array_elements(v_dry->'returned') x
    union all
    select jsonb_build_object('kind', 'renamed', 'pid', x->>'ifa_player_id', 'old', x->>'old', 'new', x->>'new', 'item', x)
      from jsonb_array_elements(v_dry->'renamed') x
  ) q;

  -- the page no longer shows it (or shows another value): close pending and kept rows
  update ifa_roster_review r set status = 'superseded', decided_at = coalesce(r.decided_at, now())
  where r.ifa_season_id = v_season and r.ifa_team_id = v_ifa_team and r.status in ('pending', 'kept')
    and not exists (select 1 from jsonb_array_elements(v_diff) d
                    where d->>'kind' = r.kind and (d->>'pid')::bigint = r.ifa_player_id
                      and coalesce(d->>'new', '') = coalesce(r.new_value, ''));
  get diagnostics v_superseded = row_count;

  -- still shown: refresh pending rows, leave kept rows quiet
  update ifa_roster_review r set last_seen_at = now(), run_id = v_run
  where r.ifa_season_id = v_season and r.ifa_team_id = v_ifa_team and r.status in ('pending', 'kept');
  select count(*) into v_kept from ifa_roster_review
  where ifa_season_id = v_season and ifa_team_id = v_ifa_team and status = 'kept';

  insert into ifa_roster_review (ifa_season_id, ifa_team_id, team_id, ifa_player_id, kind, old_value, new_value, item, run_id)
  select v_season, v_ifa_team, v_team, (d->>'pid')::bigint, d->>'kind', d->>'old', d->>'new', coalesce(d->'item', '{}'), v_run
  from jsonb_array_elements(v_diff) d
  where not exists (select 1 from ifa_roster_review r
                    where r.ifa_season_id = v_season and r.ifa_team_id = v_ifa_team and r.status in ('pending', 'kept')
                      and r.kind = d->>'kind' and r.ifa_player_id = (d->>'pid')::bigint);
  get diagnostics v_new = row_count;

  if v_new > 0 and to_regprocedure('public.notify_users(uuid[],uuid,text,text,text,text,uuid,text)') is not null then
    v_staff := team_staff_ids(v_team);
    execute 'select notify_users($1, $2, $3, $4, $5, $6, null, $7)'
      using v_staff, v_team, 'roster_review', 'עדכון סגל מההתאחדות',
            v_new || ' שינויים בסגל ממתינים לאישורך. עד שתאשר, הסגל נשאר כמו שהוא.',
            '#myteam/' || v_team, 'team_updates';
  end if;

  return jsonb_build_object('ok', true, 'team_id', v_team, 'run_id', v_run, 'summary', v_dry->'summary',
                            'new_pending', v_new, 'kept_quiet', v_kept, 'superseded', v_superseded,
                            'pending_total', (select count(*) from ifa_roster_review
                                              where ifa_season_id = v_season and ifa_team_id = v_ifa_team and status = 'pending'));
end;
$$;

create or replace function public.propose_ifa_roster(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return ifa_roster_propose_core(p);
end;
$$;

-- The Mac agent signs with its own key; it can only create pending rows.
create or replace function public.agent_propose_ifa_roster(p_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agent uuid := ifa_agent_id(p_key);
begin
  return ifa_roster_propose_core(p_payload) || jsonb_build_object('agent_id', v_agent);
end;
$$;

-- ------------------------------------------------------------------- review
create or replace function public.team_roster_review(p_team uuid)
returns table (id bigint, kind text, ifa_player_id bigint, old_value text, new_value text,
               player_id uuid, player_name text, shirt_number int, detected_at timestamptz, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_team_roster(p_team) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select r.id, r.kind, r.ifa_player_id, r.old_value, r.new_value, ip.player_id,
         nullif(trim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), ''),
         pa.shirt_number, r.detected_at, r.last_seen_at
  from ifa_roster_review r
  left join ifa_players ip on ip.ifa_player_id = r.ifa_player_id
  left join players pl on pl.id = ip.player_id
  left join player_assignments pa on pa.player_id = ip.player_id and pa.team_id = r.team_id and pa.ended_on is null
  where r.team_id = p_team and r.status = 'pending'
  order by case r.kind when 'added' then 1 when 'missing' then 2 when 'returned' then 3 else 4 end, r.new_value, r.old_value;
end;
$$;

-- counter for the home screen: teams this user manages that have pending rows
create or replace function public.my_roster_review_counts()
returns table (team_id uuid, team_name text, pending int)
language sql stable security definer set search_path = public as $$
  select r.team_id, t.name, count(*)::int
  from ifa_roster_review r join teams t on t.id = r.team_id
  where r.status = 'pending' and auth.uid() is not null and can_manage_team_roster(r.team_id)
  group by r.team_id, t.name
  order by t.name;
$$;

-- Accept (apply) or keep each row. All rows are decided in one transaction.
create or replace function public.decide_ifa_roster_changes(p_ids bigint[], p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r ifa_roster_review;
  v_player uuid;
  v_actor uuid := auth.uid();
  v_done int := 0;
begin
  if v_actor is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  for r in select * from ifa_roster_review where id = any(coalesce(p_ids, '{}')) order by id for update loop
    if not can_manage_team_roster(r.team_id) then
      raise exception 'not allowed to manage this roster' using errcode = '42501';
    end if;
    if r.status <> 'pending' then
      continue;
    end if;

    if p_accept then
      select player_id into v_player from ifa_players where ifa_player_id = r.ifa_player_id;
      if r.kind in ('added', 'returned') then
        insert into ifa_players (ifa_player_id, name, profile_url)
        values (r.ifa_player_id, left(coalesce(r.new_value, ''), 40), coalesce(r.item->>'profile_url', ''))
        on conflict (ifa_player_id) do nothing;
        select player_id into v_player from ifa_players where ifa_player_id = r.ifa_player_id;
        if v_player is null then
          insert into players (team_id, first_name, last_name, created_by)
          values (r.team_id, left(coalesce(r.new_value, ''), 40), '', v_actor)
          returning id into v_player;
          update ifa_players set player_id = v_player where ifa_player_id = r.ifa_player_id;
        elsif not exists (select 1 from player_assignments
                          where player_id = v_player and team_id = r.team_id and ended_on is null) then
          perform transfer_player(v_player, r.team_id, 'add', null, 'נוסף לפי סגל ההתאחדות');
        end if;
        insert into ifa_rosters (ifa_season_id, ifa_team_id, ifa_player_id)
        values (r.ifa_season_id, r.ifa_team_id, r.ifa_player_id)
        on conflict (ifa_season_id, ifa_team_id, ifa_player_id)
        do update set status = 'active', missing_since = null, last_seen_at = now();
      elsif r.kind = 'missing' then
        update ifa_rosters set status = 'missing', missing_since = now()
        where ifa_season_id = r.ifa_season_id and ifa_team_id = r.ifa_team_id and ifa_player_id = r.ifa_player_id;
        if v_player is not null and exists (select 1 from player_assignments
                                            where player_id = v_player and team_id = r.team_id and ended_on is null) then
          perform end_player_assignment(v_player, r.team_id, 'לא מופיע בסגל ההתאחדות (אושר בצוות)');
        end if;
      elsif r.kind = 'renamed' then
        update ifa_players set name = left(coalesce(r.new_value, name), 40), synced_at = now()
        where ifa_player_id = r.ifa_player_id;
        -- a name nobody edited in the app follows the page; an edited one stays
        update players set first_name = left(r.new_value, 40)
        where id = v_player and first_name = r.old_value and coalesce(last_name, '') = '';
      end if;
      insert into ifa_roster_changes (run_id, ifa_season_id, ifa_team_id, ifa_player_id, kind, old_value, new_value)
      values (r.run_id, r.ifa_season_id, r.ifa_team_id, r.ifa_player_id, r.kind, r.old_value, r.new_value);
    end if;

    update ifa_roster_review
    set status = case when p_accept then 'accepted' else 'kept' end, decided_by = v_actor, decided_at = now()
    where id = r.id;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('decided', v_done, 'accepted', p_accept);
end;
$$;

revoke all on function public.ifa_roster_propose_core(jsonb), public.propose_ifa_roster(jsonb),
  public.agent_propose_ifa_roster(text, jsonb), public.team_roster_review(uuid),
  public.my_roster_review_counts(), public.decide_ifa_roster_changes(bigint[], boolean) from public;
grant execute on function public.propose_ifa_roster(jsonb), public.team_roster_review(uuid),
  public.my_roster_review_counts(), public.decide_ifa_roster_changes(bigint[], boolean) to authenticated;
grant execute on function public.agent_propose_ifa_roster(text, jsonb) to anon, authenticated;

commit;
