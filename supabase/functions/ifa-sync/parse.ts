/**
 * Parsers for the public pages on football.org.il.
 *
 * NOT WRITTEN YET: the sandbox that built this could not reach
 * football.org.il, and these must be written against the real pages, not
 * guessed. Each function gets the raw HTML (or JSON) of one page and returns
 * rows shaped like the ifa_* tables. Until then they throw, so the sync job
 * fails loudly instead of writing wrong data.
 */

export interface LeagueRow {
  id: string;
  season: string;
  age_group: string;
  tier: string;
  district: string;
  name: string;
  url: string;
}

export interface TeamRow {
  id: string;
  league_id: string;
  name: string;
  club: string;
  url: string;
}

export interface MatchRow {
  id: string;
  league_id: string;
  round: number | null;
  kickoff: string | null; // ISO, Asia/Jerusalem converted to UTC
  home_team_id: string | null;
  away_team_id: string | null;
  home_name: string;
  away_name: string;
  venue: string;
  venue_address: string;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'played' | 'postponed' | 'cancelled';
}

export interface StandingRow {
  league_id: string;
  team_id: string;
  team_name: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

export interface PlayerRow {
  team_id: string;
  player_id: string;
  first_name: string;
  last_name: string;
  shirt_number: number | null;
  birth_year: number | null;
}

const pending = (what: string) => new Error(`ifa-sync: ${what} parser not written yet (needs the real football.org.il page)`);

/** The leagues index for a season, filtered to youth age groups. */
export function parseLeagues(_html: string, _season: string): LeagueRow[] {
  throw pending('leagues');
}

/** One league page: its teams, fixtures/results and table. */
export function parseLeague(_html: string, _leagueId: string): { teams: TeamRow[]; matches: MatchRow[]; standings: StandingRow[] } {
  throw pending('league');
}

/** One team page: its published squad. */
export function parseSquad(_html: string, _teamId: string): PlayerRow[] {
  throw pending('squad');
}
