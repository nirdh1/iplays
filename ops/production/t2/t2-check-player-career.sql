-- iPlays P0-T2: READ-ONLY check of player_career() and body-metrics access (Production).
-- Paste into the Supabase SQL Editor and Run. Changes nothing: it is one SELECT
-- (reads catalog + counts only; no insert/update/delete/DDL anywhere in this file).
-- Output: one table (section | item | value). No names, emails or ids:
-- function rules, privileges, policy text and aggregate counts only.

with
fn as (
  select p.oid, p.oid::regprocedure::text as sig, p.prosecdef, p.prosrc, p.proacl
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('player_career', 'can_view_player_metrics', 'can_view_player_medical',
                      'child_private_profile', 'is_player_parent', 'is_platform_admin',
                      'add_body_measurement', 'add_player_measurement')
),
out as (
  select 1 as ord, '1 player_career rule' as section, sig as item,
         case when prosrc like '%''measurements'', null%' then 'MEASUREMENTS_ALWAYS_NULL'
              when prosrc ~ '''measurements'',\s*case when v_metrics' then 'MEASUREMENTS_FOR_METRICS_STAFF'
              else 'UNKNOWN' end
         || ' | md5 ' || md5(prosrc) || ' | definer ' || prosecdef as value
  from fn where sig like 'player_career(%'
  union all
  select 2, '2 execute (anon/authenticated)', sig,
         has_function_privilege('anon', oid, 'EXECUTE')::text || ' / ' || has_function_privilege('authenticated', oid, 'EXECUTE')::text
  from fn
  union all
  select 3, '3 can_view_player_metrics body', 'definition',
         coalesce((select regexp_replace(prosrc, '\s+', ' ', 'g') from fn where sig like 'can_view_player_metrics(%' limit 1), 'MISSING')
  union all
  select 4, '4 policies', c.relname || ' / ' || coalesce(pol.polname, '(none)') || ' / ' || coalesce(pol.polcmd::text, ''),
         'rls ' || c.relrowsecurity || ' | ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
  from pg_class c left join pg_policy pol on pol.polrelid = c.oid
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('player_measurements', 'child_goals', 'child_goal_progress', 'child_nutrition', 'player_medical_clearances')
  union all
  select 5, '5 table grants', table_name || ' / ' || grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and table_name in ('player_measurements', 'child_goals', 'child_goal_progress', 'child_nutrition', 'player_medical_clearances')
  group by table_name, grantee
  union all
  select 6, '6 counts', 'measurement_rows_active', (select count(*) from player_measurements where deleted_at is null)::text
  union all
  select 6, '6 counts', 'players_with_measurements', (select count(distinct player_id) from player_measurements where deleted_at is null)::text
  union all
  select 6, '6 counts', 'staff_accounts_on_teams_of_measured_players', (
    select count(distinct tm.user_id) from player_measurements m
    join player_assignments a on a.player_id = m.player_id and a.ended_on is null
    join team_members tm on tm.team_id = a.team_id and tm.role <> 'parent'
    where m.deleted_at is null
      and not exists (select 1 from player_guardians g where g.player_id = m.player_id and g.user_id = tm.user_id and g.relation = 'parent'))::text
  union all
  select 6, '6 counts', 'platform_admin_accounts', (select count(*) from platform_admins)::text
  union all
  select 7, '7 medical (counts)', 'medical_docs_objects', (select count(*) from storage.objects where bucket_id = 'medical-docs')::text
  union all
  select 7, '7 medical (counts)', 'absences_sick_or_injury', (select count(*) from player_absences where reason in ('sick', 'injury'))::text
  union all
  select 7, '7 medical (counts)', 'absences_sick_or_injury_with_note', (select count(*) from player_absences where reason in ('sick', 'injury') and coalesce(btrim(note), '') <> '')::text
  union all
  select 7, '7 medical (counts)', 'clearances_total', (select count(*) from player_medical_clearances)::text
  union all
  select 7, '7 medical (counts)', 'clearances_with_note', (select count(*) from player_medical_clearances where coalesce(btrim(note), '') <> '')::text
)
select section, item, value from out order by ord, section, item;

