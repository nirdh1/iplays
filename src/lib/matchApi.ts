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

export async function updateMatch(
  id: string,
  patch: Partial<Pick<Match, 'status' | 'score_for' | 'score_against' | 'venue' | 'starts_at' | 'note' | 'opponent' | 'home' | 'competition' | 'lineup_size'>>,
) {
  const { data, error } = await db().from('team_matches').update(patch).eq('id', id).select('id');
  if (error) throw error;
  // row-level security skips a row silently: nothing changed = not allowed
  if (!data || data.length === 0) throw new Error('not allowed');
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

export type EventKind2 = 'goal' | 'yellow' | 'red';

export interface MatchEvent {
  id: string;
  kind?: EventKind2;
  period?: number | null;
  clock_seconds?: number | null;
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
export function liveScore(events: Pick<MatchEvent, 'side' | 'points' | 'kind'>[], home: boolean) {
  let h = 0;
  let a = 0;
  for (const e of events) {
    if (e.kind && e.kind !== 'goal') continue;
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
  const { data, error } = await db().from('match_events').select('match_id, side, points').eq('team_id', teamId).eq('kind', 'goal').is('deleted_at', null);
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

/** Calls onChange whenever anything live about this match changes: events, pending reports, clock, reporter (Supabase Realtime). */
export function subscribeMatchEvents(matchId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  let ch = client.channel(`match-live-${matchId}`);
  for (const table of ['match_events', 'match_reports', 'match_live', 'match_reporter_queue']) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `match_id=eq.${matchId}` }, () => onChange());
  }
  ch.subscribe();
  return () => {
    void client.removeChannel(ch);
  };
}

export function liveError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('match not live')) return 'אפשר לדווח רק סביב מועד המשחק (משעתיים לפני ועד יום אחרי).';
  if (msg.includes('match canceled')) return 'המשחק בוטל.';
  if (msg.includes('too many reports')) return 'יותר מדי דיווחים למשחק הזה.';
  if (msg.includes('report not found')) return 'הדיווח כבר טופל או הוסר.';
  if (msg.includes('reporter taken')) return 'מישהו אחר כבר מדווח. אפשר להצטרף לתור.';
  if (msg.includes('offer pending')) return 'התפקיד הוצע כרגע להורה אחר בתור. אפשר להצטרף לתור.';
  if (msg.includes('offer expired')) return 'עברו 60 השניות והתפקיד עבר להורה הבא בתור.';
  if (msg.includes('not the reporter')) return 'רק המדווח/ת הראשי/ת יכול/ה לעשות את זה.';
  if (msg.includes('already final')) return 'התוצאה הסופית כבר אושרה. תיקון: דרך המאמן.';
  if (msg.includes('finish the match first')) return 'קודם מסיימים את המשחק.';
  if (msg.includes('clock action not possible')) return 'השעון כבר עודכן ממכשיר אחר.';
  if (msg.includes('choose the team')) return 'צריך לבחור לאיזו קבוצה.';
  if (/submit_match_report|match_live_state|report_match_goal|match_events/.test(msg)) return 'הדיווח בזמן אמת עוד לא הופעל בשרת (צריך להריץ את קובץ ה־SQL).';
  return null;
}

/* ------------------------------------------------- live session (spec 16-17)
 * Server side: supabase/migrations/20261102600000_live_match_session.sql
 */

export type LiveStatus = 'not_started' | 'running' | 'break' | 'finished';

export interface LiveState {
  status: LiveStatus;
  period: number;
  /** game clock in seconds, computed on the server when this was read */
  clock_seconds: number;
  running: boolean;
  server_now: string;
  reporter_id?: string | null;
  reporter_label?: string | null;
  offer_to?: string | null;
  offer_label?: string | null;
  offer_seconds_left?: number | null;
  queue: { user_id: string; label: string }[];
  final_home?: number | null;
  final_away?: number | null;
  finalized_at?: string | null;
  staff: boolean;
}

export interface PendingReport {
  id: string;
  kind: EventKind2;
  side: Side | null;
  points: number;
  shirt_number: number | null;
  player_id: string | null;
  scorer_name: string | null;
  minute: number | null;
  confirmations: number;
  created_at: string;
  created_by: string | null;
  reporter_name: string | null;
}

/** null: the session part is not installed yet (PR #21 behaviour only). */
export async function getLiveState(matchId: string): Promise<LiveState | null> {
  const { data, error } = await db().rpc('match_live_state', { p_match: matchId });
  if (error) {
    if (liveMissing(error) || /match_live_state/.test(error.message ?? '')) return null;
    throw error;
  }
  return (data ?? null) as LiveState | null;
}

export async function getPendingReports(matchId: string): Promise<PendingReport[]> {
  const { data, error } = await db().rpc('match_reports_feed', { p_match: matchId });
  if (error) return [];
  return (data ?? []) as PendingReport[];
}

