/**
 * Team gallery: link-only albums. iplays never stores or downloads photos or
 * videos: a parent shares an album from their own cloud and we keep the link.
 * Server side: supabase/migrations/20261103400000_team_gallery.sql
 *
 * Built so a future "connect your Google Drive" step can create the album
 * folder for the parent (CloudProvider.autoCreate); today every provider is
 * manual (create the album yourself, paste the link) and no cloud account
 * permission is ever requested.
 */
import { supabase } from './supabase';
import { isMissing } from './coachApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export type ProviderId = 'google_photos' | 'google_drive' | 'icloud' | 'onedrive' | 'dropbox';
export type AlbumCategory = 'match' | 'training' | 'event' | 'general';

export interface CloudProvider {
  id: ProviderId;
  label: string;
  /** host names a share link may use (exact, or a suffix starting with '.') */
  hosts: string[];
  /** where the parent creates the album */
  createUrl: string;
  /** step-by-step: create, share with view + download, copy the link */
  steps: string[];
  example: string;
  /** Future: albums created automatically after connecting the account. Not built. */
  autoCreate: false;
}

export const PROVIDERS: CloudProvider[] = [
  {
    id: 'google_photos',
    label: 'Google Photos',
    hosts: ['photos.google.com', 'photos.app.goo.gl'],
    createUrl: 'https://photos.google.com/albums',
    steps: [
      'פותחים את Google Photos ויוצרים אלבום חדש (או פותחים אלבום קיים).',
      'מוסיפים את התמונות והסרטונים מהמכשיר.',
      'לוחצים "שיתוף" ואז "יצירת קישור" (Create link).',
      'מי שמחזיק בקישור יכול לצפות ולהוריד מתוך Google Photos.',
      'מעתיקים את הקישור וחוזרים לכאן.',
    ],
    example: 'https://photos.app.goo.gl/…',
    autoCreate: false,
  },
  {
    id: 'google_drive',
    label: 'Google Drive',
    hosts: ['drive.google.com'],
    createUrl: 'https://drive.google.com/drive/my-drive',
    steps: [
      'ב־Google Drive יוצרים תיקייה חדשה (לדוגמה: iplays › שם הקבוצה › שם האירוע).',
      'מעלים לתיקייה את התמונות והסרטונים.',
      'לוחצים על התיקייה ← "שיתוף" ← בגישה כללית בוחרים "כל מי שקיבל את הקישור", בהרשאת "צופה".',
      'צופים יכולים גם להוריד, אלא אם כיביתם זאת בהגדרות השיתוף.',
      'לוחצים "העתקת הקישור" וחוזרים לכאן.',
    ],
    example: 'https://drive.google.com/drive/folders/…',
    autoCreate: false,
  },
  {
    id: 'icloud',
    label: 'iCloud Photos',
    hosts: ['www.icloud.com', 'icloud.com', 'share.icloud.com'],
    createUrl: 'https://www.icloud.com/photos/',
    steps: [
      'באפליקציית התמונות באייפון יוצרים "אלבום משותף" חדש.',
      'מוסיפים את התמונות והסרטונים.',
      'בהגדרות האלבום (סמל האנשים) מפעילים "אתר ציבורי" (Public Website).',
      'מי שפותח את הקישור יכול לצפות ולהוריד מהדפדפן.',
      'לוחצים "שתף קישור", מעתיקים וחוזרים לכאן.',
    ],
    example: 'https://www.icloud.com/sharedalbum/#…',
    autoCreate: false,
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    hosts: ['1drv.ms', 'onedrive.live.com', '.sharepoint.com'],
    createUrl: 'https://onedrive.live.com/',
    steps: [
      'ב־OneDrive יוצרים תיקייה ומעלים אליה את התמונות והסרטונים.',
      'לוחצים "שיתוף" ובוחרים "כל מי שיש לו את הקישור יכול להציג".',
      'מעתיקים את הקישור וחוזרים לכאן.',
    ],
    example: 'https://1drv.ms/f/…',
    autoCreate: false,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    hosts: ['www.dropbox.com', 'dropbox.com'],
    createUrl: 'https://www.dropbox.com/home',
    steps: [
      'ב־Dropbox יוצרים תיקייה ומעלים אליה את התמונות והסרטונים.',
      'לוחצים "שיתוף" ← "יצירת קישור" עם הרשאת צפייה.',
      'מעתיקים את הקישור וחוזרים לכאן.',
    ],
    example: 'https://www.dropbox.com/scl/fo/…',
    autoCreate: false,
  },
];

export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id);
export const providerLabel = (id: string) => providerOf(id)?.label ?? 'ענן';

export const categoryLabel: Record<AlbumCategory, string> = {
  match: 'משחקים',
  training: 'אימונים',
  event: 'אירועים',
  general: 'כללי',
};

/* ------------------------------------------------------------- links */

