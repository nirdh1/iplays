/**
 * League table and team roster from a screenshot (or PDF / Excel / CSV).
 *
 * The file is read for free in the browser by the same reader as the schedule
 * import (pdf.js / tesseract.js, see scheduleImport.ts). Nothing here talks to
 * the IFA site: the user takes the screenshot themselves.
 *
 * - League table: every row is shown for review, then saved as a "snapshot"
 *   (league_table_snapshots, supabase/migrations/20261103800000_league_table_snapshots.sql).
 *   It never changes the table computed from the IFA results; the app shows it
 *   next to that table, marked as "from a screenshot", with the differences.
 * - Roster: the names are compared with the team's roster; staff choose who
 *   to add and who to take off (history kept). No SQL needed.
 */
import { supabase } from './supabase';
import { normName, readTableFile, ScheduleReadError } from './scheduleImport';
import type { LeagueRow } from './leagueApi';
import type { Player } from './api';

export { ACCEPT, ScheduleReadError as TableReadError } from './scheduleImport';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/* ------------------------------------------------------------- tokens */

type Tok = { kind: 'num'; v: number; signed: boolean } | { kind: 'goals'; a: number; b: number } | { kind: 'word'; v: string };

const LETTERS = /[֐-׿a-zA-Z]/;

function tokens(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /(\d{1,3})(?:[-–:]|\s[-–:]\s)(\d{1,3})(?![\d./])|([+\-–]?)(\d{1,4})([-–](?!\d))?(?![\d./])|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1] != null) out.push({ kind: 'goals', a: +m[1], b: +m[2] });
    // "-10" and, as OCR of a right-to-left page often gives it, "10-"
    else if (m[4] != null) out.push({ kind: 'num', v: (m[3] && m[3] !== '+') || m[5] ? -+m[4] : +m[4], signed: !!(m[3] || m[5]) });
    else if (m[6] && LETTERS.test(m[6])) out.push({ kind: 'word', v: m[6] });
  }
  return out;
}