export async function submitReport(
  matchId: string,
  r: { kind?: EventKind2; side?: Side | null; shirt?: number | null; points?: number; name?: string | null },
): Promise<{ applied: boolean; id: string; merged: boolean }> {
  const { data, error } = await db().rpc('submit_match_report', {
    p_match: matchId,
    p_kind: r.kind ?? 'goal',
    p_side: r.side ?? null,
    p_shirt: r.shirt ?? null,
    p_points: r.points ?? 1,
    p_name: r.name ?? null,
  });
  if (error) throw error;
  return data as { applied: boolean; id: string; merged: boolean };
}

export async function updateReport(reportId: string, side: Side | null, shirt: number | null, name?: string | null) {
  const { error } = await db().rpc('update_match_report', { p_report: reportId, p_side: side, p_shirt: shirt, p_name: name ?? null });
  if (error) throw error;
}

export async function reviewReport(reportId: string, approve: boolean, side?: Side | null) {
  const { error } = await db().rpc('review_match_report', { p_report: reportId, p_approve: approve, p_side: side ?? null, p_shirt: null, p_points: null });
  if (error) throw error;
}

async function liveRpc(fn: string, args: Record<string, unknown>) {
  const { error } = await db().rpc(fn, args);
  if (error) throw error;
}

export const claimReporter = (matchId: string, force = false) => liveRpc('claim_match_reporter', { p_match: matchId, p_force: force });
export const joinReporterQueue = (matchId: string) => liveRpc('join_reporter_queue', { p_match: matchId });
export const leaveReporterQueue = (matchId: string) => liveRpc('leave_reporter_queue', { p_match: matchId });
export const releaseReporter = (matchId: string) => liveRpc('release_match_reporter', { p_match: matchId });
export const answerReporterOffer = (matchId: string, accept: boolean) => liveRpc('answer_reporter_offer', { p_match: matchId, p_accept: accept });
export const matchClock = (matchId: string, action: 'start' | 'end_period' | 'start_period' | 'finish' | 'reopen') =>
  liveRpc('match_clock', { p_match: matchId, p_action: action });
export const finalizeResult = (matchId: string, home: number, away: number) =>
  liveRpc('finalize_match_result', { p_match: matchId, p_home: home, p_away: away });

/** "12:05" from seconds. */
export function clockLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------- coach overrides on IFA games */
// supabase/migrations/20261102200000_match_overrides.sql: staff can set their own
// value for one field of an IFA game; it wins over the IFA until they release it.
// A later, different IFA value is a conflict they resolve.

export type OverrideField = 'starts_at' | 'venue' | 'status' | 'score';

export interface MatchOverride {
  match_id: string;
  field: OverrideField;
  value: unknown;
  ifa_value: unknown;
  conflict_ifa_value: unknown;
  conflict_at: string | null;
}

export interface MatchConflict {
  match_id: string;
  team_id: string;
  team_name: string;
  opponent: string;
  starts_at: string;
  field: OverrideField;
  mine: unknown;
  ifa: unknown;
  conflict_at: string;
}

/** Active overrides of one match (staff only; empty if the SQL is not installed yet). */
export async function getMatchOverrides(matchId: string): Promise<MatchOverride[]> {
  const { data, error } = await db()
    .from('team_match_overrides')
    .select('match_id, field, value, ifa_value, conflict_ifa_value, conflict_at')
    .eq('match_id', matchId)
    .eq('status', 'active');
  if (error) return [];
  return (data ?? []) as MatchOverride[];
}

export async function setMatchOverride(matchId: string, field: OverrideField, value: unknown) {
  const { error } = await db().rpc('set_match_override', { p_match: matchId, p_field: field, p_value: value });
  if (error) throw error;
}

export async function releaseMatchOverride(matchId: string, field: OverrideField) {
  const { error } = await db().rpc('release_match_override', { p_match: matchId, p_field: field });
  if (error) throw error;
}

export async function resolveMatchConflict(matchId: string, field: OverrideField, keepMine: boolean) {
  const { error } = await db().rpc('resolve_match_conflict', { p_match: matchId, p_field: field, p_keep_mine: keepMine });
  if (error) throw error;
}

export async function myMatchConflicts(): Promise<MatchConflict[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('my_match_conflicts');
  if (error) return [];
  return (data ?? []) as MatchConflict[];
}

export const OVERRIDE_FIELD_LABEL: Record<OverrideField, string> = {
  starts_at: 'מועד',
  venue: 'מגרש',
  status: 'סטטוס',
  score: 'תוצאה',
};

/** A stored override value as text, e.g. "12/12 · 10:00", "3 : 1". */
export function overrideValueLabel(field: OverrideField, v: unknown): string {
  if (v == null) return '—';
  if (field === 'starts_at') {
    const o = v as { starts_at?: string; time_confirmed?: boolean };
    if (!o.starts_at) return '—';
    const d = new Date(o.starts_at);
    const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
    return o.time_confirmed === false ? `${date} · ${TIME_TBD}` : `${date} · ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (field === 'venue') return (v as string) || VENUE_TBD;
  if (field === 'status') return ({ scheduled: 'מתוכנן', played: 'שוחק', canceled: 'בוטל' } as Record<string, string>)[v as string] ?? String(v);
  const [a, b] = v as [number | null, number | null];
  return a == null || b == null ? 'ללא תוצאה' : `${a} : ${b}`;
}
