-- iplays — "צור קשר / דיווח על תקלה / הצעת ייעול": in-app feedback.
--
-- Run after 20261101995000_inbox_notifications.sql (needs notify_users) and
-- 20261101200000_clubs_and_assignments.sql (platform_admins). No dependency
-- on any other migration that may not be installed yet.
-- Rollback: supabase/rollback/20261103600000_app_feedback.down.sql
-- Additive only: one new table, RPCs and two notification kinds.
--
-- A signed-in user sends a message of one of three kinds (bug / suggestion /
-- contact). The app attaches the page they came from and the browser, and
-- the server keeps the account's email so the admin can answer. Platform
-- admins get a bell notification, see every message in the Super Admin
-- panel (#adminfeedback), set a status and can write a reply; the sender gets
-- the reply in the bell and sees it under "הפניות שלי".
-- No email is sent from the server.

-- ------------------------------------------------------------- table

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'suggestion', 'contact')),
  message text not null check (char_length(message) between 1 and 4000),
  link text check (link is null or (char_length(link) <= 500 and link ~* '^https?://')),
  page text check (page is null or char_length(page) <= 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  contact_email text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'done')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) <= 2000),
  replied_at timestamptz,
  replied_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_feedback_user_idx on public.app_feedback (user_id, created_at desc);
create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at desc);

-- ------------------------------------------------------------- RLS

alter table public.app_feedback enable row level security;

-- the sender sees their own messages; platform admins see all
drop policy if exists app_feedback_select on public.app_feedback;
create policy app_feedback_select on public.app_feedback for select to authenticated
  using (user_id = auth.uid() or is_platform_admin());

-- no direct writes: everything goes through the RPCs below
revoke all on public.app_feedback from anon, authenticated;
grant select on public.app_feedback to authenticated;

-- ------------------------------------------------------------- notification kinds

do $$
declare
  v_def text;
  v_kinds text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conname = 'notification_outbox_kind_check' and conrelid = 'public.notification_outbox'::regclass;
  select coalesce(array_agg(distinct m[1]), '{}') into v_kinds
  from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') m;
  v_kinds := v_kinds || array['feedback', 'feedback_reply'];
  select array_agg(distinct k order by k) into v_kinds from unnest(v_kinds) k;
  alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
  execute format('alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind = any (%L::text[])) not valid',
                 v_kinds);
end;
$$;

-- ------------------------------------------------------------- RPCs

-- Send a message. At most 20 a day per user (spam guard).
create or replace function public.submit_feedback(
  p_kind text, p_message text, p_link text default null, p_page text default null, p_user_agent text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_msg text := btrim(coalesce(p_message, ''));
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_name text;
  v_label text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_kind not in ('bug', 'suggestion', 'contact') then raise exception 'bad kind'; end if;
  if v_msg = '' then raise exception 'empty message'; end if;
  if v_link is not null and v_link !~* '^https?://' then raise exception 'bad link'; end if;
  if (select count(*) from app_feedback where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many messages';
  end if;

  insert into app_feedback (user_id, kind, message, link, page, user_agent, contact_email)
  values (auth.uid(), p_kind, left(v_msg, 4000), left(v_link, 500), left(nullif(btrim(p_page), ''), 200),
          left(nullif(btrim(p_user_agent), ''), 400), (select email from auth.users where id = auth.uid()))
  returning id into v_id;

  select nullif(btrim(full_name), '') into v_name from profiles where id = auth.uid();
  v_label := case p_kind when 'bug' then 'דיווח על תקלה' when 'suggestion' then 'הצעת ייעול' else 'פנייה חדשה' end;
  perform notify_users(coalesce((select array_agg(user_id) from platform_admins), '{}'), null, 'feedback',
    v_label || coalesce(' מ' || v_name, ''), left(v_msg, 200), '#adminfeedback', v_id, null);
  return v_id;
end;
$$;

-- Platform admins: every message, newest first, with the sender's name.
create or replace function public.admin_feedback_list(p_status text default null)
returns table (
  id uuid, user_id uuid, sender text, contact_email text, kind text, message text, link text,
  page text, user_agent text, status text, admin_reply text, replied_at timestamptz,
  created_at timestamptz, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not is_platform_admin() then raise exception 'not allowed'; end if;
  return query
  select f.id, f.user_id, coalesce(nullif(btrim(p.full_name), ''), 'משתמש/ת'), f.contact_email, f.kind, f.message, f.link,
         f.page, f.user_agent, f.status, f.admin_reply, f.replied_at, f.created_at, f.updated_at
  from app_feedback f
  left join profiles p on p.id = f.user_id
  where p_status is null or f.status = p_status
  order by (f.status = 'done'), f.created_at desc
  limit 500;
end;
$$;

-- Platform admins: set the status and / or reply. A new or changed reply is
-- sent to the sender's bell.
create or replace function public.admin_update_feedback(p_id uuid, p_status text, p_reply text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  f app_feedback;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if not is_platform_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('new', 'in_progress', 'done') then raise exception 'bad status'; end if;
  select * into f from app_feedback where id = p_id for update;
  if not found then raise exception 'not found'; end if;

  update app_feedback set
    status = p_status,
    admin_reply = left(v_reply, 2000),
    replied_at = case when v_reply is distinct from f.admin_reply then case when v_reply is null then null else now() end else replied_at end,
    replied_by = case when v_reply is distinct from f.admin_reply then case when v_reply is null then null else auth.uid() end else replied_by end,
    updated_at = now()
  where id = p_id;

  if v_reply is not null and v_reply is distinct from f.admin_reply then
    perform notify_users(array[f.user_id], null, 'feedback_reply', 'קיבלת תשובה לפנייה שלך', left(v_reply, 200), '#feedback', p_id, null);
  end if;
end;
$$;

revoke all on function public.submit_feedback(text, text, text, text, text) from public, anon;
revoke all on function public.admin_feedback_list(text) from public, anon;
revoke all on function public.admin_update_feedback(uuid, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text) to authenticated;
grant execute on function public.admin_feedback_list(text) to authenticated;
grant execute on function public.admin_update_feedback(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
