/**
 * Load a team's game schedule from a file: image (screenshot / photo), PDF,
 * Excel (.xlsx) or CSV. Everything is read for free, in the browser:
 *
 * - Excel / CSV: a small built-in reader.
 * - PDF: pdf.js text extraction (text PDFs; a scanned PDF has no text).
 * - Images: tesseract.js OCR in Hebrew + English (loaded only when needed).
 *
 * PDF and image text is rebuilt into table rows by position, then read by
 * column headers when there are any, or row by row (date, time, the team's
 * name and the team next to it). OCR makes mistakes, so every game is shown
 * for review and fixing; nothing is saved until the user taps save, which
 * calls import_team_matches (supabase/migrations/20261103100000_schedule_import.sql).
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
}

export class ScheduleReadError extends Error {}

const EXCEL_EXT = /\.(xlsx|xlsm)$/i;
const CSV_EXT = /\.(csv|tsv|txt)$/i;

export const ACCEPT = 'image/*,application/pdf,.pdf,.xlsx,.xlsm,.csv,.tsv';

export interface TableReading {
  /** one or more readings of the same file (images are read twice), each a list of rows of cells */
  readings: string[][][];
  /** shown above the review list (e.g. "read from an image, check every row") */
  warning: string;
}

/**
 * Reads any supported file into rows of cells, right to left. Shared by the
 * schedule import and the league table / roster updates from a screenshot.
 */
export async function readTableFile(file: File, onProgress?: (text: string) => void, what = 'הלוח'): Promise<TableReading> {
  const name = file.name || '';
  if (/\.xls$/i.test(name)) throw new ScheduleReadError('קובץ אקסל ישן (xls). שמרו אותו כ-xlsx ונסו שוב.');
  let readings: string[][][];
  let warning = '';
  if (EXCEL_EXT.test(name) || CSV_EXT.test(name) || file.type === 'text/csv') {
    readings = [EXCEL_EXT.test(name) ? await readXlsx(file) : parseCsv(await file.text())];
  } else if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    onProgress?.('קוראים את ה-PDF…');
    readings = [await readPdf(file)];
    if (readings[0].length === 0) throw new ScheduleReadError(`ב-PDF הזה אין טקסט (כנראה סריקה). צלמו מסך של ${what} והעלו כתמונה.`);
  } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/i.test(name)) {
    readings = await readImage(file, onProgress);
    warning = 'הטקסט זוהה מתמונה וייתכנו טעויות. בדקו כל שורה לפני השמירה.';
  } else {
    throw new ScheduleReadError('סוג קובץ לא נתמך. אפשר תמונה, PDF, אקסל (xlsx) או CSV.');
  }
  readings = readings.map((rows) => rows.map((r) => r.map((c) => (c ?? '').replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean)));
  if (!readings.some((rows) => rows.length)) throw new ScheduleReadError('לא נמצא טקסט בקובץ.');
  return { readings, warning };
}

export async function readScheduleFile(file: File, teamName: string, onProgress?: (text: string) => void): Promise<ReadResult> {
  const { readings, warning: w } = await readTableFile(file, onProgress);
  const warning = w ? 'הטקסט זוהה מתמונה וייתכנו טעויות. בדקו כל משחק לפני השמירה.' : '';
  let games: DraftGame[] = [];
  for (const clean of readings) {
    let g = parseByColumns(clean, teamName);
    if (g.length === 0) g = parseLoose(clean, teamName);
    if (g.length > games.length) games = g;
  }
  if (games.length === 0) {
    throw new ScheduleReadError(`לא מצאנו בקובץ משחקים של ${teamName}. ודאו שהשם של הקבוצה מופיע בקובץ כמו באפליקציה, ושיש תאריכים.`);
  }
  return { games, warning };
}

/* ------------------------------------------- PDF and image to table rows */

interface Piece {
  text: string;
  x0: number;
  x1: number;
  y: number; // vertical center, top-down
  h: number;
}

/** Groups positioned text into rows (by height) and cells (by horizontal gaps), right to left. */
export function piecesToRows(pieces: Piece[]): string[][] {
  const ps = pieces.filter((p) => p.text.trim());
  if (ps.length === 0) return [];
  const hs = ps.map((p) => p.h).sort((a, b) => a - b);
  const mh = hs[Math.floor(hs.length / 2)] || 10;
  ps.sort((a, b) => a.y - b.y);
  const lines: Piece[][] = [];
  for (const p of ps) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - p.y) < mh * 0.6) last.push(p);
    else lines.push([p]);
  }
  return lines.map((line) => {
    line.sort((a, b) => b.x1 - a.x1); // right to left
    const cells: string[] = [];
    let cur = '';
    let left = Infinity;
    for (const p of line) {
      if (cur && left - p.x1 > mh * 1.4) {
        cells.push(cur);
        cur = '';
      }
      cur = cur ? `${cur} ${p.text.trim()}` : p.text.trim();
      left = Math.min(left, p.x0);
    }
    if (cur) cells.push(cur);
    return cells;
  });
}

async function readPdf(file: File): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows: string[][] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 30); n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces: Piece[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const x = it.transform[4] as number;
      const h = Math.abs((it.transform[3] as number) || it.height || 10);
      pieces.push({ text: it.str, x0: x, x1: x + it.width, y: vp.height - (it.transform[5] as number) - h / 2, h });
    }
    rows.push(...piecesToRows(pieces));
  }
  return rows;
}

