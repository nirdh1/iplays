/**
 * IFA (football association) catalog import for the Super Admin.
 *
 * The IFA site blocks server requests (Cloudflare 403), so there is no live
 * sync. The admin saves a team's roster page in their own browser, uploads
 * the file here, sees what was found, and imports it. Parsing happens in the
 * page; the upsert runs on the server (import_ifa_team).
 * Server side: supabase/migrations/20261101800000_ifa_import.sql
 * Same rules as tools/ifa/ifa_collector.py --saved.
 */
import { supabase } from './supabase';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

const BASE = 'https://www.football.org.il';

export interface ParsedPlayer {
  ifa_player_id: string;
  name: string;
  profile_url: string;
}

export interface ParsedRoster {
  teamName: string | null;
  /** from links in the page itself (#teamStaff / player links); null if not stated */
  teamId: number | null;
  seasonId: number | null;
  players: ParsedPlayer[];
  staffSkipped: number;
  problems: string[];
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function param(href: string, key: string): string | null {
  try {
    return new URL(href, BASE).searchParams.get(key);
  } catch {
    return null;
  }
}

/** One value only if every link in the page agrees on it. */
function single(values: (string | null)[]): number | null {
  const set = new Set(values.filter((v): v is string => !!v && /^\d+$/.test(v)));
  return set.size === 1 ? Number([...set][0]) : null;
}

export function parseRosterHtml(html: string): ParsedRoster {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const problems: string[] = [];
  const box = doc.querySelector('#teamPlayers');
  const staff = doc.querySelector('#teamStaff');
  const h1 = clean(doc.querySelector('h1')?.textContent);
  const teamName = h1 ? clean(h1.replace(/^סגל שחקנים/, '')) || null : null;
  if (!teamName) problems.push('לא נמצאה כותרת <h1> עם שם הקבוצה.');

  const players: ParsedPlayer[] = [];
  const seen = new Set<string>();
  const playerLinks = box ? Array.from(box.querySelectorAll<HTMLAnchorElement>('a[href*="/players/player/"]')) : [];
  if (!box) problems.push('לא נמצא #teamPlayers בדף. ייתכן שנשמר דף אחר או לשונית אחרת.');
  for (const a of playerLinks) {
    const href = a.getAttribute('href') ?? '';
    const id = param(href, 'player_id');
    if (!id || !/^\d+$/.test(id)) {
      problems.push(`קישור שחקן בלי מזהה: ${href}`);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const name = clean(a.querySelector('.text')?.textContent) || clean(a.querySelector('img')?.getAttribute('alt'));
    if (!name) {
      problems.push(`שחקן ${id} בלי שם.`);
      continue;
    }
    players.push({ ifa_player_id: id, name, profile_url: new URL(href, BASE).toString() });
  }

  const staffLinks = staff ? Array.from(staff.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.getAttribute('href') ?? '') : [];
  const teamId = single(staffLinks.map((h) => param(h, 'team_id')));
  const seasonId = single([...staffLinks, ...playerLinks.map((a) => a.getAttribute('href') ?? '')].map((h) => param(h, 'season_id')));
  if (teamId === null) problems.push('מזהה הקבוצה לא מופיע בדף באופן חד-משמעי. יש להזין אותו ידנית.');
  if (seasonId === null) problems.push('מזהה העונה לא מופיע בדף באופן חד-משמעי. יש להזין אותו ידנית.');

  return { teamName, teamId, seasonId, players, staffSkipped: staff ? staff.querySelectorAll('.text').length : 0, problems };
}

export interface ImportResult {
  run_id: string;
  team_id: string;
  new_team: boolean;
  players_seen: number;
  new_players: number;
  not_in_payload: number[];
  errors: { player: unknown; error: string }[];
}

export async function importIfaTeam(input: { teamId: number; seasonId: number; teamName: string; sourceUrl: string; players: ParsedPlayer[] }) {
  const { data, error } = await db().rpc('import_ifa_team', {
    p: {
      ifa_team_id: input.teamId,
      ifa_season_id: input.seasonId,
      team_name: input.teamName,
      source_url: input.sourceUrl,
      sport: 'football',
      players: input.players,
    },
  });
  if (error) throw error;
  return data as ImportResult;
}

export interface RosterChangeRow {
  ifa_player_id: number;
  name?: string;
  old?: string;
  new?: string;
}

export interface RosterSyncResult {
  ok: boolean;
  applied?: boolean;
  run_id: string;
  error?: string;
  summary?: { players_in_payload: number; active_before: number; added: number; missing: number; returned: number; renamed: number };
  added?: RosterChangeRow[];
  missing?: RosterChangeRow[];
  returned?: RosterChangeRow[];
  renamed?: RosterChangeRow[];
  errors?: { player: unknown; error: string }[];
}

/** Dry run (apply=false) or apply. Never deletes: a player gone from the page is marked missing. */
export async function syncIfaRoster(
  input: { teamId: number; seasonId: number; teamName: string; sourceUrl: string; players: ParsedPlayer[]; allowLargeDrop?: boolean },
  apply: boolean,
): Promise<RosterSyncResult> {
  const { data, error } = await db().rpc('sync_ifa_roster', {
    p: {
      ifa_team_id: input.teamId,
      ifa_season_id: input.seasonId,
      team_name: input.teamName,
      source_url: input.sourceUrl,
      sport: 'football',
      players: input.players.map((x) => ({ ifa_player_id: x.ifa_player_id, name: x.name, profile_url: x.profile_url })),
      ...(input.allowLargeDrop ? { allow_large_drop: true } : {}),
    },
    p_apply: apply,
  });
  if (error) throw error;
  return data as RosterSyncResult;
}

export interface SyncRun {
  id: string;
  kind: string;
  source: string;
  counts: Record<string, unknown>;
  errors: { error: string }[];
  created_at: string;
  /** ok | partial | failed | skipped | dry_run (missing before the games migration) */
  status?: string;
}

export async function getSyncRuns(): Promise<SyncRun[]> {
  const { data, error } = await db().from('ifa_sync_runs').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as SyncRun[];
}

export interface SyncedTeam {
  ifa_season_id: number;
  ifa_team_id: number;
  name: string;
  team_id: string | null;
  players: number;
  synced_at: string;
}

export async function getSyncOverview(): Promise<SyncedTeam[]> {
  const { data, error } = await db().rpc('ifa_sync_overview');
  if (error) throw error;
  return (data ?? []) as SyncedTeam[];
}

export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await db().rpc('is_platform_admin');
  if (error) return false;
  return data === true;
}

/* ------------------------------------------------------------------ games */
// Saved IFA games pages (verified on season 28):
//   /team-details/team-games/?team_id=N&season_id=S  all games of one team
//   /leagues/games/?league_id=L&season_id=S           a window of dates; its teams dropdown gives the team ids
// Rows: .games_table a.table_row, labelled columns תאריך / משחק ("home - away") / אצטדיון / שעה / תוצאה,
// link /leagues/games/game/?game_id=N, where N = -1 for games that have no id yet.

export interface ParsedGame {
  ifa_game_id: string;
  date: string;
  time: string | null;
  home_ifa_team_id: number;
  away_ifa_team_id: number;
  home_name: string;
  away_name: string;
  venue: string;
  status: 'scheduled' | 'played';
  result_raw: string;
  home_score: number | null;
  away_score: number | null;
}

export interface ParsedGames {
  seasonId: number | null;
  leagueId: number | null;
  leagueName: string;
  teamId: number | null;
  sourceUrl: string;
  rows: number;
  games: ParsedGame[];
  teamsInDropdown: number;
  unmatched: { date: string; home: string; away: string }[];
  problems: string[];
}

function formQuery(doc: Document): URLSearchParams {
  const action = doc.querySelector('form')?.getAttribute('action') ?? '';
  return new URL(action, BASE).searchParams;
}

function dropdownTeams(doc: Document | null): Map<string, number> {
  const map = new Map<string, number>();
  doc?.querySelectorAll('select[id*="ddlTeams"] option').forEach((o) => {
    const v = (o as HTMLOptionElement).value;
    if (/^\d+$/.test(v)) map.set(clean(o.textContent), Number(v));
  });
  return map;
}

export function parseGamesHtml(gamesHtml: string, leagueHtml?: string): ParsedGames {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gamesHtml, 'text/html');
  const league = leagueHtml ? parser.parseFromString(leagueHtml, 'text/html') : null;
  const q = formQuery(doc);
  const lq = league ? formQuery(league) : new URLSearchParams();
  const teams = dropdownTeams(league ?? doc);
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
  const action = doc.querySelector('form')?.getAttribute('action') ?? '';
  const out: ParsedGames = {
    seasonId: num(q.get('season_id')) ?? num(lq.get('season_id')),
    leagueId: num(q.get('league_id')) ?? num(lq.get('league_id')),
    leagueName: clean((league ?? doc).querySelector('h1.page_main_title')?.textContent),
    teamId: num(q.get('team_id')),
    sourceUrl: action ? new URL(action, BASE).toString() : '',
    rows: 0,
    games: [],
    teamsInDropdown: teams.size,
    unmatched: [],
    problems: [],
  };
  const seen = new Set<string>();
  doc.querySelectorAll('.games_table a.table_row').forEach((a) => {
    out.rows += 1;
    const cols: Record<string, string> = {};
    a.querySelectorAll('.table_col').forEach((c) => {
      const label = clean(c.querySelector('.sr-only')?.textContent);
      c.querySelector('.sr-only')?.remove();
      cols[label] = clean(c.textContent);
    });
    const gid = param(a.getAttribute('href') ?? '', 'game_id') ?? '';
    const match = cols['משחק'] ?? '';
    const cut = match.indexOf(' - ');
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cols['תאריך'] ?? '');
    const time = cols['שעה'] ?? '';
    if (cut < 0 || !d || (time && !/^\d{1,2}:\d{2}$/.test(time))) {
      out.problems.push(`שורה לא תקינה: ${cols['תאריך'] ?? ''} ${match}`);
      return;
    }
    const home = clean(match.slice(0, cut));
    const away = clean(match.slice(cut + 3));
    const hid = teams.get(home);
    const aid = teams.get(away);
    if (hid === undefined || aid === undefined) {
      out.unmatched.push({ date: cols['תאריך'], home, away });
      return;
    }
    if (seen.has(`${hid}-${aid}`)) {
      out.problems.push(`אותו זוג קבוצות פעמיים: ${home} - ${away}`);
      return;
    }
    seen.add(`${hid}-${aid}`);
    const res = cols['תוצאה'] ?? '';
    const sm = /^(\d+)\s*-\s*(\d+)$/.exec(res);
    out.games.push({
      ifa_game_id: /^\d+$/.test(gid) && Number(gid) > 0 ? gid : '-1',
      date: `${d[3]}-${d[2]}-${d[1]}`,
      time: time || null,
      home_ifa_team_id: hid,
      away_ifa_team_id: aid,
      home_name: home,
      away_name: away,
      venue: cols['אצטדיון'] ?? '',
      status: res ? 'played' : 'scheduled',
      result_raw: res,
      home_score: sm ? Number(sm[1]) : null,
      away_score: sm ? Number(sm[2]) : null,
    });
  });
  return out;
}

