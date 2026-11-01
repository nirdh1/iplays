-- iplays — team fund and payments (real, replaces the demo-only "קופה").
--
-- Run after 20261101960000_parent_trainings.sql.
-- Rollback: supabase/rollback/20261101970000_team_fund.down.sql
-- Additive only: four new tables, helper functions, RPCs and policies.
-- No existing table or row changes.
--
-- Model
--   fund_treasurers   parents appointed to run the team fund (ועד / גזבר)
--   fund_collections  one collection ("גבייה"): title, amount per child, due date,
--                     optional payment link (Bit / PayBox / bank details)
--   fund_payments     one row per child per collection: the parent reports
--                     "paid", a treasurer confirms (or records cash directly)
--   fund_expenses     money spent from the fund, visible to every member
--
-- Money never moves through iplays: parents pay by the link/details the
-- treasurer gave, and the app tracks who paid.
--
-- Who manages the fund (open / close collections, confirm payments, log
-- expenses, appoint treasurers):
--   * an appointed treasurer of the team, or
--   * anyone with can(team, 'finance', 3) (team manager, team admin,
--     club owner/admin, explicit finance grant), or a platform admin.
--   * While a team has no fund manager at all, any team member may appoint
--     themselves the first treasurer (same spirit as no-staff teams).
-- Visibility:
--   * every member sees collections, totals (paid count / amount) and expenses;
--   * a parent sees the payment rows of their own children only;
--   * fund managers see every family's status.

begin;

-- ---------------------------------------------------------------- tables