/**
 * OCR twice: page-segmentation 11 (sparse text: each table cell on its own,
 * best for dates and times) and 6 (one block: keeps names together). The
 * reading that yields more games wins.
 */
async function readImage(file: File, onProgress?: (text: string) => void): Promise<string[][][]> {
  onProgress?.('טוענים את זיהוי הטקסט (בפעם הראשונה זה לוקח יותר)…');
  const { createWorker } = await import('tesseract.js');
  // served from our own site (see vite.config.ts), not a CDN
  const base = new URL('ocr/', document.baseURI).href;
  let pass = 0;
  const worker = await createWorker(['heb', 'eng'], 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: `${base}lang`,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(`מזהים טקסט… ${Math.round(((pass + m.progress) / 2) * 100)}%`);
    },
  });
  try {
    const img = await prepareImage(file);
    const out: string[][][] = [];
    for (const psm of ['11', '6']) {
      await worker.setParameters({ tessedit_pageseg_mode: psm as never, preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(img, {}, { blocks: true });
      const pieces: Piece[] = [];
      for (const b of data.blocks ?? []) {
        for (const par of b.paragraphs) {
          for (const line of par.lines) {
            for (const w of line.words) {
              const text = w.text.replace(/[\u200e\u200f\u202a-\u202e|]/g, '').trim();
              if (text) pieces.push({ text, x0: w.bbox.x0, x1: w.bbox.x1, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 });
            }
          }
        }
      }
      out.push(piecesToRows(pieces));
      pass++;
    }
    return out;
  } finally {
    await worker.terminate();
  }
}

/** Small screenshots are enlarged (OCR reads ~30 px letters best); huge photos are reduced. */
async function prepareImage(file: File): Promise<Blob | File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    if (/heic/i.test(file.type) || /\.heic$/i.test(file.name)) throw new ScheduleReadError('לא הצלחנו לפתוח תמונת HEIC. צלמו מסך (PNG) או שמרו כ-JPG.');
    return file;
  }
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long < 1400 ? 2 : long > 3500 ? 3500 / long : 1;
  if (scale === 1) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return (await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))) ?? file;
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

export function normName(s: string) {
  return s.replace(/["'׳״.\-()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
/** Share of the team name's words that appear in the cell. */
export function nameScore(cell: string, team: string) {
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

/* ------------------------------ row-by-row parser (PDF / image tables) */

const DATE_RE = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/;
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/;
const NOT_NAME = /^(מחזור|תאריך|שעה|יום|מגרש|בית|חוץ|נגד|vs|-|–|:|\d+)$/i;
const DAY_WORD = /^(יום\s*)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|א'|ב'|ג'|ד'|ה'|ו'|ש')$/;
const hasLetters = (s: string) => /[\u0590-\u05FFa-zA-Z]{2,}/.test(s);

/** Splits "הפועל א - מכבי ב" style cells into the two team names. */
function splitTeams(cell: string): string[] {
  const parts = cell.split(/\s+(?:-|–|נגד|vs\.?)\s+/i).map((x) => x.trim()).filter(Boolean);
  return parts.length === 2 ? parts : [cell];
}

/** A cell without dates, times or labels, left with the text of a name. */
function nameText(cell: string): string {
  return cell.replace(DATE_RE, ' ').replace(TIME_RE, ' ').replace(/\b(מחזור|יום)\s*\S*/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseLoose(rows: string[][], teamName: string): DraftGame[] {
  const out: DraftGame[] = [];
  let lastDate: string | null = null;
  let lastRound = '';
  rows.forEach((row, i) => {
    const line = row.join(' ');
    const dm = DATE_RE.exec(line);
    const d = dm ? parseDate(dm[0]) : null;
    if (d) lastDate = d;
    const rm = /מחזור\s*(\d+)/.exec(line);
    if (rm) lastRound = rm[1];
    if (nameScore(line, teamName) < 0.5) return;
    // names in reading order (right to left): each cell, "A - B" cells split in two
    const names: string[] = [];
    for (const c of row) {
      for (const part of splitTeams(c)) {
        const t = nameText(part);
        if (t && hasLetters(t) && !NOT_NAME.test(t) && !DAY_WORD.test(t)) names.push(t);
      }
    }
    let mine = -1;
    let best = 0.49;
    names.forEach((n, k) => {
      const sc = nameScore(n, teamName);
      if (sc > best) {
        best = sc;
        mine = k;
      }
    });
    if (mine < 0 || !lastDate) return;
    // the opponent sits next to the team: the cell before it (then the team is away) or after it (home)
    const after = names[mine + 1];
    const before = names[mine - 1];
    let home = true;
    let opponent = '';
    if (after && !(before && mine === names.length - 1)) {
      opponent = after;
      home = true;
    } else if (before) {
      opponent = before;
      home = false;
    }
    if (!opponent) return;
    const venueIdx = home ? mine + 2 : mine + 1;
    const venue = names[venueIdx] && venueIdx !== mine ? names[venueIdx] : '';
    out.push(draft(i, lastDate, parseTime(line), opponent, home, venue, /גביע/.test(line) ? 'cup' : /ידידות/.test(line) ? 'friendly' : 'league', lastRound));
  });
  // the same game twice (e.g. a repeated header page): keep the first
  const seen = new Set<string>();
  return out.filter((g) => {
    const k = `${g.date}|${g.opponent}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
