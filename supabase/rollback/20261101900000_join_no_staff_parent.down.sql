-- Rollback of 20261101900000_join_no_staff_parent.sql: restores the previous
-- review_join_request and my_follow_requests. No data changes.

begin;

create or replace function public.review_join_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r join_requests%rowtype;
  v_player uuid;
  v_club uuid;
begin
  select * into r from join_requests where id = p_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if r.relation = 'parent' and not can(r.team_id, 'staff', 2) then
    raise exception 'not allowed to approve requests for this team' using errcode = '42501';
  end if;
  if r.relation = 'family' and not is_player_parent(r.player_id) then
    raise exception 'only the child''s parent can approve followers' using errcode = '42501';
  end if;

  if p_approve then
    insert into team_members (team_id, user_id, role) values (r.team_id, r.user_id, 'parent')
    on conflict (team_id, user_id) do nothing;
    v_player := r.player_id;
    if v_player is null then
      -- new child: create the profile and its assignment (trigger) in this team
      insert into players (team_id, first_name, last_name, birth_year, created_by)
      values (r.team_id, left(r.child_first, 40), left(r.child_last, 40), r.birth_year, r.user_id)
      returning id into v_player;
    end if;
    insert into player_guardians (player_id, user_id, relation) values (v_player, r.user_id, r.relation)
    on conflict (player_id, user_id) do nothing;
  end if;

  update join_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      player_id = coalesce(v_player, player_id), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  select club_id into v_club from teams where id = r.team_id;
  perform write_audit(case when p_approve then 'join.approve' else 'join.reject' end, v_club, 'join_request', p_id,
                      jsonb_build_object('team_id', r.team_id, 'user_id', r.user_id));
end;
$$;

drop function if exists public.my_follow_requests();
create function public.my_follow_requests()
returns table (id uuid, requester text, player_id uuid, child_name text, message text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, coalesce(nullif(pr.full_name, ''), coalesce(pr.email, pr.phone, '')), r.player_id,
         trim(p.first_name || ' ' || p.last_name), r.message, r.created_at
  from join_requests r
  join players p on p.id = r.player_id
  left join profiles pr on pr.id = r.user_id
  where r.status = 'pending' and r.relation = 'family'
    and exists (select 1 from player_guardians g where g.player_id = r.player_id and g.user_id = auth.uid() and g.relation = 'parent')
  order by r.created_at;
$$;

revoke all on function public.my_follow_requests(), public.review_join_request(uuid, boolean) from public, anon;
grant execute on function public.my_follow_requests(), public.review_join_request(uuid, boolean) to authenticated;

commit;
