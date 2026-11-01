/**
 * Matches, lineups and attendance (M4).
 * Server side: supabase/migrations/20261101500000_matches_lineups_attendance.sql
 */
import { supabase } from './supabase';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export type Competition = 'league' | 'cup' | 'friendly' | 'tournament';
export type MatchStatus = 'scheduled' | 'played' | 'canceled';
export type EventKind = 'training' | 'match';
export type MarkStatus = 'present' | 'absent' | 'late' | 'excused';
export type Effective = 'coming' | MarkStatus;

export const competitionLabel: Record<Competition, string> = { league: 'ליגה', cup: 'גביע', friendly: 'ידידות', tournament: 'טורניר' };
export const markLabel: Record<Effective, string> = {
  coming: 'מגיע/ה',
  present: 'נוכח/ת',
  absent: 'חסר/ה',
  late: 'איחור',
  excused: 'מוצדק',
};

export interface Match {
  id: string;
  team_id: string;
  starts_at: string;
  opponent: string;
  home: boolean;
  venue: string;
  competition: Competition;
  lineup_size: number | null;
  status: MatchStatus;
  score_for: number | null;
  score_against: number | null;
  note: string;
}

export interface Lineup {
  id: string;
  match_id: string;
  label: string;
  sort: number;
  published_at: string | null;
  players: LineupPlayer[];
}

export interface LineupPlayer {
  player_id: string;
  slot: number | null;
  position: string;
}

export interface AttendanceRow {
  player_id: string;
  first_name: string;
  last_name: string;
  shirt_number: number | null;
  expected: 'coming' | 'absent' | 'late';
  reason: string | null;
  report_note: string | null;
  reported_minutes_late: number | null;
  status: MarkStatus | null;
  minutes_late: number | null;
  effective: Effective;
}

export interface SummaryRow {
  player_id: string;
  first_name: string;
  last_name: string;
  events: number;
  present: number;
  late: number;
  absent: number;
  rate: number | null;
}

export function matchError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('match_lineup_players_match_idx')) return 'אותו שחקן לא יכול להיות בשני הרכבים של אותו משחק.';
  if (msg.includes('match_lineup_players_slot_idx')) return 'שני שחקנים באותה עמדה.';
  if (msg.includes('slot outside')) return 'יש יותר שחקנים מגודל ההרכב.';
  if (msg.includes('unpublish the lineup')) return 'קודם מבטלים את פרסום ההרכב.';
  if (msg.includes('too many lineups')) return 'אפשר עד 6 הרכבים למשחק.';
  if (msg.includes('no lineups')) return 'בענף הזה אין הרכבים.';
  if (msg.includes('not allowed') || msg.includes('row-level security')) return 'אין לך הרשאה לפעולה הזו.';
  return null;
}

const matchCols = 'id, team_id, starts_at, opponent, home, venue, competition, lineup_size, status, score_for, score_against, note';

export async function getMatches(teamId: string): Promise<Match[]> {
  const { data, error } = await db().from('team_matches').select(matchCols).eq('team_id', teamId).order('starts_at');
  if (error) throw error;
  return (data ?? []) as Match[];
}

export async function addMatch(input: {
  teamId: string;
  startsAt: string;
  opponent: string;
  home: boolean;
  venue: string;
  competition: Competition;
  lineupSize: number | null;
}) {
  const { error } = await db().from('team_matches').insert({
    team_id: input.teamId,
    starts_at: input.startsAt,
    opponent: input.opponent.trim(),
    home: input.home,
    venue: input.venue.trim(),
    competition: input.competition,
    lineup_size: input.lineupSize,
  });
  if (error) throw error;
}

export async function updateMatch(id: string, patch: Partial<Pick<Match, 'status' | 'score_for' | 'score_against' | 'venue' | 'starts_at' | 'note'>>) {
  const { error } = await db().from('team_matches').update(patch).eq('id', id);
  if (error) throw error;
}

export async function getLineups(matchId: string): Promise<Lineup[]> {
  const { data, error } = await db()
    .from('match_lineups')
    .select('id, match_id, label, sort, published_at, match_lineup_players (player_id, slot, position)')
    .eq('match_id', matchId)
    .order('sort');
  if (error) throw error;
  return (data ?? []).map(({ match_lineup_players, ...l }) => ({ ...l, players: (match_lineup_players ?? []) as LineupPlayer[] }));
}

export async function addLineup(matchId: string): Promise<string> {
  const { data, error } = await db().rpc('add_lineup', { p_match: matchId });
  if (error) throw error;
  return data as string;
}

export async function saveLineup(lineupId: string, players: LineupPlayer[], label?: string) {
  const { error } = await db().rpc('save_lineup', { p_lineup: lineupId, p_players: players, p_label: label ?? null });
  if (error) throw error;
}

export async function publishLineup(lineupId: string, publish: boolean) {
  const { error } = await db().rpc('publish_lineup', { p_lineup: lineupId, p_publish: publish });
  if (error) throw error;
}

export async function removeLineup(lineupId: string) {
  const { error } = await db().rpc('remove_lineup', { p_lineup: lineupId });
  if (error) throw error;
}

export async function eventAttendance(kind: EventKind, eventId: string): Promise<AttendanceRow[]> {
  const { data, error } = await db().rpc('event_attendance', { p_kind: kind, p_event: eventId });
  if (error) throw error;
  return (data ?? []) as AttendanceRow[];
}

export async function markAttendance(kind: EventKind, eventId: string, playerId: string, status: MarkStatus | null, minutesLate?: number | null) {
  const { error } = await db().rpc('mark_attendance', {
    p_kind: kind,
    p_event: eventId,
    p_player: playerId,
    p_status: status,
    p_minutes_late: minutesLate ?? null,
    p_note: '',
  });
  if (error) throw error;
}

export async function attendanceSummary(teamId: string, from: string, to: string): Promise<SummaryRow[]> {
  const { data, error } = await db().rpc('team_attendance_summary', { p_team: teamId, p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as SummaryRow[];
}
