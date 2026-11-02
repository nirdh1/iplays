-- iplays — club finances (fees, charges, payments, reminders, reports) and
-- club activities with registration (camps, clinics, workshops).
--
-- Run after 20261102500000_calendar_absences.sql (needs the roles migration
-- 20261102400000_club_signup_roles_notes.sql for the 'camps' domain).
-- Rollback: supabase/rollback/20261102600000_club_finance_and_activities.down.sql
-- Additive only: new tables, one view, helpers, RPCs and policies; three new
-- notification kinds. No existing row is changed or removed. Access uses the
-- existing 'finance' and 'camps' domains, so the club's roles (e.g. the
-- treasurer and camps-manager templates) work here as they are.
--
-- Finance model
--   club_fee_plans    a fee the club defines: membership (once a season),
--                     monthly / periodic (N installments every M months) or
--                     one-time. Scope: whole club, one program or one team.
--   club_charges      what one child owes: one row per installment (from a
--                     plan), per activity registration, or added by hand.
--   club_payments     money against a charge: recorded by the treasurer
--                     (confirmed) or reported by a parent (reported, then
--                     confirmed / rejected). provider / provider_ref are kept
--                     for a future payment provider; no card data is stored.
--   club_reminders    log of payment reminders sent (in-app bell + push).
--   club_charge_balances (view) paid, reported, balance and state per charge.
-- Who:
--   finance level (can_club(club,'finance',n), or can(team,'finance',n) for a
--   charge of that team): 1 view & reports, 2 record payments, 3 create plans /
--   charges, confirm, waive, remind, 4 manage. A treasurer is anyone with a
--   club-wide 'finance' role or grant (e.g. the treasurer role template).
--   Parents see and report only their own children's charges.
--
-- Activities model
--   club_activities         camp / day camp / goalkeeper camp / special training
--                           / workshop: dates, place, birth years, capacity,
--                           price, status, registration deadline, visibility.
--   activity_registrations  a child's sign-up: registered or waitlist (when
--                           full), cancelled. A priced registration creates a
--                           club charge; cancelling cancels it if unpaid and
--                           promotes the first child on the waitlist.
--   Staff with can_club(club,'camps',n): 1 view sign-ups, 3 create/edit.

begin;

-- ---------------------------------------------------- notification kinds

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'match_change', 'match_result', 'training', 'announcement', 'absence',
  'join_request', 'join_decision', 'team_claim', 'team_claim_decision', 'roster_review',
  'payment_reminder', 'payment', 'activity'));

-- ---------------------------------------------------------- finance tables

create table public.club_fee_plans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  program_id uuid references public.club_programs (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 80),
  kind text not null check (kind in ('membership', 'monthly', 'periodic', 'one_time')),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 100000), -- per installment
  installments int not null default 1 check (installments between 1 and 24),
  interval_months int not null default 1 check (interval_months between 1 and 12),
  first_due_on date not null,
  season text not null default '' check (char_length(season) <= 20),
  notes text not null default '' check (char_length(notes) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  check (program_id is null or team_id is null)
);
create index club_fee_plans_club_idx on public.club_fee_plans (club_id);

create table public.club_activities (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  kind text not null check (kind in ('summer_camp', 'day_camp', 'gk_camp', 'special_training', 'workshop', 'other')),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  starts_on date not null,
  ends_on date not null,
  daily_hours text not null default '' check (char_length(daily_hours) <= 40),
  location text not null default '' check (char_length(location) <= 120),
  birth_year_min int check (birth_year_min between 2000 and 2030),
  birth_year_max int check (birth_year_max between 2000 and 2030),
  capacity int check (capacity is null or capacity between 1 and 2000),
  price numeric(10, 2) not null default 0 check (price >= 0 and price <= 100000),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'cancelled')),
  registration_closes_on date,
  -- public: any signed-in parent can find it; club: only families of the club's teams
  visibility text not null default 'public' check (visibility in ('public', 'club')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (birth_year_min is null or birth_year_max is null or birth_year_min <= birth_year_max)
);
create index club_activities_club_idx on public.club_activities (club_id, starts_on);
create index club_activities_open_idx on public.club_activities (starts_on) where status = 'open';

