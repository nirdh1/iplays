/**
 * Load a team's game schedule from a file: image (screenshot / photo), PDF,
 * Excel (.xlsx) or CSV.
 *
 * - Images and PDFs are read by the read-schedule Edge Function (Claude).
 * - Spreadsheets are converted to rows in the browser. They go to the same
 *   function when it is set up; otherwise a column-name parser reads them.
 * Nothing is saved until the user reviews the games and taps save, which calls
 * import_team_matches (supabase/migrations/20261103100000_schedule_import.sql).
 */
import { supabase } from './supabase';
import type { Competition } from './matchApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export interface DraftGame {
  key: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, '' = unknown
  opponent: string;
  home: boolean;
  venue: string;
  competition: Competition;
  round: string;
  include: boolean;
  duplicate?: boolean;
}

export interface ReadResult {
  games: DraftGame[];
  warning: string;
  via: 'ai' | 'columns';
}

export class ScheduleReadError extends Error {}

const EXCEL_EXT = /\.(xlsx|xlsm)$/i;
const CSV_EXT = /\.(csv|tsv|txt)$/i;

export const ACCEPT = 'image/*,application/pdf,.pdf,.xlsx,.xlsm,.csv,.tsv';

export async function readScheduleFile(file: File, teamId: string, teamName: string): Promise<ReadResult> {
  const name = file.name || '';
  if (/\.xls$/i.test(name)) throw new ScheduleReadError('קובץ אקסל ישן (xls). שמרו אותו כ-xlsx ונסו שוב.');
  if (EXCEL_EXT.test(name) || CSV_EXT.test(name) || file.type === 'text/csv') {
    const rows = EXCEL_EXT.test(name) ? await readXlsx(file) : parseCsv(await file.text());
    const clean = rows.filter((r) => r.some((c) => c.trim()));
    if (clean.length === 0) throw new ScheduleReadError('הקובץ ריק.');
    const tsv = clean.map((r) => r.map((c) => c.replace(/[\t\n\r]+/g, ' ').trim()).join('\t')).join('\n');
    try {
      return await askAi(teamId, teamName, { kind: 'text', data: tsv.slice(0, 190_000), file_name: name });
    } catch (e) {
      if (!(e instanceof NotConfigured)) throw e;
      const games = parseByColumns(clean, teamName);
      if (games.length === 0) {
        throw new ScheduleReadError('לא מצאנו בקובץ עמודות של תאריך ויריבה (או קבוצה ביתית ואורחת). בדקו שבשורה הראשונה יש כותרות.');
      }
      return { games, warning: '', via: 'columns' };
    }
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    return askAi(teamId, teamName, { kind: 'pdf', media_type: 'application/pdf', data: await toBase64(file) }, true);
  }
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(name)) {
    const img = await shrinkImage(file);
    return askAi(teamId, teamName, { kind: 'image', media_type: img.type, data: img.data }, true);
  }
  throw new ScheduleReadError('סוג קובץ לא נתמך. אפשר תמונה, PDF, אקסל (xlsx) או CSV.');
}

/* ------------------------------------------------------------ AI reading */

class NotConfigured extends Error {}

interface AiGame {
  date: string;
  time: string;
  opponent: string;
  home: boolean;
  venue: string;
  competition: Competition;
  round: string;
}

async function askAi(
  teamId: string,
  teamName: string,
  payload: { kind: 'image' | 'pdf' | 'text'; data: string; media_type?: string; file_name?: string },
  needsAi = false,
): Promise<ReadResult> {
  const { data, error } = await db().functions.invoke('read-schedule', { body: { team_id: teamId, team_name: teamName, ...payload } });
  if (error) {
    let code = '';
    let status = 0;
    const res = (error as { context?: Response }).context;
    if (res && typeof res.json === 'function') {
      status = res.status;
      try {
        code = ((await res.clone().json()) as { error?: string }).error ?? '';
      } catch {
        /* not json */
      }
    }
    // function not deployed yet (404 / network) or no API key
    if (code === 'not_configured' || status === 404 || !res) {
      if (needsAi) throw new ScheduleReadError('קריאת תמונות ו-PDF עוד לא הופעלה באפליקציה. בינתיים אפשר להעלות אקסל או CSV.');
      throw new NotConfigured();
    }
    throw new ScheduleReadError(
      code === 'forbidden'
        ? 'אין לך הרשאה להוסיף משחקים לקבוצה הזו.'
        : code === 'too_large'
          ? 'הקובץ גדול מדי. נסו צילום מסך או קובץ קטן יותר.'
          : code === 'busy'
            ? 'יש עומס כרגע. נסו שוב בעוד דקה.'
            : 'לא הצלחנו לקרוא את הקובץ. נסו צילום ברור יותר.',
    );
  }
  const r = data as { team_found: boolean; warning: string; games: AiGame[] };
  const games = (r.games ?? [])
    .filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.date) && g.opponent?.trim())
    .map((g, i) => draft(i, g.date, /^\d{1,2}:\d{2}$/.test(g.time) && g.time !== '00:00' ? g.time.padStart(5, '0') : '', g.opponent, g.home, g.venue, g.competition, g.round));
  if (!r.team_found && games.length === 0) throw new ScheduleReadError(r.warning || `לא מצאנו בקובץ משחקים של ${teamName}.`);
  return { games, warning: r.warning ?? '', via: 'ai' };
}

