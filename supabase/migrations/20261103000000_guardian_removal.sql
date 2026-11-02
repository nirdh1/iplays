-- iplays — removing a parent from a child.
--
-- Run after 20261102900000_ifa_repeat_pairings.sql.
-- Rollback: supabase/rollback/20261103000000_guardian_removal.down.sql
-- Additive: three new functions, no tables or data change.
--
-- Owner decision (2026-11-02):
--   * A parent can remove themselves from a child (e.g. they picked the wrong
--     child by mistake). They also leave the child's teams, unless they still
--     have another child there or a staff role.
--   * A platform admin (Super Admin) can remove anyone's link to a child, e.g.
--     after finding out the person is not really the parent. This is an
--     explicit write exception to the Super Admin's otherwise read-only access.
--     Every removal is written to the audit log with the reason.

begin;

-- Leaves the child's current teams where p_user is only a parent / follower
-- with no other child left there.
create or replace function public.drop_parent_membership(p_player uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from team_members m
  where m.user_id = p_user and m.role = 'parent'
    and m.team_id in (select a.team_id from player_assignments a where a.player_id = p_player and a.ended_on is null)
    and not exists (select 1 from player_guardians g join player_assignments a on a.player_id = g.player_id and a.ended_on is null
                    where g.user_id = p_user and a.team_id = m.team_id);
$$;

-- The caller removes themselves from a child (parent or family member).
create or replace function public.leave_child(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_relation text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from player_guardians where player_id = p_player and user_id = auth.uid()
  returning relation into v_relation;
  if v_relation is null then
    raise exception 'family member not found' using errcode = 'P0002';
  end if;
  perform drop_parent_membership(p_player, auth.uid());
  perform write_audit('family.leave', null, 'player', p_player, jsonb_build_object('relation', v_relation));
end;
$$;

-- Super Admin: children by name (or a parent by name / email) with everyone linked to them.
create or replace function public.admin_child_guardians(p_query text)
returns table (player_id uuid, child_name text, birth_year int, team_name text,
               user_id uuid, member_name text, member_email text, relation text, kinship text, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := trim(coalesce(p_query, ''));
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  return query
  with kids as (
    select distinct p.id
    from players p
    join player_guardians g on g.player_id = p.id
    left join profiles pr on pr.id = g.user_id
    where (p.first_name || ' ' || p.last_name) ilike '%' || v_q || '%'
       or coalesce(pr.full_name, '') ilike '%' || v_q || '%'
       or coalesce(pr.email, '') ilike '%' || v_q || '%'
    limit 30
  )
  select p.id, trim(p.first_name || ' ' || p.last_name), p.birth_year,
         (select string_agg(t.name, ', ') from player_assignments a join teams t on t.id = a.team_id
          where a.player_id = p.id and a.ended_on is null),
         g.user_id, coalesce(nullif(pr.full_name, ''), ''), coalesce(pr.email, pr.phone, ''),
         g.relation, g.kinship, g.created_at
  from kids k
  join players p on p.id = k.id
  join player_guardians g on g.player_id = p.id
  left join profiles pr on pr.id = g.user_id
  order by p.first_name, p.last_name, p.id, (g.relation <> 'parent'), g.created_at;
end;
$$;

-- Super Admin: remove a person's link to a child (they also leave its teams).
create or replace function public.admin_remove_guardian(p_player uuid, p_user uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_relation text;
begin
  if not is_platform_admin() then
    raise exception 'platform admins only' using errcode = '42501';
  end if;
  delete from player_guardians where player_id = p_player and user_id = p_user
  returning relation into v_relation;
  if v_relation is null then
    raise exception 'family member not found' using errcode = 'P0002';
  end if;
  perform drop_parent_membership(p_player, p_user);
  perform write_audit('family.admin_remove', null, 'player', p_player,
                      jsonb_build_object('user_id', p_user, 'relation', v_relation, 'reason', left(coalesce(p_reason, ''), 300)));
end;
$$;

revoke all on function public.drop_parent_membership(uuid, uuid), public.leave_child(uuid),
  public.admin_child_guardians(text), public.admin_remove_guardian(uuid, uuid, text) from public, anon;
revoke all on function public.drop_parent_membership(uuid, uuid) from authenticated;
grant execute on function public.leave_child(uuid), public.admin_child_guardians(text),
  public.admin_remove_guardian(uuid, uuid, text) to authenticated;

commit;
