/**
 * League table, computed on the server from the IFA results (ifa_games).
 * Server side: supabase/migrations/20261102400000_league_table.sql
 * Only played games with an official IFA score count; live goals reported in
 * the app never move the table.
 */
import { supabase } from './supabase';

export interface LeagueRow {
  pos: number;
  ifa_team_id: number;
  name: string;
  app_team_id: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  /** last results, newest first: W / D / L */
  form: string;
  is_us?: boolean;
}

export interface LeagueTable {
  ifa_season_id: number;
  ifa_league_id: number;
  league_name: string | null;
  games_total: number;
  games_counted: number;
  games_awaiting_result: number;
  last_result_at: string | null;
  has_results: boolean;
  our_ifa_team_id?: number;
  rows: LeagueRow[];
}

/** The table of the team's IFA league; null when the team has no IFA league or the SQL is not run yet. */
export async function getTeamLeagueTable(teamId: string): Promise<LeagueTable | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('team_league_table', { p_team: teamId });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message)) return null;
    throw error;
  }
  return (data as LeagueTable | null) ?? null;
}

export function ourRow(t: LeagueTable): LeagueRow | undefined {
  return t.rows.find((r) => r.is_us);
}