create table public.fund_treasurers (
  team_id uuid not null references public.teams (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  appointed_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index fund_treasurers_user_idx on public.fund_treasurers (user_id);

create table public.fund_collections (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 80),
  details text not null default '' check (char_length(details) <= 500),
  amount_per_child numeric(10, 2) not null check (amount_per_child > 0 and amount_per_child <= 100000),
  -- optional fundraising goal; null = amount_per_child × children
  goal numeric(10, 2) check (goal is null or goal > 0),
  due_on date,
  -- how to pay: a Bit / PayBox link, a phone number or bank details
  pay_link text not null default '' check (char_length(pay_link) <= 300),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index fund_collections_team_idx on public.fund_collections (team_id, created_at desc);

create table public.fund_payments (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.fund_collections (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  amount numeric(10, 2) not null check (amount > 0),
  method text not null default 'other' check (method in ('bit', 'paybox', 'transfer', 'cash', 'other')),
  -- reported = the parent says they paid; confirmed = a fund manager saw the money;
  -- rejected = the manager didn't find it (the parent can report again);
  -- exempt = the manager waived this child
  status text not null default 'reported' check (status in ('reported', 'confirmed', 'rejected', 'exempt')),
  note text not null default '' check (char_length(note) <= 200),
  reported_by uuid references auth.users (id) on delete set null,
  reported_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  unique (collection_id, player_id)
);
create index fund_payments_player_idx on public.fund_payments (player_id);

create table public.fund_expenses (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  collection_id uuid references public.fund_collections (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 80),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 1000000),
  spent_on date not null default current_date,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index fund_expenses_team_idx on public.fund_expenses (team_id, spent_on desc);

-- --------------------------------------------------------------- helpers

create function public.is_fund_treasurer(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fund_treasurers where team_id = p_team and user_id = auth.uid());
$$;

create function public.can_manage_fund(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_fund_treasurer(p_team) or can(p_team, 'finance', 3) or is_platform_admin();
$$;

-- Does anyone (treasurer or member with a finance-managing role) run this fund?
create function public.team_has_fund_manager(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fund_treasurers where team_id = p_team)
      or exists (select 1 from team_members m where m.team_id = p_team
                 and role_default_level(m.role, 'finance') >= 3);
$$;

create function public.collection_team(p_collection uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from fund_collections where id = p_collection;
$$;

create function public.is_my_child(p_player uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_guardians where player_id = p_player and user_id = auth.uid());
$$;

-- ------------------------------------------------------------------ RPCs

-- Appoint a treasurer (p_user null = yourself). Managers may appoint anyone in
-- the team; any member may appoint themselves while the fund has no manager.
create function public.appoint_treasurer(p_team uuid, p_user uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := coalesce(p_user, auth.uid());
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from team_members where team_id = p_team and user_id = v_user) then
    raise exception 'not_a_member';
  end if;
  if not (can_manage_fund(p_team)
          or (v_user = auth.uid() and is_team_member(p_team) and not team_has_fund_manager(p_team))) then
    raise exception 'not_allowed';
  end if;
  insert into fund_treasurers (team_id, user_id) values (p_team, v_user) on conflict do nothing;
end $$;

-- Remove a treasurer: a manager, or the treasurer stepping down.
create function public.remove_treasurer(p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (can_manage_fund(p_team) or p_user = auth.uid()) then raise exception 'not_allowed'; end if;
  delete from fund_treasurers where team_id = p_team and user_id = p_user;
end $$;

-- A parent reports they paid for their child.
create function public.report_payment(p_collection uuid, p_player uuid, p_method text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare c fund_collections;
begin
  select * into c from fund_collections where id = p_collection;
  if c.id is null or c.status <> 'open' then raise exception 'collection_closed'; end if;
  if not is_my_child(p_player) then raise exception 'not_your_child'; end if;
  if not exists (select 1 from player_assignments where player_id = p_player and team_id = c.team_id and ended_on is null) then
    raise exception 'not_in_team';
  end if;
  insert into fund_payments (collection_id, player_id, amount, method, status, note, reported_by, reported_at)
  values (p_collection, p_player, c.amount_per_child, p_method, 'reported', coalesce(p_note, ''), auth.uid(), now())
  on conflict (collection_id, player_id) do update
    set method = excluded.method, note = excluded.note, amount = excluded.amount,
        status = 'reported', reported_by = auth.uid(), reported_at = now(),
        reviewed_by = null, reviewed_at = null
    where fund_payments.status in ('reported', 'rejected');
end $$;

-- A fund manager sets a child's status (confirm a report, reject it, record
-- cash directly, or exempt the child).
create function public.set_payment_status(
  p_collection uuid, p_player uuid, p_status text, p_method text default null, p_amount numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare c fund_collections;
begin
  select * into c from fund_collections where id = p_collection;
  if c.id is null then raise exception 'not_found'; end if;
  if not can_manage_fund(c.team_id) then raise exception 'not_allowed'; end if;
  if p_status not in ('confirmed', 'rejected', 'exempt') then raise exception 'bad_status'; end if;
  if not exists (select 1 from player_assignments where player_id = p_player and team_id = c.team_id)
     and not exists (select 1 from fund_payments where collection_id = p_collection and player_id = p_player) then
    raise exception 'not_in_team';
  end if;
  insert into fund_payments (collection_id, player_id, amount, method, status, reviewed_by, reviewed_at)
  values (p_collection, p_player, coalesce(p_amount, c.amount_per_child), coalesce(p_method, 'cash'),
          p_status, auth.uid(), now())
  on conflict (collection_id, player_id) do update
    set status = excluded.status,
        method = coalesce(p_method, fund_payments.method),
        amount = coalesce(p_amount, fund_payments.amount),
        reviewed_by = auth.uid(), reviewed_at = now();
end $$;

-- Totals every member may see (no per-family detail).
create function public.fund_summary(p_team uuid)
returns table (collection_id uuid, children int, paid int, reported int, raised numeric, spent numeric)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select count(*)::int from player_assignments a where a.team_id = c.team_id and a.ended_on is null),
    (select count(*)::int from fund_payments p where p.collection_id = c.id and p.status = 'confirmed'),
    (select count(*)::int from fund_payments p where p.collection_id = c.id and p.status = 'reported'),
    coalesce((select sum(p.amount) from fund_payments p where p.collection_id = c.id and p.status = 'confirmed'), 0),
    coalesce((select sum(e.amount) from fund_expenses e where e.collection_id = c.id), 0)
  from fund_collections c
  where c.team_id = p_team and (is_team_member(p_team) or can_manage_fund(p_team));
$$;

-- ------------------------------------------------------------------- RLS

alter table public.fund_treasurers enable row level security;
alter table public.fund_collections enable row level security;
alter table public.fund_payments enable row level security;
alter table public.fund_expenses enable row level security;

create policy fund_treasurers_select on public.fund_treasurers for select to authenticated
  using (is_team_member(team_id) or can_manage_fund(team_id));
-- writes go through appoint_treasurer / remove_treasurer

create policy fund_collections_select on public.fund_collections for select to authenticated
  using (is_team_member(team_id) or can_manage_fund(team_id));
create policy fund_collections_insert on public.fund_collections for insert to authenticated
  with check (can_manage_fund(team_id) and created_by = auth.uid());
create policy fund_collections_update on public.fund_collections for update to authenticated
  using (can_manage_fund(team_id)) with check (can_manage_fund(team_id));
-- no delete: a collection is cancelled (status = 'cancelled') so history stays

create policy fund_payments_select on public.fund_payments for select to authenticated
  using (is_my_child(player_id) or can_manage_fund(collection_team(collection_id)));
-- writes go through report_payment / set_payment_status

create policy fund_expenses_select on public.fund_expenses for select to authenticated
  using (is_team_member(team_id) or can_manage_fund(team_id));
create policy fund_expenses_insert on public.fund_expenses for insert to authenticated
  with check (can_manage_fund(team_id) and created_by = auth.uid());
create policy fund_expenses_update on public.fund_expenses for update to authenticated
  using (can_manage_fund(team_id)) with check (can_manage_fund(team_id));
create policy fund_expenses_delete on public.fund_expenses for delete to authenticated
  using (can_manage_fund(team_id));

grant select on public.fund_treasurers, public.fund_payments to authenticated;
grant select, insert, update on public.fund_collections to authenticated;
grant select, insert, update, delete on public.fund_expenses to authenticated;

revoke execute on function public.appoint_treasurer(uuid, uuid), public.remove_treasurer(uuid, uuid),
  public.report_payment(uuid, uuid, text, text), public.set_payment_status(uuid, uuid, text, text, numeric),
  public.fund_summary(uuid) from public, anon;
grant execute on function public.appoint_treasurer(uuid, uuid), public.remove_treasurer(uuid, uuid),
  public.report_payment(uuid, uuid, text, text), public.set_payment_status(uuid, uuid, text, text, numeric),
  public.fund_summary(uuid), public.is_fund_treasurer(uuid), public.can_manage_fund(uuid),
  public.team_has_fund_manager(uuid) to authenticated;

do $$ begin raise notice 'iplays: team fund installed'; end $$;

commit;