create table public.club_charges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  team_id uuid references public.teams (id) on delete restrict,
  plan_id uuid references public.club_fee_plans (id) on delete restrict,
  activity_id uuid references public.club_activities (id) on delete restrict,
  installment_no int,
  title text not null check (char_length(title) between 1 and 120),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 100000),
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'waived', 'cancelled')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index club_charges_club_idx on public.club_charges (club_id, due_on);
create index club_charges_player_idx on public.club_charges (player_id);
create unique index club_charges_plan_idx on public.club_charges (plan_id, player_id, installment_no) where plan_id is not null;

create table public.club_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.club_charges (id) on delete restrict,
  club_id uuid not null references public.clubs (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  amount numeric(10, 2) not null check (amount > 0 and amount <= 100000),
  method text not null default 'other' check (method in ('cash', 'transfer', 'bit', 'paybox', 'check', 'card_external', 'provider', 'other')),
  status text not null default 'confirmed' check (status in ('reported', 'confirmed', 'rejected', 'refunded')),
  paid_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 200),
  -- future payment provider: its name and transaction id only. Never card data.
  provider text not null default '' check (char_length(provider) <= 40),
  provider_ref text not null default '' check (char_length(provider_ref) <= 120),
  reported_by uuid references auth.users (id) on delete set null,
  recorded_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index club_payments_charge_idx on public.club_payments (charge_id);
create index club_payments_club_idx on public.club_payments (club_id, created_at desc);

create table public.club_reminders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete restrict,
  charge_id uuid not null references public.club_charges (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  sent_by uuid references auth.users (id) on delete set null default auth.uid(),
  sent_at timestamptz not null default now()
);
create index club_reminders_charge_idx on public.club_reminders (charge_id, sent_at desc);

