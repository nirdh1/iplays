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
  /** 'ifa' = league game from the football association (official fields are read-only). */
  source?: 'club' | 'ifa';
  /** false: the IFA shows 00:00 or no time yet. */
  time_confirmed?: boolean;
  ifa_status?: string | null;
  /** Home team's usual ground while the IFA shows no venue (an estimate). */
  venue_hint?: string | null;
}

export const TIME_TBD = 'שעה טרם נקבעה';
export const VENUE_TBD = 'מיקום טרם נקבע';

/** "18:30", or "שעה טרם נקבעה" for an IFA game without a confirmed time. */
export function matchTimeLabel(m: Pick<Match, 'starts_at' | 'time_confirmed'>): string {
  if (m.time_confirmed === false) return TIME_TBD;
  return new Date(m.starts_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

/** When the match counts as over: 3 h after kickoff, or the end of the day while the time is not set yet. */
export function matchEndsAt(m: Pick<Match, 'starts_at' | 'time_confirmed'>): number {
  const start = new Date(m.starts_at);
  if (m.time_confirmed === false) {
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  }
  return start.getTime() + 3 * 3600_000;
}

/** Venue line: the official venue, else "מיקום טרם נקבע · כנראה: X". */
export function matchVenueLabel(m: Pick<Match, 'venue' | 'venue_hint' | 'source'>): string | null {
  if (m.venue) return m.venue;
  if (m.venue_hint) return `${VENUE_TBD} · כנראה: ${m.venue_hint}`;
  return m.source === 'ifa' ? VENUE_TBD : null;
}

/** The venue name to navigate to (official first, then the estimate). */
export const matchVenueName = (m: Pick<Match, 'venue' | 'venue_hint'>) => m.venue || m.venue_hint || '';

export interface VenueLocation {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  set_by_role: 'admin' | 'staff' | 'parent';
}

/** Waze link: exact point if known, else the address, else the venue name as a search. */
export function wazeUrl(name: string, loc?: VenueLocation | null): string {
  if (loc?.lat != null && loc.lng != null) return `https://waze.com/ul?ll=${loc.lat},${loc.lng}&navigate=yes`;
  return `https://waze.com/ul?q=${encodeURIComponent(loc?.address || name)}&navigate=yes`;
}

export async function getVenueLocations(names: string[]): Promise<Map<string, VenueLocation>> {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length === 0) return new Map();
  const { data, error } = await db().from('venue_locations').select('name, address, lat, lng, set_by_role').in('name', list);
  if (error) return new Map(); // table not installed yet: plain venue-name search still works
  return new Map((data as VenueLocation[]).map((v) => [v.name, v]));
}

export async function setVenueLocation(name: string, address: string, lat?: number | null, lng?: number | null) {
  const { error } = await db().rpc('set_venue_location', { p_name: name, p_address: address, p_lat: lat ?? null, p_lng: lng ?? null });
  if (error) throw error;
}

export interface GameUpdate {
  update_id: string;
  ifa_game_id: number | null;
  team_id: string;
  team_name: string;
  home_name: string;
  away_name: string;
  detected_at: string;
  kinds: string[];
  significant: boolean;
  notify: boolean;
  source: string;
  changes: { field: string; old: string | null; new: string | null }[];
  queued: number;
  sent: number;
}

export const changeFieldLabel: Record<string, string> = {
  date: 'תאריך',
  time: 'שעה',
  venue: 'מגרש',
  address: 'כתובת',
  status: 'סטטוס',
  result: 'תוצאה',
  ifa_game_id: 'מזהה משחק',
};

/** IFA game change history: one team, a whole club (club admin) or everything (Super Admin). */
export async function getGameHistory(opts: { teamId?: string; clubId?: string; limit?: number }): Promise<GameUpdate[]> {
  const { data, error } = await db().rpc('ifa_game_history', {
    p_team: opts.teamId ?? null,
    p_club: opts.clubId ?? null,
    p_limit: opts.limit ?? 100,
  });
  if (error) throw error;
  return (data ?? []) as GameUpdate[];
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
  if (msg.includes('set by the team staff')) return 'את הכתובת קבע צוות הקבוצה. אפשר לבקש מהמאמן לעדכן.';
  if (msg.includes('address or a map point')) return 'צריך למלא כתובת.';
  if (msg.includes('not allowed') || msg.includes('row-level security')) return 'אין לך הרשאה לפעולה הזו.';
  return null;
}

const baseCols = 'id, team_id, starts_at, opponent, home, venue, competition, lineup_size, status, score_for, score_against, note';
const ifaCols = `${baseCols}, source, time_confirmed, ifa_status, venue_hint`;
// Until the IFA games migration runs, those columns don't exist: fall back to the base set.
let matchCols = ifaCols;
const missingColumn = (e: { code?: string; message?: string }) => e.code === '42703' || /column .* does not exist/.test(e.message ?? '');

async function selectMatches<T>(run: (cols: string) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  let { data, error } = await run(matchCols);
  if (error && matchCols !== baseCols && missingColumn(error)) {
    matchCols = baseCols;
    ({ data, error } = await run(matchCols));
  }
  if (error) throw error;
  return data ?? [];
}

export async function getMatches(teamId: string): Promise<Match[]> {
  return selectMatches<Match>((cols) => db().from('team_matches').select(cols).eq('team_id', teamId).order('starts_at') as never);
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

/** Matches of several teams (club dashboard), between two dates (YYYY-MM-DD). */
export async function getClubMatches(teamIds: string[], from: string, to: string): Promise<Match[]> {
  return selectMatches<Match>(
    (cols) => db().from('team_matches').select(cols).in('team_id', teamIds).gte('starts_at', from).lt('starts_at', to).neq('status', 'canceled').order('starts_at') as never,
  );
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

/* ------------------------------------------------------------ live reporting
 * Server side: supabase/migrations/20261101971000_match_events.sql
 * Any team member reports goals / baskets as they happen; the live score is
 * the sum of the reports. score_for / score_against stay the official result.
 */

export type Side = 'home' | 'away';

export interface MatchEvent {
  id: string;
  side: Side;
  points: number;
  shirt_number: number | null;
  player_id: string | null;
  scorer_name: string | null;
  minute: number | null;
  created_at: string;
  created_by: string | null;
  reporter_name: string | null;
}

/** Reporting is open from 2 hours before kickoff to a day after (same window as the server). */
export function matchReportable(m: Pick<Match, 'starts_at' | 'status'>, now = Date.now()): boolean {
  const start = new Date(m.starts_at).getTime();
  return m.status !== 'canceled' && now >= start - 2 * 3600_000 && now <= start + 24 * 3600_000;
}

/** "LIVE" in lists: from 15 minutes before kickoff until the match counts as over. */
export function matchIsLive(m: Pick<Match, 'starts_at' | 'status' | 'time_confirmed'>, now = Date.now()): boolean {
  if (m.status === 'canceled') return false;
  if (m.time_confirmed === false) return false; // no kickoff time yet: don't claim it's on now
  return now >= new Date(m.starts_at).getTime() - 15 * 60_000 && now <= matchEndsAt(m);
}

/** Our goals / their goals from a list of reports. */
export function liveScore(events: Pick<MatchEvent, 'side' | 'points'>[], home: boolean) {
  let h = 0;
  let a = 0;
  for (const e of events) {
    if (e.side === 'home') h += e.points;
    else a += e.points;
  }
  return { home: h, away: a, for: home ? h : a, against: home ? a : h };
}

const liveMissing = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST202' || e.code === 'PGRST205' || /match_events/.test(e.message ?? '');

export async function getMatchEvents(matchId: string): Promise<MatchEvent[]> {
  const { data, error } = await db().rpc('match_events_feed', { p_match: matchId });
  if (error) {
    if (liveMissing(error)) return []; // migration not run yet
    throw error;
  }
  return (data ?? []) as MatchEvent[];
}

/** Live totals per match of one team (for lists), from the reports. */
export async function getTeamLiveScores(teamId: string): Promise<Map<string, { home: number; away: number }>> {
  const { data, error } = await db().from('match_events').select('match_id, side, points').eq('team_id', teamId).is('deleted_at', null);
  const out = new Map<string, { home: number; away: number }>();
  if (error) return out;
  for (const r of (data ?? []) as { match_id: string; side: Side; points: number }[]) {
    const cur = out.get(r.match_id) ?? { home: 0, away: 0 };
    cur[r.side] += r.points;
    out.set(r.match_id, cur);
  }
  return out;
}

export async function reportGoal(matchId: string, side: Side, shirt?: number | null, points = 1): Promise<string> {
  const { data, error } = await db().rpc('report_match_goal', { p_match: matchId, p_side: side, p_shirt: shirt ?? null, p_points: points });
  if (error) throw error;
  return data as string;
}

export async function setGoalScorer(eventId: string, shirt: number | null) {
  const { error } = await db().rpc('set_match_goal_scorer', { p_event: eventId, p_shirt: shirt });
  if (error) throw error;
}

export async function removeMatchEvent(eventId: string) {
  const { error } = await db().rpc('remove_match_event', { p_event: eventId });
  if (error) throw error;
}

/** Calls onChange whenever a report of this match is added, changed or removed (Supabase Realtime). */
export function subscribeMatchEvents(matchId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const ch = client
    .channel(`match-events-${matchId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(ch);
  };
}

export function liveError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('match not live')) return 'אפשר לדווח רק סביב מועד המשחק (משעתיים לפני ועד יום אחרי).';
  if (msg.includes('match canceled')) return 'המשחק בוטל.';
  if (msg.includes('too many reports')) return 'יותר מדי דיווחים למשחק הזה.';
  if (msg.includes('report not found')) return 'הדיווח כבר הוסר.';
  if (msg.includes('report_match_goal') || msg.includes('match_events')) return 'הדיווח בזמן אמת עוד לא הופעל בשרת (צריך להריץ את קובץ ה־SQL).';
  return null;
}