/** The same rule as gallery_link_ok() on the server. */
export function linkHost(raw: string): string | null {
  const url = raw.trim();
  if (url.length > 600) return null;
  if (!/^https:\/\/[a-z0-9.-]+(?:[/?#][^\s<>"'\\`{}|^\u0000-\u001f\u007f]*)?$/i.test(url)) return null;
  return url.slice(8).split(/[/?#]/)[0].toLowerCase();
}

const hostMatches = (host: string, hosts: string[]) =>
  hosts.some((h) => (h.startsWith('.') ? host.endsWith(h) && /^[a-z0-9-]+$/.test(host.slice(0, -h.length)) : host === h));

/** The cloud service a pasted link belongs to, or null. */
export function detectProvider(raw: string): ProviderId | null {
  const host = linkHost(raw);
  if (!host) return null;
  return PROVIDERS.find((p) => hostMatches(host, p.hosts))?.id ?? null;
}

export function isSafeLink(provider: string, raw: string): boolean {
  const host = linkHost(raw);
  const p = providerOf(provider);
  return !!host && !!p && hostMatches(host, p.hosts);
}

/** Hebrew error for a pasted link, or null when it is fine for the chosen provider. */
export function linkProblem(provider: ProviderId | null, raw: string): string | null {
  const url = raw.trim();
  if (!url) return 'הדביקו את קישור השיתוף של האלבום.';
  if (!/^https:\/\//i.test(url)) return 'הקישור צריך להתחיל ב־https://';
  const detected = detectProvider(url);
  if (!detected) return 'זה לא נראה כמו קישור שיתוף של Google Photos, Google Drive, iCloud, OneDrive או Dropbox. אפשר להדביק רק קישור מאחד מהשירותים האלה.';
  if (provider && detected !== provider) return `הקישור שייך ל־${providerLabel(detected)} ולא ל־${providerLabel(provider)}.`;
  return null;
}

/* ------------------------------------------------------------- consent */

/** Bump when the consent text changes; saved with every album. */
export const CONSENT_VERSION = 'v1-2026-11';
export const CONSENT_TITLE = 'חשוב לדעת – אחסון ושיתוף תמונות';
export const CONSENT_PARAGRAPHS = [
  'התמונות והסרטונים באלבום נשמרים בשירות הענן האישי שלך, ולא בשרתים של iPlays.',
  'נפח האחסון של הקבצים יחושב במסגרת חשבון הענן שלך, בהתאם לתנאי השירות שבו אתה משתמש.',
  'באמצעות פרסום קישור האלבום, אתה מאפשר לחברי הקבוצה לגשת לתמונות ולסרטונים בהתאם להרשאות שהגדרת בשירות הענן.',
  'אם אפשרת הורדה, חברי הקבוצה יוכלו גם לשמור עותקים במכשירים האישיים שלהם.',
  'חשוב לוודא שיש לך הרשאה לשתף את התמונות, במיוחד כאשר מופיעים בהן ילדים.',
];
export const PUBLIC_LINK_WARNING =
  'שימו לב: ההרשאות של הגלריה ב־iPlays לא מגבילות את הקישור עצמו. אם בשירות הענן בחרתם בקישור ציבורי ("כל מי שיש לו את הקישור"), גם מי שאינו בקבוצה יוכל לפתוח את האלבום אם הקישור יועבר אליו.';
export const CONSENT_CHECKBOX =
  'אני מבין/ה שהקבצים מאוחסנים בחשבון הענן האישי שלי, שהאחסון הוא באחריותי ושאני מאשר/ת את שיתוף האלבום בהתאם להרשאות שהגדרתי.';

/* ------------------------------------------------------------- data */

export interface Album {
  id: string;
  team_id: string;
  title: string;
  category: AlbumCategory;
  provider: ProviderId;
  url: string;
  training_id: string | null;
  match_id: string | null;
  event_date: string | null;
  event_label: string | null;
  event_at: string | null;
  created_by: string;
  publisher: string;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  removed_reason: string | null;
  is_mine: boolean;
  open_reports: number;
  my_report: ReportReason | null;
}

export interface AlbumInput {
  title: string;
  provider: ProviderId;
  url: string;
  category: AlbumCategory;
  trainingId: string | null;
  matchId: string | null;
  eventDate: string | null;
  consent: boolean;
}

/** null = the gallery migration is not installed yet. */
export async function teamGallery(teamId: string): Promise<Album[] | null> {
  const { data, error } = await db().rpc('team_gallery', { p_team: teamId });
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return (data ?? []) as Album[];
}

const params = (a: AlbumInput) => ({
  p_title: a.title.trim(),
  p_provider: a.provider,
  p_url: a.url.trim(),
  p_category: a.category,
  p_training: a.trainingId,
  p_match: a.matchId,
  p_event_date: a.category === 'event' ? a.eventDate || null : null,
  p_consent: a.consent,
  p_consent_version: CONSENT_VERSION,
});

export async function publishAlbum(teamId: string, a: AlbumInput): Promise<string> {
  const { data, error } = await db().rpc('publish_album', { p_team: teamId, ...params(a) });
  if (error) throw error;
  return data as string;
}

export async function updateAlbum(albumId: string, a: AlbumInput): Promise<void> {
  const { error } = await db().rpc('update_album', { p_album: albumId, ...params(a) });
  if (error) throw error;
}

/** Publisher: deletes the album from iplays. Staff: takes it off the gallery. Cloud files are never touched. */
export async function removeAlbum(albumId: string, reason?: string): Promise<void> {
  const { error } = await db().rpc('remove_album', { p_album: albumId, p_reason: reason?.trim() || null });
  if (error) throw error;
}

export async function restoreAlbum(albumId: string): Promise<void> {
  const { error } = await db().rpc('restore_album', { p_album: albumId });
  if (error) throw error;
}

export type ReportReason = 'privacy' | 'minor' | 'inappropriate' | 'broken_link' | 'other';
export const reportReasonLabel: Record<ReportReason, string> = {
  minor: 'מופיע/ה ילד/ה שלי ואני מבקש/ת להסיר',
  privacy: 'פגיעה בפרטיות',
  inappropriate: 'תוכן לא מתאים',
  broken_link: 'הקישור לא נפתח / מבקש הרשאה',
  other: 'אחר',
};

export async function reportAlbum(albumId: string, reason: ReportReason, note: string): Promise<void> {
  const { error } = await db().rpc('report_album', { p_album: albumId, p_reason: reason, p_note: note.trim() });
  if (error) throw error;
}

export interface AlbumReport {
  id: string;
  reason: ReportReason;
  note: string;
  reporter: string;
  created_at: string;
}

export async function albumReports(albumId: string): Promise<AlbumReport[]> {
  const { data, error } = await db().rpc('album_reports', { p_album: albumId });
  if (error) throw error;
  return (data ?? []) as AlbumReport[];
}

export async function dismissAlbumReports(albumId: string): Promise<void> {
  const { error } = await db().rpc('resolve_album_reports', { p_album: albumId });
  if (error) throw error;
}

/* ------------------------------------------------------------- events */

export interface GalleryEvent {
  kind: 'training' | 'match';
  id: string;
  starts_at: string;
  label: string;
}

/** Recent and near trainings / games of the team to link an album to (RLS decides what I see). */
export async function linkableEvents(teamId: string): Promise<GalleryEvent[]> {
  const from = new Date(Date.now() - 180 * 86400_000).toISOString();
  const to = new Date(Date.now() + 14 * 86400_000).toISOString();
  const trainingsQ = (cols: string) =>
    db().from('training_sessions').select(cols).eq('team_id', teamId).gte('starts_at', from).lte('starts_at', to).order('starts_at', { ascending: false }).limit(80);
  let tr = await trainingsQ('id, starts_at, title, canceled, audience');
  if (tr.error && isMissing(tr.error)) tr = await trainingsQ('id, starts_at, title, canceled');
  const ma = await db()
    .from('team_matches')
    .select('id, starts_at, opponent, status')
    .eq('team_id', teamId)
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('starts_at', { ascending: false })
    .limit(60);
  type T = { id: string; starts_at: string; title: string; canceled: boolean; audience?: string };
  type M = { id: string; starts_at: string; opponent: string; status: string };
  const trainings = ((tr.data ?? []) as unknown as T[])
    .filter((t) => !t.canceled && (t.audience ?? 'team') === 'team')
    .map((t): GalleryEvent => ({ kind: 'training', id: t.id, starts_at: t.starts_at, label: t.title || 'אימון' }));
  const matches = ((ma.data ?? []) as unknown as M[])
    .filter((m) => m.status !== 'canceled')
    .map((m): GalleryEvent => ({ kind: 'match', id: m.id, starts_at: m.starts_at, label: `משחק מול ${m.opponent}` }));
  return [...trainings, ...matches].sort((a, b) => b.starts_at.localeCompare(a.starts_at));
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });

export function galleryError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? '';
  if (isMissing(e)) return 'הגלריה תפעל אחרי עדכון מסד הנתונים (קובץ SQL של הגלריה).';
  if (msg.includes('consent required')) return 'צריך לסמן את תיבת האישור כדי לפרסם.';
  if (msg.includes('bad link') || msg.includes('team_albums_link_ok')) return 'הקישור לא תקין לשירות הענן שבחרתם.';
  if (msg.includes('event not in this team')) return 'האירוע שבחרתם לא שייך לקבוצה.';
  if (msg.includes('already reported')) return 'כבר דיווחת על האלבום הזה. צוות הקבוצה יבדוק.';
  if (msg.includes('team_albums_title_check')) return 'שם האלבום צריך להיות באורך 1 עד 80 תווים.';
  if (msg.includes('not allowed')) return 'אין לך הרשאה לפעולה הזו.';
  return null;
}
