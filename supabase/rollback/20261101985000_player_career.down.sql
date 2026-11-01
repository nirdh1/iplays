-- Rollback for 20261101985000_player_career.sql.
-- Removes the career functions and the read policies. The tables and their
-- data (assessments, fitness tests, measurements, medical clearances) and
-- the players.strong_foot column are kept; running the migration again
-- picks them up.

begin;

drop function if exists public.player_career(uuid);
drop function if exists public.season_label(date);
drop function if exists public.remove_player_metric(text, uuid);
drop function if exists public.add_fitness_test(uuid, uuid, text, numeric, date, text);
drop function if exists public.save_player_assessment(uuid, uuid, date, int, int, int, int, text);
drop function if exists public.metrics_check_player(uuid, uuid);
drop function if exists public.remove_player_record(text, uuid);
drop function if exists public.add_medical_clearance(uuid, date, date, text, text);
drop function if exists public.add_player_measurement(uuid, date, numeric, numeric, numeric, numeric, numeric, text);
drop policy if exists player_medical_read on public.player_medical_clearances;
drop policy if exists player_measurements_read on public.player_measurements;
drop function if exists public.can_view_player_medical(uuid);
drop function if exists public.can_edit_player_domain(uuid, text, int);

drop policy if exists player_assessments_read on public.player_assessments;
drop policy if exists player_fitness_tests_read on public.player_fitness_tests;
drop policy if exists fitness_test_types_read on public.fitness_test_types;
drop function if exists public.can_view_player_metrics(uuid);

commit;