create table public.activity_registrations (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.club_activities (id) on delete restrict,
  player_id uuid not null references public.players (id) on delete restrict,
  status text not null default 'registered' check (status in ('registered', 'waitlist', 'cancelled')),
  note text not null default '' check (char_length(note) <= 200),
  charge_id uuid references public.club_charges (id) on delete restrict,
  registered_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index activity_registrations_active_idx on public.activity_registrations (activity_id, player_id) where status <> 'cancelled';
create index activity_registrations_player_idx on public.activity_registrations (player_id);

-- --------------------------------------------------------------- helpers

-- Finance access for a club, or for one team's charges.
create function public.can_club_finance(p_club uuid, p_team uuid, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select can_club(p_club, 'finance', p_level)
      or (p_team is not null and can(p_team, 'finance', p_level))
      or is_platform_admin();
$$;

create function public.can_club_activities(p_club uuid, p_level int)
returns boolean language sql stable security definer set search_path = public as $$
  select can_club(p_club, 'camps', p_level) or is_platform_admin();
$$;

create function public.charge_row(p_charge uuid)
returns public.club_charges language sql stable security definer set search_path = public as $$
  select * from club_charges where id = p_charge;
$$;

create function public.activity_club(p_activity uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select club_id from club_activities where id = p_activity;
$$;

-- Parents of a child (for notifications).
create function public.guardian_ids(p_player uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from player_guardians where player_id = p_player;
$$;

-- Is the child in one of the club's teams now (or registered to its activity)?
create function public.player_in_club(p_player uuid, p_club uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_assignments a join teams t on t.id = a.team_id
                 where a.player_id = p_player and t.club_id = p_club and a.ended_on is null)
      or exists (select 1 from activity_registrations r join club_activities x on x.id = r.activity_id
                 where r.player_id = p_player and x.club_id = p_club and r.status <> 'cancelled');
$$;

-- Paid / reported / balance / state per charge. security_invoker: callers
-- only see the charges their own policies allow.
create view public.club_charge_balances with (security_invoker = true) as
select c.*,
  coalesce(p.paid, 0)::numeric(10, 2) as paid,
  coalesce(p.reported, 0)::numeric(10, 2) as reported,
  greatest(c.amount - coalesce(p.paid, 0), 0)::numeric(10, 2) as balance,
  case
    when c.status in ('waived', 'cancelled') then c.status
    when coalesce(p.paid, 0) >= c.amount then 'paid'
    when coalesce(p.paid, 0) > 0 then 'partial'
    when c.due_on < current_date then 'overdue'
    else 'open'
  end as state
from public.club_charges c
left join lateral (
  select sum(amount) filter (where status = 'confirmed') as paid,
         sum(amount) filter (where status = 'reported') as reported
  from public.club_payments where charge_id = c.id
) p on true;

-- -------------------------------------------------------- finance RPCs

-- Create the charges of a plan for the given children, or for every child
-- now in the plan's scope (team / program / whole club). Idempotent.
create function public.assign_fee_plan(p_plan uuid, p_players uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  pl club_fee_plans;
  v_n int := 0;
  i int;
  r record;
begin
  select * into pl from club_fee_plans where id = p_plan;
  if pl.id is null or pl.archived_at is not null then raise exception 'not_found'; end if;
  if not can_club_finance(pl.club_id, pl.team_id, 3) then raise exception 'not_allowed'; end if;
  for r in
    select distinct on (a.player_id) a.player_id, a.team_id
    from player_assignments a join teams t on t.id = a.team_id
    where a.ended_on is null and t.club_id = pl.club_id
      and (pl.team_id is null or a.team_id = pl.team_id)
      and (pl.program_id is null or t.program_id = pl.program_id)
      and (p_players is null or a.player_id = any (p_players))
    order by a.player_id, a.is_primary desc
  loop
    for i in 1 .. pl.installments loop
      insert into club_charges (club_id, player_id, team_id, plan_id, installment_no, title, amount, due_on)
      values (pl.club_id, r.player_id, coalesce(pl.team_id, r.team_id), pl.id, i,
              case when pl.installments > 1 then pl.title || ' · ' || i || '/' || pl.installments else pl.title end,
              pl.amount, (pl.first_due_on + make_interval(months => (i - 1) * pl.interval_months))::date)
      on conflict (plan_id, player_id, installment_no) where plan_id is not null do nothing;
      if found then v_n := v_n + 1; end if;
    end loop;
  end loop;
  return v_n;
end $$;

-- A charge added by hand (fine, kit, trip…).
create function public.add_club_charge(p_club uuid, p_player uuid, p_title text, p_amount numeric, p_due date, p_team uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_club_finance(p_club, p_team, 3) then raise exception 'not_allowed'; end if;
  if not player_in_club(p_player, p_club) then raise exception 'not_in_club'; end if;
  insert into club_charges (club_id, player_id, team_id, title, amount, due_on)
  values (p_club, p_player, p_team, p_title, p_amount, coalesce(p_due, current_date))
  returning id into v_id;
  return v_id;
end $$;

-- Waive, cancel or reopen a charge.
create function public.set_charge_status(p_charge uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare c club_charges := charge_row(p_charge);
begin
  if c.id is null then raise exception 'not_found'; end if;
  if not can_club_finance(c.club_id, c.team_id, 3) then raise exception 'not_allowed'; end if;
  if p_status not in ('open', 'waived', 'cancelled') then raise exception 'bad_status'; end if;
  update club_charges set status = p_status, closed_at = case when p_status = 'open' then null else now() end where id = p_charge;
end $$;

-- The treasurer records money received (confirmed at once).
create function public.record_club_payment(p_charge uuid, p_amount numeric, p_method text, p_paid_on date default null, p_note text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare c club_charges := charge_row(p_charge); v_id uuid;
begin
  if c.id is null then raise exception 'not_found'; end if;
  if not can_club_finance(c.club_id, c.team_id, 2) then raise exception 'not_allowed'; end if;
  insert into club_payments (charge_id, club_id, player_id, amount, method, status, paid_on, note, recorded_by, reviewed_at)
  values (c.id, c.club_id, c.player_id, p_amount, p_method, 'confirmed', coalesce(p_paid_on, current_date), coalesce(p_note, ''), auth.uid(), now())
  returning id into v_id;
  perform notify_users(guardian_ids(c.player_id), c.team_id, 'payment', 'התשלום התקבל: ' || c.title,
    '₪' || p_amount::text, '#pay', v_id);
  return v_id;
end $$;

-- A parent reports they paid (the treasurer confirms). Amount defaults to the balance.
create function public.report_club_payment(p_charge uuid, p_method text, p_note text default '', p_amount numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c club_charges := charge_row(p_charge); v_bal numeric; v_id uuid;
begin
  if c.id is null or c.status <> 'open' then raise exception 'charge_closed'; end if;
  if not is_my_child(c.player_id) then raise exception 'not_your_child'; end if;
  select balance into v_bal from club_charge_balances where id = c.id;
  if coalesce(p_amount, v_bal) <= 0 then raise exception 'nothing_to_pay'; end if;
  insert into club_payments (charge_id, club_id, player_id, amount, method, status, note, reported_by)
  values (c.id, c.club_id, c.player_id, coalesce(p_amount, v_bal), p_method, 'reported', coalesce(p_note, ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Confirm or reject a reported payment, or mark a confirmed one refunded.
create function public.review_club_payment(p_payment uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare p club_payments; c club_charges;
begin
  select * into p from club_payments where id = p_payment;
  if p.id is null then raise exception 'not_found'; end if;
  c := charge_row(p.charge_id);
  if not can_club_finance(c.club_id, c.team_id, 3) then raise exception 'not_allowed'; end if;
  if p_status not in ('confirmed', 'rejected', 'refunded') then raise exception 'bad_status'; end if;
  update club_payments set status = p_status, reviewed_at = now(), recorded_by = auth.uid() where id = p_payment;
  if p_status = 'confirmed' then
    perform notify_users(guardian_ids(c.player_id), c.team_id, 'payment', 'התשלום אושר: ' || c.title, '₪' || p.amount::text, '#pay', p.id);
  end if;
end $$;

-- Remind the parents of unpaid charges (given ids, or every overdue charge of
-- the club, partly paid ones included). A charge reminded in the last 3 days is skipped. Returns how many
-- charges were reminded.
create function public.send_payment_reminders(p_club uuid, p_charges uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0;
begin
  if not can_club_finance(p_club, null, 3) then raise exception 'not_allowed'; end if;
  for r in
    select b.* from club_charge_balances b
    where b.club_id = p_club and b.state in ('open', 'partial', 'overdue') and b.balance > 0
      and ((p_charges is null and b.due_on < current_date) or b.id = any (p_charges))
      and not exists (select 1 from club_reminders m where m.charge_id = b.id and m.sent_at > now() - interval '3 days')
  loop
    perform notify_users(guardian_ids(r.player_id), r.team_id, 'payment_reminder',
      'תזכורת לתשלום: ' || r.title,
      'נשאר לשלם ₪' || r.balance::text || ' · מועד: ' || to_char(r.due_on, 'DD.MM'), '#pay', r.id);
    insert into club_reminders (club_id, charge_id, player_id) values (p_club, r.id, r.player_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ----------------------------------------------------- activity RPCs

-- Sign-up counts and the club's name, for activities the caller can see
-- (a club that isn't verified yet is otherwise hidden from outside parents).
create function public.activity_counts(p_activities uuid[])
returns table (activity_id uuid, registered int, waitlist int, club_name text)
language sql stable security definer set search_path = public as $$
  select x.id,
    (select count(*)::int from activity_registrations r where r.activity_id = x.id and r.status = 'registered'),
    (select count(*)::int from activity_registrations r where r.activity_id = x.id and r.status = 'waitlist'),
    c.name
  from club_activities x join clubs c on c.id = x.club_id
  where x.id = any (p_activities)
    and (can_club_activities(x.club_id, 1) or (x.status <> 'draft' and (x.visibility = 'public' or is_club_member(x.club_id))));
$$;

-- Internal: give a registration its charge when the activity has a price.
create function public.activity_charge_for(p_reg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g activity_registrations; x club_activities; v_charge uuid;
begin
  select * into g from activity_registrations where id = p_reg;
  select * into x from club_activities where id = g.activity_id;
  if x.price > 0 and g.status = 'registered' and g.charge_id is null then
    insert into club_charges (club_id, player_id, activity_id, title, amount, due_on, created_by)
    values (x.club_id, g.player_id, x.id, x.title, x.price, least(coalesce(x.registration_closes_on, x.starts_on), x.starts_on), g.registered_by)
    returning id into v_charge;
    update activity_registrations set charge_id = v_charge where id = g.id;
  end if;
end $$;
revoke execute on function public.activity_charge_for(uuid) from public, anon, authenticated;

create function public.register_for_activity(p_activity uuid, p_player uuid, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare x club_activities; v_by int; v_taken int; v_status text; v_id uuid;
begin
  select * into x from club_activities where id = p_activity for update;
  if x.id is null or x.status <> 'open' then raise exception 'registration_closed'; end if;
  if x.registration_closes_on is not null and x.registration_closes_on < current_date then raise exception 'registration_closed'; end if;
  if x.visibility = 'club' and not is_club_member(x.club_id) and not can_club_activities(x.club_id, 1) then raise exception 'not_allowed'; end if;
  if not (is_my_child(p_player) or can_club_activities(x.club_id, 3)) then raise exception 'not_your_child'; end if;
  select birth_year into v_by from players where id = p_player;
  if v_by is not null and ((x.birth_year_min is not null and v_by < x.birth_year_min) or (x.birth_year_max is not null and v_by > x.birth_year_max)) then
    raise exception 'wrong_age';
  end if;
  if exists (select 1 from activity_registrations where activity_id = x.id and player_id = p_player and status <> 'cancelled') then
    raise exception 'already_registered';
  end if;
  select count(*) into v_taken from activity_registrations where activity_id = x.id and status = 'registered';
  v_status := case when x.capacity is not null and v_taken >= x.capacity then 'waitlist' else 'registered' end;
  insert into activity_registrations (activity_id, player_id, status, note)
  values (x.id, p_player, v_status, coalesce(p_note, '')) returning id into v_id;
  perform activity_charge_for(v_id);
  return v_status;
end $$;

-- Cancel a registration (the child's parent, or activity staff). An unpaid
-- charge is cancelled; the first child on the waitlist takes the place.
create function public.cancel_registration(p_reg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g activity_registrations; x club_activities; nxt activity_registrations; v_paid numeric;
begin
  select * into g from activity_registrations where id = p_reg;
  if g.id is null or g.status = 'cancelled' then raise exception 'not_found'; end if;
  select * into x from club_activities where id = g.activity_id for update;
  if not (is_my_child(g.player_id) or can_club_activities(x.club_id, 3)) then raise exception 'not_allowed'; end if;
  update activity_registrations set status = 'cancelled', cancelled_at = now() where id = g.id;
  if g.charge_id is not null then
    select paid into v_paid from club_charge_balances where id = g.charge_id;
    if coalesce(v_paid, 0) = 0 then
      update club_charges set status = 'cancelled', closed_at = now() where id = g.charge_id and status = 'open';
    end if;
  end if;
  if g.status = 'registered' then
    select * into nxt from activity_registrations
      where activity_id = x.id and status = 'waitlist' order by created_at limit 1 for update;
    if nxt.id is not null then
      update activity_registrations set status = 'registered' where id = nxt.id;
      perform activity_charge_for(nxt.id);
      perform notify_users(guardian_ids(nxt.player_id), null, 'activity', 'התפנה מקום: ' || x.title,
        'הילד עבר מרשימת ההמתנה לרשומים.', '#pay', x.id);
    end if;
  end if;
end $$;

-- Names (and the parents' name / phone) of children who have a charge or a
-- sign-up in this club, for its finance / activities staff. Children from
-- outside the club (camp sign-ups) are not otherwise visible to the club.
create function public.club_finance_people(p_club uuid, p_players uuid[])
returns table (player_id uuid, first_name text, last_name text, birth_year int, parents text)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.birth_year,
    coalesce((select string_agg(nullif(trim(concat_ws(' ', pr.full_name, nullif(pr.phone, ''))), ''), ', ')
              from player_guardians g join profiles pr on pr.id = g.user_id where g.player_id = p.id), '')
  from players p
  where p.id = any (p_players)
    and (can_club_finance(p_club, null, 1) or can_club_activities(p_club, 1))
    and (player_in_club(p.id, p_club)
         or exists (select 1 from club_charges c where c.player_id = p.id and c.club_id = p_club));
$$;

-- ------------------------------------------------------------------- RLS

alter table public.club_fee_plans enable row level security;
alter table public.club_charges enable row level security;
alter table public.club_payments enable row level security;
alter table public.club_reminders enable row level security;
alter table public.club_activities enable row level security;
alter table public.activity_registrations enable row level security;

create policy fee_plans_select on public.club_fee_plans for select to authenticated
  using (can_club_finance(club_id, team_id, 1));
create policy fee_plans_insert on public.club_fee_plans for insert to authenticated
  with check (can_club_finance(club_id, team_id, 3) and created_by = auth.uid());
create policy fee_plans_update on public.club_fee_plans for update to authenticated
  using (can_club_finance(club_id, team_id, 3)) with check (can_club_finance(club_id, team_id, 3));

-- charges: finance staff, or the child's parents. Writes go through RPCs,
-- except the title / due date edit below.
create policy charges_select on public.club_charges for select to authenticated
  using (can_club_finance(club_id, team_id, 1) or is_my_child(player_id));
create policy charges_update on public.club_charges for update to authenticated
  using (can_club_finance(club_id, team_id, 3)) with check (can_club_finance(club_id, team_id, 3));

create policy payments_select on public.club_payments for select to authenticated
  using (is_my_child(player_id) or can_club_finance(club_id, (charge_row(charge_id)).team_id, 1));

create policy reminders_select on public.club_reminders for select to authenticated
  using (can_club_finance(club_id, null, 1) or is_my_child(player_id));

create policy activities_select on public.club_activities for select to authenticated
  using (can_club_activities(club_id, 1)
         or (status <> 'draft' and (visibility = 'public' or is_club_member(club_id))));
create policy activities_insert on public.club_activities for insert to authenticated
  with check (can_club_activities(club_id, 3) and created_by = auth.uid());
create policy activities_update on public.club_activities for update to authenticated
  using (can_club_activities(club_id, 3)) with check (can_club_activities(club_id, 3));
-- no delete: an activity is cancelled (status = 'cancelled')

create policy registrations_select on public.activity_registrations for select to authenticated
  using (is_my_child(player_id) or can_club_activities(activity_club(activity_id), 1)
         or can_club_finance(activity_club(activity_id), null, 1));

grant select on public.club_charge_balances to authenticated;
grant select, insert, update on public.club_fee_plans, public.club_activities to authenticated;
grant select, update (title, due_on) on public.club_charges to authenticated;
grant select on public.club_payments, public.club_reminders, public.activity_registrations to authenticated;

revoke execute on function
  public.assign_fee_plan(uuid, uuid[]), public.add_club_charge(uuid, uuid, text, numeric, date, uuid),
  public.set_charge_status(uuid, text), public.record_club_payment(uuid, numeric, text, date, text),
  public.report_club_payment(uuid, text, text, numeric), public.review_club_payment(uuid, text),
  public.send_payment_reminders(uuid, uuid[]), public.activity_counts(uuid[]),
  public.register_for_activity(uuid, uuid, text), public.cancel_registration(uuid),
  public.guardian_ids(uuid), public.club_finance_people(uuid, uuid[])
from public, anon;
grant execute on function
  public.assign_fee_plan(uuid, uuid[]), public.add_club_charge(uuid, uuid, text, numeric, date, uuid),
  public.set_charge_status(uuid, text), public.record_club_payment(uuid, numeric, text, date, text),
  public.report_club_payment(uuid, text, text, numeric), public.review_club_payment(uuid, text),
  public.send_payment_reminders(uuid, uuid[]), public.activity_counts(uuid[]),
  public.register_for_activity(uuid, uuid, text), public.cancel_registration(uuid),
  public.club_finance_people(uuid, uuid[]), public.can_club_finance(uuid, uuid, int), public.can_club_activities(uuid, int)
to authenticated;
revoke execute on function public.guardian_ids(uuid) from authenticated;

do $$ begin raise notice 'iplays: club finance and activities installed'; end $$;

commit;
