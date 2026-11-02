-- Rollback of 20261102300000_ifa_agent_games.sql (the games already imported stay).
drop function if exists public.agent_import_ifa_games(text, jsonb);