const cleanWord = (w: string) => w.replace(/^[^֐-׿a-zA-Z0-9"'׳״]+|[^֐-׿a-zA-Z0-9"'׳״.]+$/g, '');

/* -------------------------------------------------------- league table */

export interface DraftLeagueRow {
  key: string;
  include: boolean;
  pos: number;
  name: string;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  /** something did not add up: W+D+L, points, or columns that were not found */
  doubt: string;
}

const LEAGUE_HEADER = /קבוצה|נקודות|נק['׳]|משחקים|מש['׳]|team|pts/i;
const LEAGUE_NOISE = new Set(['מקום', 'קבוצה', 'טבלה', 'טבלת', 'ליגה', 'מחזור', 'עונה']);

/** Reads one table row; null when it is not a row of a league table. */
export function parseLeagueLine(row: string[], index: number): DraftLeagueRow | null {
  const line = row.join('  ');
  const toks = tokens(line);
  const words = toks.map((t, i) => ({ t, i })).filter((x) => x.t.kind === 'word');
  if (!words.length) return null;
  const first = words[0].i;
  const last = words[words.length - 1].i;
  const name = words
    .map((x) => cleanWord((x.t as { v: string }).v))
    .filter((w) => w && !LEAGUE_NOISE.has(w))
    .join(' ')
    .trim();
  if (!name || name.replace(/[^֐-׿a-zA-Z]/g, '').length < 2) return null;
  const nums = (from: number, to: number) => toks.slice(from, to).filter((t): t is Extract<Tok, { kind: 'num' }> => t.kind === 'num');
  let pre = nums(0, first);
  let post = nums(last + 1, toks.length);
  const goalsIn = (from: number, to: number) => toks.slice(from, to).find((t): t is Extract<Tok, { kind: 'goals' }> => t.kind === 'goals') ?? null;
  let goals = goalsIn(last + 1, toks.length);
  // a table read the other way round: the numbers before the name, the position after it
  if (post.length <= 1 && pre.length >= 4) {
    [pre, post] = [post, [...pre].reverse()];
    goals = goalsIn(0, first);
  }
  // a header row has words such as "קבוצה" / "נק'" and no numbers to read
  if (post.length + (goals ? 2 : 0) < 3) return null;
  if (LEAGUE_HEADER.test(line) && post.length === 0) return null;

  const fit = (seq: typeof post) => {
    for (let i = 0; i + 3 < seq.length; i++) {
      const [p, w, d, l] = seq.slice(i, i + 4).map((x) => x.v);
      if (p >= 0 && p <= 60 && w >= 0 && d >= 0 && l >= 0 && p === w + d + l) return { i, p, w, d, l, rest: seq.slice(i + 4) };
    }
    return null;
  };
  const f = fit(post) ?? fit([...post].reverse()) ?? (pre.length > 1 ? fit([...pre, ...post]) : null);

  const r: DraftLeagueRow = {
    key: `${index}-${name}`,
    include: true,
    pos: 0,
    name: name.slice(0, 60),
    played: null,
    won: null,
    drawn: null,
    lost: null,
    goals_for: null,
    goals_against: null,
    points: null,
    doubt: '',
  };
  const position = pre.length ? pre[pre.length - 1].v : NaN;
  r.pos = position >= 1 && position <= 40 ? position : 0;

  if (f) {
    Object.assign(r, { played: f.p, won: f.w, drawn: f.d, lost: f.l });
    const rest = f.rest.map((x) => x);
    // points: the last number (IFA puts them in the last column)
    const pts = rest.length ? rest[rest.length - 1] : null;
    r.points = pts && !pts.signed ? pts.v : f.w * 3 + f.d;
    const middle = pts && !pts.signed ? rest.slice(0, -1) : rest;
    let diff: number | null = null;
    let a: number | null = goals?.a ?? null;
    let b: number | null = goals?.b ?? null;
    const unsigned = middle.filter((x) => !x.signed);
    const signed = middle.find((x) => x.signed);
    if (a == null && unsigned.length >= 2) {
      a = unsigned[0].v;
      b = unsigned[1].v;
      if (unsigned.length >= 3) diff = unsigned[2].v;
    } else if (unsigned.length >= 1 && a != null) diff = unsigned[0].v;
    if (signed) diff = signed.v;
    if (a != null && b != null) {
      // with a goal difference column the order of the two numbers is known
      if (diff != null && diff !== 0 && a - b === -diff) [a, b] = [b, a];
      r.goals_for = a;
      r.goals_against = b;
    }
    const doubts: string[] = [];
    if (r.points !== f.w * 3 + f.d) doubts.push('הנקודות לא תואמות לניצחונות ותיקו (אולי הורדת נקודות)');
    if (a == null) doubts.push('לא זוהו שערים');
    else if (diff == null && a !== b) doubts.push('בדקו את סדר השערים (זכות / חובה)');
    r.doubt = doubts.join(' · ');
  } else {
    // no W-D-L that adds up: keep what we can, ask to fix
    const unsigned = post.filter((x) => !x.signed).map((x) => x.v);
    r.played = unsigned[0] ?? null;
    r.points = unsigned.length > 1 ? unsigned[unsigned.length - 1] : null;
    if (goals) {
      r.goals_for = goals.a;
      r.goals_against = goals.b;
    }
    r.doubt = 'לא הצלחנו לקרוא את כל העמודות. תקנו ידנית או בטלו את השורה';
    // one of W / D / L was lost by the OCR: the points tell which one
    const [p, a, b] = unsigned;
    const pts = r.points;
    if (unsigned.length >= 4 && p != null && a != null && b != null && pts != null) {
      const left = p - a - b;
      const tries: [number, number, number][] = [
        [a, b, left],
        [a, left, b],
        [left, a, b],
      ];
      const ok = left >= 0 ? tries.filter(([w, d, l]) => w >= 0 && d >= 0 && l >= 0 && w * 3 + d === pts) : [];
      if (ok.length === 1) {
        [r.won, r.drawn, r.lost] = ok[0];
        r.doubt = 'ערך אחד לא נקרא והושלם לפי הנקודות. בדקו';
      }
    }
  }
  return r;
}

export function parseLeagueRows(rows: string[][]): DraftLeagueRow[] {
  const out: DraftLeagueRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const r = parseLeagueLine(row, i);
    if (!r) return;
    const k = normName(r.name);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  });
  // positions: as read when they make sense, else the order of the rows
  const posOk = out.every((r) => r.pos > 0) && new Set(out.map((r) => r.pos)).size === out.length;
  if (!posOk) out.forEach((r, i) => (r.pos = i + 1));
  return out.sort((x, y) => x.pos - y.pos);
}