function draft(i: number, date: string, time: string, opponent: string, home: boolean, venue = '', competition: Competition = 'league', round = ''): DraftGame {
  return {
    key: `${i}-${date}-${opponent}`,
    date,
    time,
    opponent: opponent.trim().slice(0, 60),
    home: home !== false,
    venue: (venue ?? '').trim().slice(0, 80),
    competition: ['league', 'cup', 'friendly', 'tournament'].includes(competition) ? competition : 'league',
    round: (round ?? '').trim(),
    include: true,
  };
}

/* ------------------------------------------------------------- saving */

/** Marks games the team already has that day against the same opponent (or an IFA game). */
export function markDuplicates(games: DraftGame[], existing: { starts_at: string; opponent: string; source?: string; status: string }[]): DraftGame[] {
  const seen = existing
    .filter((m) => m.status !== 'canceled')
    .map((m) => ({ day: localDay(m.starts_at), opp: m.opponent.trim().toLowerCase(), ifa: m.source === 'ifa' }));
  return games.map((g) => {
    const dup = seen.some((s) => s.day === g.date && (s.ifa || s.opp === g.opponent.trim().toLowerCase()));
    return { ...g, duplicate: dup, include: dup ? false : g.include };
  });
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function importGames(teamId: string, games: DraftGame[]): Promise<{ added: number; skipped: number }> {
  const rows = games.map((g) => {
    const [y, m, d] = g.date.split('-').map(Number);
    const [hh, mm] = (g.time || '00:00').split(':').map(Number);
    return {
      starts_at: new Date(y, m - 1, d, hh, mm).toISOString(),
      time_known: !!g.time,
      opponent: g.opponent.trim(),
      home: g.home,
      venue: g.venue.trim(),
      competition: g.competition,
      note: g.round ? (/^\d+$/.test(g.round) ? `מחזור ${g.round}` : g.round).slice(0, 300) : '',
    };
  });
  const { data, error } = await db().rpc('import_team_matches', { p_team: teamId, p_games: rows });
  if (error) throw error;
  return data as { added: number; skipped: number };
}

/* ------------------------------------------------------- file helpers */

async function toBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Large photos are scaled down (max 2000 px) and sent as JPEG; screenshots stay PNG when small. */
async function shrinkImage(file: File): Promise<{ type: string; data: string }> {
  const okType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type);
  if (okType && file.size < 3_500_000) return { type: file.type, data: await toBase64(file) };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new ScheduleReadError('לא הצלחנו לפתוח את התמונה. נסו צילום מסך (PNG או JPG).');
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  if (!blob) throw new ScheduleReadError('לא הצלחנו לעבד את התמונה.');
  return { type: 'image/jpeg', data: await toBase64(blob) };
}

/** CSV / TSV with quotes. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split('\n', 1)[0];
  const sep = firstLine.includes('\t') ? '\t' : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* ---- minimal .xlsx reader (zip + XML), first sheet, dates as YYYY-MM-DD / HH:MM ---- */

async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ScheduleReadError('קובץ האקסל פגום.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const lstart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Uint8Array(buf, lstart, csize);
    if (method === 0) out.set(name, dec.decode(raw));
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, await new Response(stream).text());
    }
  }
  return out;
}

const DATE_FMT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
const TIME_FMT_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);

