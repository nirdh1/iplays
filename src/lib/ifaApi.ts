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

export interface SyncRun {
  id: string;
  kind: string;
  source: string;
  counts: Record<string, unknown>;
  errors: { error: string }[];
  created_at: string;
}

export async function getSyncRuns(): Promise<SyncRun[]> {
  const { data, error } = await db().from('ifa_sync_runs').select('id, kind, source, counts, errors, created_at').order('created_at', { ascending: false }).limit(30);
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