/**
 * The image is read twice (two OCR modes) and each misses different digits:
 * start from the better reading and replace each doubtful row with the same
 * team's row from the other reading when that one adds up.
 */
export function mergeLeagueReadings(lists: DraftLeagueRow[][]): DraftLeagueRow[] {
  const score = (rs: DraftLeagueRow[]) => rs.filter((r) => !r.doubt).length * 2 + rs.length;
  const sorted = [...lists].sort((x, y) => score(y) - score(x));
  const base = (sorted[0] ?? []).map((r) => ({ ...r }));
  for (const other of sorted.slice(1)) {
    for (const o of other) {
      const i = base.findIndex((r) => nameSimilarity(r.name, o.name) >= 0.85);
      if (i < 0) {
        if (!o.doubt) base.push({ ...o });
        continue;
      }
      const b = base[i];
      const rank = (r: DraftLeagueRow) => (!r.doubt ? 2 : r.won != null ? 1 : 0);
      if (rank(o) > rank(b)) base[i] = { ...o, pos: b.pos || o.pos, key: b.key };
    }
  }
  return base.sort((x, y) => x.pos - y.pos);
}

export async function readLeagueTableFile(file: File, onProgress?: (t: string) => void): Promise<{ rows: DraftLeagueRow[]; warning: string }> {
  const { readings, warning } = await readTableFile(file, onProgress);
  const best = mergeLeagueReadings(readings.map((rows) => parseLeagueRows(rows)));
  if (best.length < 2) throw new ScheduleReadError('לא מצאנו בקובץ טבלת ליגה. צלמו את הטבלה כולה, ישר וחד, עם שמות הקבוצות והמספרים.');
  return { rows: best, warning };
}

/* -------------------------------------------- matching names to rows */

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** 0..1: how sure we are that two names are the same team / player (OCR mistakes allowed). */
export function nameSimilarity(x: string, y: string): number {
  const a = normName(x);
  const b = normName(y);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const sa = a.split(' ').sort().join(' ');
  const sb = b.split(' ').sort().join(' ');
  if (sa === sb) return 0.98;
  const dist = lev(sa, sb);
  const close = 1 - dist / Math.max(sa.length, sb.length);
  const wa = new Set(a.split(' ').filter((w) => w.length > 1));
  const wb = new Set(b.split(' ').filter((w) => w.length > 1));
  const common = [...wa].filter((w) => wb.has(w)).length;
  const words = common / Math.max(1, wa.size, wb.size);
  return Math.max(close, words * 0.9);
}

export function bestMatch<T>(name: string, items: T[], nameOf: (t: T) => string, min = 0.75): T | null {
  let best: T | null = null;
  let bs = min;
  for (const it of items) {
    const s = nameSimilarity(name, nameOf(it));
    if (s > bs) {
      bs = s;
      best = it;
    }
  }
  return best;
}

/** Fills in the order of goals from the computed table when the screenshot did not show it. */
export function orientWithComputed(rows: DraftLeagueRow[], computed: LeagueRow[] | undefined): DraftLeagueRow[] {
  if (!computed?.length) return rows;
  return rows.map((r) => {
    const c = bestMatch(r.name, computed, (x) => x.name);
    if (!c || r.goals_for == null || r.goals_against == null) return r;
    if (r.goals_for !== r.goals_against && r.goals_for === c.goals_against && r.goals_against === c.goals_for) {
      return { ...r, goals_for: r.goals_against, goals_against: r.goals_for, doubt: r.doubt.replace(/ ?·? ?בדקו את סדר השערים \(זכות \/ חובה\)/, '').replace(/^ · /, '') };
    }
    return r;
  });
}

/* ------------------------------------------------- league snapshots API */

