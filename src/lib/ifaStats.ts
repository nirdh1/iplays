/**
 * A child's numbers from their IFA player page, loaded from a file the family
 * saved (screenshot / PDF / Excel). Read for free in the browser (see
 * scheduleImport.readFileRows), checked by the parent, saved per season.
 * Shown next to the self-reported numbers, never mixed with them.
 * Server side: supabase/migrations/20261103200000_player_ifa_stats.sql
 */
import { supabase } from './supabase';
import { readFileRows } from './scheduleImport';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export const STAT_FIELDS = ['games', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red'] as const;
export type StatField = (typeof STAT_FIELDS)[number];
export type StatValues = Partial<Record<StatField, number | null>>;

export const statLabel: Record<StatField, string> = {
  games: 'הופעות',
  starts: 'בהרכב',
  minutes: 'דקות',
  goals: 'שערים',
  assists: 'בישולים',
  yellow: 'צהובים',
  red: 'אדומים',
};

export interface IfaStatsRow extends Record<StatField, number | null> {
  id: string;
  season: string;
  team_name: string;
  source_file: string;
  uploaded_at: string;
}

export interface IfaLinks {
  player_url: string | null;
  team_url: string | null;
  can_edit: boolean;
}

export async function getIfaLinks(playerId: string): Promise<IfaLinks> {
  const { data, error } = await db().rpc('player_ifa_links', { p_player: playerId });
  if (error) throw error;
  const r = (data ?? {}) as IfaLinks;
  const abs = (u: string | null) => (u ? (u.startsWith('http') ? u : `https://www.football.org.il${u.startsWith('/') ? '' : '/'}${u}`) : null);
  return { player_url: abs(r.player_url), team_url: r.team_url, can_edit: !!r.can_edit };
}

export async function getIfaStats(playerId: string): Promise<IfaStatsRow[] | null> {
  const { data, error } = await db()
    .from('player_ifa_stats')
    .select('id, season, team_name, games, starts, minutes, goals, assists, yellow, red, source_file, uploaded_at')
    .eq('player_id', playerId)
    .order('season', { ascending: false });
  if (error) {
    // table not installed yet: the section stays hidden
    if (error.code === '42P01' || /does not exist/.test(error.message)) return null;
    throw error;
  }
  return (data ?? []) as IfaStatsRow[];
}

export async function saveIfaStats(playerId: string, season: string, team: string, stats: StatValues, file: string) {
  const { error } = await db().rpc('save_ifa_stats', { p_player: playerId, p_season: season, p_team: team, p_stats: stats, p_file: file });
  if (error) throw error;
}

export async function removeIfaStats(id: string) {
  const { error } = await db().rpc('remove_ifa_stats', { p_id: id });
  if (error) throw error;
}

/** The season running now, as "2026/27" (seasons start in August). */
export function currentSeason(now = new Date()): string {
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

/* ------------------------------------------------------------- parsing */

const LABELS: Record<StatField, RegExp> = {
  games: /הופעות|משחקים|מש['׳]|הופ['׳]/,
  starts: /הרכב|פותח/,
  minutes: /דקות|דק['׳]/,
  goals: /שערים|שערי|גולים|כיבושים/,
  assists: /בישול|אסיסט/,
  yellow: /צהוב/,
  red: /אדום|אדומ/,
};

const numberIn = (s: string | undefined): number | null => {
  if (!s) return null;
  const m = /(?:^|[^\d/:.])(\d{1,5})(?![\d/:.])/.exec(` ${s} `);
  return m ? Number(m[1]) : null;
};
const labelOf = (cell: string): StatField | null => {
  for (const f of STAT_FIELDS) {
    // "starts" also matches inside other words; check the specific ones first
    if (LABELS[f].test(cell)) return f;
  }
  return null;
};

/**
 * Finds labelled numbers: "שערים 5" in one cell, a label cell next to a number
 * cell, or a header row of labels with a row of numbers under it (same column,
 * or the same order). Every value can be fixed by the parent before saving.
 */
export function parseIfaStats(rows: string[][]): { values: StatValues; season: string | null; found: number } {
  const values: StatValues = {};
  let season: string | null = null;
  const set = (f: StatField, n: number | null) => {
    if (n == null || values[f] != null) return;
    values[f] = n;
  };
  rows.forEach((row, i) => {
    const line = row.join(' ');
    if (!season) {
      const sm = /(20\d{2})\s*[/-]\s*(20)?(\d{2})/.exec(line);
      if (sm && Number(sm[3]) === (Number(sm[1]) + 1) % 100) season = `${sm[1]}/${sm[3]}`;
    }
    const labels = row.map(labelOf);
    const labelCount = labels.filter(Boolean).length;
    // header row: the values are in the next row with numbers
    if (labelCount >= 2) {
      const next = rows.slice(i + 1, i + 3).find((r) => r.filter((c) => numberIn(c) != null).length >= 2);
      if (next) {
        const nums = next.map((c) => (labelOf(c) ? null : numberIn(c)));
        const sameShape = next.length === row.length;
        const numsOnly = nums.filter((n): n is number => n != null);
        let k = 0;
        labels.forEach((f, j) => {
          if (!f) return;
          set(f, sameShape ? nums[j] : numsOnly[k]);
          k++;
        });
        return;
      }
    }
    row.forEach((cell, j) => {
      const f = labels[j];
      if (!f) return;
      set(f, numberIn(cell.replace(LABELS[f], ' ')) ?? numberIn(row[j + 1]) ?? numberIn(row[j - 1]));
    });
  });
  return { values, season, found: Object.values(values).filter((v) => v != null).length };
}

export async function readIfaStatsFile(file: File, onProgress?: (t: string) => void) {
  const { readings, fromImage } = await readFileRows(file, onProgress);
  let best = parseIfaStats(readings[0]);
  for (const r of readings.slice(1)) {
    const p = parseIfaStats(r);
    if (p.found > best.found) best = p;
  }
  return { ...best, fromImage };
}