export interface GamesImportResult {
  run_id: string;
  applied: boolean;
  new: number;
  changed: number;
  unchanged: number;
  queued: number;
  not_in_payload: { ifa_game_id: number | null; date: string; pairing: string }[];
  errors: { game: string; date?: string; error: string }[];
  changes: { ifa_game_id: number | null; pairing: string; change: 'new' | 'updated'; fields?: { field: string; old: string | null; new: string | null }[]; notify?: boolean }[];
}

/** apply = false: dry run (shows what would change, writes only the run log). */
export async function importIfaGames(p: ParsedGames, apply: boolean): Promise<GamesImportResult> {
  const payload = {
    ifa_season_id: p.seasonId,
    ifa_league_id: p.leagueId,
    league_name: p.leagueName || null,
    source_url: p.sourceUrl,
    scope: { kind: p.teamId ? 'team' : 'league', ifa_team_id: p.teamId },
    games: p.games,
  };
  const { data, error } = await db().rpc('import_ifa_games', { p: payload, p_apply: apply });
  if (error) throw error;
  return data as GamesImportResult;
}

export async function setTeamCategory(seasonId: number, teamId: number, category: string): Promise<string> {
  const { data, error } = await db().rpc('set_ifa_team_category', { p_season: seasonId, p_ifa_team: teamId, p_category: category });
  if (error) throw error;
  return data as string;
}