function serialToYmd(n: number) {
  const d = new Date(Math.round((n - 25569) * 864e5));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fracToHm(n: number) {
  const mins = Math.round((n - Math.floor(n)) * 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}
const unxml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, '&');

async function readXlsx(file: File): Promise<string[][]> {
  const files = await unzip(await file.arrayBuffer(), (n) => n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  // styles: which cell formats are dates / times
  const styles = files.get('xl/styles.xml') ?? '';
  const custom = new Map<number, string>([...styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [+m[1], unxml(m[2])]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const fmtOf = [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => +m[1]);
  const kindOf = (s: number): 'date' | 'time' | 'datetime' | null => {
    const id = fmtOf[s];
    if (id == null) return null;
    if (DATE_FMT_IDS.has(id)) return id === 22 ? 'datetime' : 'date';
    if (TIME_FMT_IDS.has(id)) return 'time';
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
    if (!code) return null;
    const hasD = /[dy]/.test(code);
    const hasT = /h/.test(code);
    return hasD && hasT ? 'datetime' : hasD ? 'date' : hasT ? 'time' : null;
  };
  // first sheet in workbook order
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rid = /<sheet [^>]*r:id="([^"]+)"/.exec(files.get('xl/workbook.xml') ?? '')?.[1];
  const target = rid && new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(files.get('xl/_rels/workbook.xml.rels') ?? '')?.[1];
  if (target) sheetPath = 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheet = files.get(sheetPath) ?? [...files.entries()].find(([k]) => k.startsWith('xl/worksheets/'))?.[1];
  if (!sheet) throw new ScheduleReadError('לא נמצא גיליון בקובץ האקסל.');

  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '';
      const col = ref ? [...ref].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      const s = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const inner = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (t === 's' && v != null) val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (v != null) {
        const num = Number(v);
        const k = t && t !== 'n' ? null : kindOf(s);
        if (k && !Number.isNaN(num)) val = k === 'date' ? serialToYmd(num) : k === 'time' ? fracToHm(num) : `${serialToYmd(num)} ${fracToHm(num)}`;
        else val = unxml(v);
      }
      row[col] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

/* ------------------------------------ column parser (no AI available) */

const H = {
  date: /תאריך|date/i,
  time: /שעה|שעת|time/i,
  opponent: /יריב|נגד|opponent/i,
  home: /בית|מארח|ביתית|home/i,
  away: /חוץ|אורח|away/i,
  venue: /מגרש|אולם|מקום|כתובת|venue/i,
  round: /מחזור|round/i,
};

function normName(s: string) {
  return s.replace(/["'׳״.\-()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
/** Share of the team name's words that appear in the cell. */
function nameScore(cell: string, team: string) {
  const words = normName(team).split(' ').filter((w) => w.length > 1);
  const c = normName(cell);
  if (!words.length || !c) return 0;
  return words.filter((w) => c.includes(w)).length / words.length;
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(t);
  if (!m) return null;
  const day = +m[1];
  const mon = +m[2];
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  let year = m[3] ? +m[3] : 0;
  if (year && year < 100) year += 2000;
  if (!year) {
    // season Aug..Jun around today
    const now = new Date();
    const seasonStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    year = mon >= 8 ? seasonStart : seasonStart + 1;
  }
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function parseTime(s: string): string {
  const m = /(\d{1,2}):(\d{2})/.exec(s);
  if (!m || (m[1] === '00' && m[2] === '00') || (+m[1] === 0 && +m[2] === 0)) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function parseByColumns(rows: string[][], teamName: string): DraftGame[] {
  const headerIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => H.date.test(c)) && r.some((c) => H.opponent.test(c) || H.home.test(c)));
  if (headerIdx < 0) return [];
  const header = rows[headerIdx];
  const col = (re: RegExp, not?: RegExp) => header.findIndex((c) => re.test(c) && !(not && not.test(c)));
  const cDate = col(H.date);
  const cTime = col(H.time);
  const cOpp = col(H.opponent);
  const cHome = col(H.home, H.away);
  const cAway = col(H.away);
  const cVenue = col(H.venue);
  const cRound = col(H.round);
  const out: DraftGame[] = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const raw = cell(cDate);
    const date = parseDate(raw);
    if (!date) return;
    const time = parseTime(cell(cTime) || raw);
    let opponent = '';
    let home = true;
    if (cOpp >= 0) {
      opponent = cell(cOpp);
      if (cHome >= 0 && cHome !== cOpp) home = /בית|כן|home|v/i.test(cell(cHome));
    } else if (cHome >= 0 && cAway >= 0) {
      const h = cell(cHome);
      const a = cell(cAway);
      const sh = nameScore(h, teamName);
      const sa = nameScore(a, teamName);
      if (Math.max(sh, sa) < 0.5) return; // a game of other teams
      home = sh >= sa;
      opponent = home ? a : h;
    }
    if (!opponent) return;
    out.push(draft(i, date, time, opponent, home, cell(cVenue), 'league', cell(cRound)));
  });
  return out;
}