export interface SnapshotRow {
  pos: number;
  name: string;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
}

export interface LeagueSnapshot {
  id: string;
  team_id: string;
  taken_on: string;
  created_at: string;
  league_name: string;
  /** shown only to members of the team that uploaded it */
  uploaded_by_name: string | null;
  from_team_name: string;
  same_team: boolean;
  can_delete: boolean;
  rows: SnapshotRow[];
}

const missingFn = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST202' || e.code === '42883' || e.code === 'PGRST205' || /could not find the function|does not exist/i.test(e.message ?? '');

/** The latest screenshot table of the team's league; null when none (or the SQL is not run yet). */
export async function getLeagueSnapshot(teamId: string): Promise<LeagueSnapshot | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('team_league_snapshot', { p_team: teamId });
  if (error) {
    if (missingFn(error)) return null;
    throw error;
  }
  return (data as LeagueSnapshot | null) ?? null;
}

export async function saveLeagueSnapshot(teamId: string, rows: DraftLeagueRow[], takenOn: string): Promise<string> {
  const clean: SnapshotRow[] = rows
    .filter((r) => r.include && r.name.trim())
    .map(({ pos, name, played, won, drawn, lost, goals_for, goals_against, points }) => ({ pos, name: name.trim(), played, won, drawn, lost, goals_for, goals_against, points }));
  const { data, error } = await db().rpc('save_league_snapshot', { p_team: teamId, p_rows: clean, p_taken_on: takenOn });
  if (error) {
    if (missingFn(error)) throw new ScheduleReadError('השמירה עוד לא פעילה: צריך להריץ את קובץ ה-SQL של טבלה מצילום מסך.');
    throw error;
  }
  return data as string;
}

export async function deleteLeagueSnapshot(id: string): Promise<void> {
  const { error } = await db().rpc('delete_league_snapshot', { p_id: id });
  if (error) throw error;
}

export interface SnapshotDiff {
  /** computed row for each snapshot row (by position in the list), or null */
  match: (LeagueRow | null)[];
  /** snapshot rows whose games / points differ from the computed table */
  differs: boolean[];
  count: number;
}

export function compareSnapshot(snap: SnapshotRow[], computed: LeagueRow[] | undefined): SnapshotDiff {
  const match = snap.map((r) => (computed?.length ? bestMatch(r.name, computed, (x) => x.name) : null));
  const differs = snap.map((r, i) => {
    const c = match[i];
    if (!c) return false;
    return (r.played != null && r.played !== c.played) || (r.points != null && r.points !== c.points);
  });
  return { match, differs, count: differs.filter(Boolean).length };
}

/* --------------------------------------------------------------- roster */

export interface DraftRosterPlayer {
  key: string;
  name: string;
  shirt: number | null;
  birth_year: number | null;
  position: string;
}

const ROSTER_LABELS = new Set([
  'שם', 'שם השחקן', 'השחקן', 'שחקן', 'שחקנים', 'סגל', 'סגל השחקנים', 'מספר', 'מס', "מס'", 'תאריך', 'לידה', 'תאריך לידה', 'עמדה', 'גיל', 'לאום',
  'קבוצה', 'שנתון', 'פרטים', 'צוות', 'מאמן', 'מאמנים', 'סטטוס', 'פעיל', 'כרטיס', 'כרטיסים', 'שערים', 'הופעות', 'דקות',
]);
const POSITIONS: [RegExp, string][] = [
  [/^שוער$/, 'שוער'],
  [/^(מגן|בלם|הגנה)$/, 'הגנה'],
  [/^(קשר|קישור)$/, 'קישור'],
  [/^(חלוץ|התקפה|כנף)$/, 'התקפה'],
];

