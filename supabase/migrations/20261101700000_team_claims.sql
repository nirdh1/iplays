-- iplays — a coach asks to manage an existing team.
--
-- Run after 20261101600000_open_teams.sql.
-- Rollback: supabase/rollback/20261101700000_team_claims.down.sql
-- (keeps the team_claims table and its data).
--
-- Product decision (2026-11-01, project owner): league teams exist before
-- anyone registers (catalog). Parents join them even with no coach. A coach
-- who registers takes over the team, but only after approval, so nobody can
-- make themselves the coach of any team:
--   * the team's club admin approves; if the team has no club (or the club
--     has no admin), a platform admin (Super Admin) approves.
--   * an approved coach becomes the team admin if the team has none,
--     otherwise a coach. From then on the team "has staff" and parent
--     requests wait for the staff again (see 20261101600000_open_teams.sql).

begin;

create table if not exists public.team_claims (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  role text not null default 'coach' check (role in ('coach')),
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists team_claims_pending_idx on public.team_claims (team_id, user_id) where status = 'pending';
create index if not exists team_claims_team_idx on public.team_claims (team_id) where status = 'pending';

alter table public.team_claims enable row level security;
drop policy if exists team_claims_select on public.team_claims;
create policy team_claims_select on public.team_claims for select to authenticated
  using (user_id = auth.uid());
-- all writes go through the functions below
revoke insert, update, delete on public.team_claims from authenticated, anon;
grant select on public.team_claims to authenticated;

-- Who approves claims for this team: its club admin, or (no club admin) a platform admin.
create function public.can_review_team_claim(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_platform_admin()
      or exists (select 1 from teams t where t.id = p_team and t.club_id is not null and is_club_admin(t.club_id));
$$;

create function public.request_team_claim(p_team uuid, p_message text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from teams where id = p_team and archived_at is null) then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from team_members where team_id = p_team and user_id = auth.uid() and role in ('admin', 'coach')) then
    raise exception 'already staff' using errcode = '23505';
  end if;
  insert into team_claims (team_id, user_id, message) values (p_team, auth.uid(), trim(coalesce(p_message, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_team_claim(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update team_claims set status = 'cancelled' where id = p_id and user_id = auth.uid() and status = 'pending';
$$;

create function public.review_team_claim(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r team_claims%rowtype;
  v_role text;
begin
  select * into r from team_claims where id = p_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not can_review_team_claim(r.team_id) then
    raise exception 'not allowed to approve coaches for this team' using errcode = '42501';
  end if;
  if p_approve then
    v_role := case when exists (select 1 from team_members where team_id = r.team_id and role = 'admin') then 'coach' else 'admin' end;
    insert into team_members (team_id, user_id, role) values (r.team_id, r.user_id, v_role)
    on conflict (team_id, user_id) do update
      set role = case when team_members.role = 'admin' then 'admin' else excluded.role end;
  end if;
  update team_claims
  set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  perform write_audit(case when p_approve then 'team_claim.approve' else 'team_claim.reject' end,
                      (select club_id from teams where id = r.team_id), 'team_claim', p_id,
                      jsonb_build_object('team_id', r.team_id, 'user_id', r.user_id));
end;
$$;

-- Claims waiting for the caller (club admin of the team's club, or platform admin).
create function public.pending_team_claims()
returns table (id uuid, team_id uuid, team_name text, club_name text, requester text, message text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, t.id, t.name, coalesce(cl.name, nullif(t.club, '')),
         coalesce(nullif(pr.full_name, ''), coalesce(pr.email, pr.phone, '')), c.message, c.created_at
  from team_claims c
  join teams t on t.id = c.team_id
  left join clubs cl on cl.id = t.club_id
  left join profiles pr on pr.id = c.user_id
  where c.status = 'pending' and can_review_team_claim(c.team_id)
  order by c.created_at;
$$;

revoke all on function public.can_review_team_claim, public.request_team_claim, public.cancel_team_claim,
  public.review_team_claim, public.pending_team_claims
from public, anon;
grant execute on function public.can_review_team_claim, public.request_team_claim, public.cancel_team_claim,
  public.review_team_claim, public.pending_team_claims
to authenticated;

commit;