export type PushMode = 'off' | 'admins' | 'all';

export async function getPushMode(): Promise<PushMode> {
  const { data } = await db().from('app_settings').select('value').eq('key', 'push_mode').maybeSingle();
  return ((data?.value as PushMode | undefined) ?? 'off');
}

export async function setPushMode(mode: PushMode) {
  const { error } = await db().rpc('set_push_mode', { p_mode: mode });
  if (error) throw error;
}

export async function getQueueStats(): Promise<{ status: string; n: number; oldest: string }[]> {
  const { data, error } = await db().rpc('notification_queue_stats');
  if (error) return [];
  return data ?? [];
}

// ------------------------------------------------------------ local agent (pilot)

export interface SyncRequest {
  id: string;
  kind: 'roster';
  ifa_team_id: number;
  ifa_season_id: number;
  status: 'pending' | 'claimed' | 'checked' | 'applied' | 'failed' | 'canceled';
  requested_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  result: RosterSyncResult | null;
  error: string | null;
  fetch_info: { http_status?: number; players?: number; fetched_at?: string; url?: string };
  applied_at: string | null;
  applied_result: RosterSyncResult | null;
}

export interface AgentKey {
  id: string;
  name: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export async function requestIfaSync(teamId: number, seasonId: number): Promise<string> {
  const { data, error } = await db().rpc('request_ifa_sync', { p_ifa_team_id: teamId, p_ifa_season_id: seasonId });
  if (error) throw error;
  return data as string;
}

export async function getSyncRequests(): Promise<SyncRequest[]> {
  const { data, error } = await db().from('ifa_sync_requests').select('*').order('requested_at', { ascending: false }).limit(10);
  if (error) throw error;
  return (data ?? []) as SyncRequest[];
}

export async function applyIfaRequest(id: string, allowLargeDrop = false): Promise<RosterSyncResult> {
  const { data, error } = await db().rpc('apply_ifa_request', { p_request: id, p_allow_large_drop: allowLargeDrop });
  if (error) throw error;
  return data as RosterSyncResult;
}

export async function cancelIfaRequest(id: string) {
  const { error } = await db().rpc('cancel_ifa_request', { p_request: id });
  if (error) throw error;
}

export async function getAgentKeys(): Promise<AgentKey[]> {
  const { data, error } = await db().from('ifa_agent_keys').select('id, name, created_at, last_seen_at, revoked_at').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AgentKey[];
}

/** The key is returned once; only its hash is stored. */
export async function createAgentKey(name: string): Promise<string> {
  const { data, error } = await db().rpc('create_ifa_agent_key', { p_name: name });
  if (error) throw error;
  return data as string;
}

export async function revokeAgentKey(id: string) {
  const { error } = await db().rpc('revoke_ifa_agent_key', { p_id: id });
  if (error) throw error;
}

/** The IFA site page of a team linked to the IFA catalog (null when not linked or before the SQL is run). */
export async function teamIfaLink(teamId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('team_ifa_link', { p_team: teamId });
  if (error) return null; // function not installed yet: just no link
  const row = (data as { ifa_team_id: number; ifa_season_id: number }[] | null)?.[0];
  return row ? `${BASE}/team-details/?team_id=${row.ifa_team_id}&season_id=${row.ifa_season_id}` : null;
}