/** One row of a roster page; null when the row is a header, menu or anything that is not a player. */
export function parseRosterLine(row: string[], index: number, teamName = ''): DraftRosterPlayer | null {
  const line = row.join('  ');
  if (/\*{3,}/.test(line)) return null; // a name the IFA hides
  if (/https?:|www\.|@|©/i.test(line)) return null;
  let birth: number | null = null;
  const dm = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(line);
  if (dm) {
    let y = +dm[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    birth = y;
  }
  const rest = dm ? line.replace(dm[0], ' ') : line;
  const ym = /\b(19[5-9]\d|20[0-2]\d)\b/.exec(rest);
  if (!birth && ym) birth = +ym[1];
  const toks = tokens(ym ? rest.replace(ym[0], ' ') : rest);
  const nums = toks.filter((t): t is Extract<Tok, { kind: 'num' }> => t.kind === 'num' && !t.signed && t.v >= 1 && t.v <= 99);
  let position = '';
  const words: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'word') continue;
    const w = cleanWord(t.v);
    if (!w || !/[֐-׿a-zA-Z]{1,}/.test(w)) continue;
    const pos = POSITIONS.find(([re]) => re.test(w));
    if (pos) {
      position = pos[1];
      continue;
    }
    if (ROSTER_LABELS.has(w)) continue;
    words.push(w);
  }
  const name = words.join(' ').trim();
  if (!name || ROSTER_LABELS.has(name)) return null;
  if (words.length > 5) return null; // a sentence, a menu line
  // a single word is a name only when the row looks like a table row (a number or a date beside it)
  if (words.length === 1 && !nums.length && !birth) return null;
  if (name.replace(/[^֐-׿a-zA-Z]/g, '').length < 3) return null;
  if (teamName && nameSimilarity(name, teamName) > 0.8) return null;
  return {
    key: `${index}-${name}`,
    name: name.slice(0, 60),
    shirt: nums.length === 1 ? nums[0].v : null,
    birth_year: birth,
    position,
  };
}

export function parseRosterRows(rows: string[][], teamName = ''): DraftRosterPlayer[] {
  const out: DraftRosterPlayer[] = [];
  rows.forEach((row, i) => {
    const p = parseRosterLine(row, i, teamName);
    if (p && !out.some((q) => nameSimilarity(q.name, p.name) >= 0.98)) out.push(p);
  });
  // birth years: when most rows have one, a lone outlier is likely an OCR slip; keep as read, user reviews
  return out;
}

export async function readRosterFile(file: File, teamName: string, onProgress?: (t: string) => void): Promise<{ players: DraftRosterPlayer[]; warning: string }> {
  const { readings, warning } = await readTableFile(file, onProgress);
  let best: DraftRosterPlayer[] = [];
  // prefer the reading with more rows that look like table rows (a year or a number),
  // and fewer names that mix Hebrew with stray Latin letters (an OCR slip)
  const mixed = (n: string) => /[\u0590-\u05FF]/.test(n) && /[a-zA-Z]/.test(n);
  const sc = (x: DraftRosterPlayer[]) => x.reduce((a, p) => a + 1 + (p.birth_year || p.shirt ? 1 : 0) - (mixed(p.name) ? 2 : 0), 0);
  for (const rows of readings) {
    const ps = parseRosterRows(rows, teamName);
    if (sc(ps) > sc(best)) best = ps;
  }
  if (best.length === 0) throw new ScheduleReadError('לא מצאנו שמות שחקנים בקובץ. צלמו את רשימת הסגל, ישר וחד.');
  return { players: best, warning };
}

export interface RosterCompare {
  /** in the file, not in the team: proposed to add */
  added: (DraftRosterPlayer & { include: boolean })[];
  /** in both */
  same: { file: DraftRosterPlayer; player: Player }[];
  /** in the team, not in the file: proposed to take off (off by default) */
  missing: (Player & { include: boolean })[];
}

export const fullName = (p: Pick<Player, 'first_name' | 'last_name'>) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();

export function compareRoster(file: DraftRosterPlayer[], roster: Player[]): RosterCompare {
  const free = [...roster];
  const same: RosterCompare['same'] = [];
  const added: RosterCompare['added'] = [];
  for (const f of file) {
    const m = bestMatch(f.name, free, fullName, 0.8);
    if (m) {
      free.splice(free.indexOf(m), 1);
      same.push({ file: f, player: m });
    } else added.push({ ...f, include: true });
  }
  return { added, same, missing: free.map((p) => ({ ...p, include: false })) };
}

/** First word is the first name, the rest is the family name (the user can fix it later in the app). */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}
