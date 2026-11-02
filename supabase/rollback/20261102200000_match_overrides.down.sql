-- Rollback of 20261102200000_match_overrides.sql: drops the trigger, functions
-- and read policy. The team_match_overrides table and its rows are kept; the
-- IFA game rows keep the values they show now and follow the IFA again at the
-- next sync.
begin;
drop trigger if exists team_matches_keep_overrides on public.team_matches;
drop function if exists public.my_match_conflicts();
drop function if exists public.resolve_match_conflict(uuid, text, boolean);
drop function if exists public.release_match_override(uuid, text);
drop function if exists public.set_match_override(uuid, text, jsonb);
drop function if exists public.match_write_field(uuid, text, jsonb);
drop function if exists public.team_matches_keep_overrides();
drop function if exists public.match_put_field(public.team_matches, text, jsonb);
drop function if exists public.match_override_value(text, jsonb);
drop function if exists public.match_field_value(public.team_matches, text);
drop policy if exists team_match_overrides_select on public.team_match_overrides;
commit;
