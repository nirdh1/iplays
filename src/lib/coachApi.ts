/**
 * Coach board data: training sessions, coach announcements and absence /
 * lateness reports. Two backends share one interface: Supabase (RLS in
 * supabase/migrations/20261101100000_coach.sql) and a demo store kept in
 * the browser so the static preview stays fully clickable.
 */
import { supabase } from './supabase';

export type AbsenceKind = 'absent' | 'late';
export type AbsenceReason = 'family_event' | 'vacation' | 'sick' | 'injury' | 'school' | 'other';
/** Which activities a date-range report covers. */
export type AbsenceScope = 'all' | 'training' | 'match';

export const reasonLabel: Record<AbsenceReason, string> = {
  sick: 'מחלה',
  injury: 'פציעה',
  vacation: 'חופשה / נסיעה',
  family_event: 'אירוע משפחתי',
  school: 'לימודים / מבחן',
  other: 'סיבה אחרת',
};
export const scopeLabel: Record<AbsenceScope, string> = { all: 'כל הפעילויות', training: 'רק אימונים', match: 'רק משחקים' };

/** team = the whole team; goalkeepers = the team's goalkeepers; players = picked players */
export type TrainingKind = 'team' | 'personal' | 'goalkeeper';
export type TrainingAudience = 'team' | 'goalkeepers' | 'players';

export interface TrainingSession {
  id: string;
  starts_at: string; // ISO
  duration_min: number;
  title: string;
  location: string;
  note: string;
  canceled: boolean;
  /** set once the calendar migration (20261102500000) is installed */
  kind?: TrainingKind;
  audience?: TrainingAudience;
  series_id?: string | null;
  private?: boolean;
  created_by?: string | null;
  /** players of a goalkeeper / personal training */
  participants?: string[];
}

export type SessionPatch = Partial<Pick<TrainingSession, 'starts_at' | 'duration_min' | 'title' | 'location' | 'note'>>;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  author_name: string;
  created_at: string;
}

export interface Absence {
  id: string;
  player_id: string;
  player_name: string;
  kind: AbsenceKind;
  from_date: string; // YYYY-MM-DD
  to_date: string;
  session_id: string | null;
  reason: AbsenceReason;
  note: string;
  minutes_late: number | null;
  applies_to: AbsenceScope;
  reported_by_name: string;
  created_at: string;
}

export interface SessionInput {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration_min: number;
  title: string;
  location: string;
  note: string;
  repeatWeeks: number; // 1 = only this date
  /** goalkeeper / picked-players sessions (default: the whole team) */
  kind?: TrainingKind;
  audience?: TrainingAudience;
  players?: string[];
}

export interface AbsenceInput {
  player_id: string;
  kind: AbsenceKind;
  from_date: string;
  to_date: string;
  session_id: string | null;
  reason: AbsenceReason;
  note: string;
  minutes_late: number | null;
  applies_to?: AbsenceScope;
}

export interface CoachBackend {
  listSessions(): Promise<TrainingSession[]>;
  addSessions(input: SessionInput): Promise<void>;
  setCanceled(id: string, canceled: boolean): Promise<void>;
  /** change a training's date, time, length, title, place or note; with
   *  following, the later trainings of its weekly series get the same time
   *  of day, length, title, place and note */
  updateSession(s: TrainingSession, patch: Required<SessionPatch>, following: boolean): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** this training and the later ones of its weekly series */
  deleteSeriesFrom(s: TrainingSession): Promise<void>;
  listAnnouncements(): Promise<Announcement[]>;
  postAnnouncement(a: { title: string; body: string; pinned: boolean }): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  deleteAnnouncement(id: string): Promise<void>;
  listAbsences(): Promise<Absence[]>;
  /** returns the new report's id (to attach a medical document) */
  reportAbsence(a: AbsenceInput): Promise<string | null>;
  updateAbsence(id: string, a: Partial<AbsenceInput>): Promise<void>;
  deleteAbsence(id: string): Promise<void>;
}

/* ---------------------------------------------------------------- dates */

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const todayYmd = () => ymd(new Date());

/** Local date + time → ISO timestamp. */
export function localIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + days));
}

export function sessionDate(s: TrainingSession): string {
  return ymd(new Date(s.starts_at));
}

/** Does this report cover that training? */
export function absenceCovers(a: Absence, s: TrainingSession): boolean {
  if (a.session_id) return a.session_id === s.id;
  if (a.applies_to === 'match') return false;
  const d = sessionDate(s);
  return a.from_date <= d && d <= a.to_date;
}

/** Does a report cover an event on that date (for matches: date-range reports only)? */
export function absenceCoversEvent(a: Absence, kind: 'training' | 'match', eventId: string, date: string): boolean {
  if (a.session_id) return kind === 'training' && a.session_id === eventId;
  if (a.applies_to && a.applies_to !== 'all' && a.applies_to !== kind) return false;
  return a.from_date <= date && date <= a.to_date;
}

/** Postgres / PostgREST: a column or function that isn't there yet (migration not run). */
export function isMissing(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  return !!x && (['42703', 'PGRST204', 'PGRST202', 'PGRST200', '42883', 'PGRST205', '42P01'].includes(x.code ?? '') || /does not exist|Could not find/.test(x.message ?? ''));
}

/** First date that is still relevant: we keep showing reports from the last week. */
const recentCutoff = () => addDays(todayYmd(), -7);

/* ------------------------------------------------------------- supabase */

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data, error } = await db().from('profiles').select('id, full_name').in('id', unique);
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id, p.full_name || 'ללא שם']));
}

export function supabaseCoach(teamId: string): CoachBackend {
  return {
    async listSessions() {
      return listTeamSessions(teamId);
    },
    async addSessions(input) {
      const n = Math.max(1, input.repeatWeeks);
      const starts = Array.from({ length: n }, (_, i) => localIso(addDays(input.date, i * 7), input.time));
      if (input.audience && input.audience !== 'team') {
        const { error } = await db().rpc('create_trainings', {
          p_team: teamId,
          p_kind: input.kind ?? 'goalkeeper',
          p_audience: input.audience,
          p_starts: starts,
          p_duration: input.duration_min,
          p_title: input.title.trim() || null,
          p_location: input.location.trim(),
          p_note: input.note.trim(),
          p_players: input.players ?? [],
        });
        if (error) throw error;
        return;
      }
      const series = n > 1 && typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null;
      const rows = starts.map((starts_at) => ({
        team_id: teamId,
        starts_at,
        duration_min: input.duration_min,
        title: input.title.trim() || 'אימון קבוצתי',
        location: input.location.trim(),
        note: input.note.trim(),
      }));
      const first = await db().from('training_sessions').insert(series ? rows.map((r) => ({ ...r, series_id: series })) : rows);
      if (!first.error) return;
      if (!series || !isMissing(first.error)) throw first.error;
      const { error } = await db().from('training_sessions').insert(rows);
      if (error) throw error;
    },
    async deleteSeriesFrom(s) {
      if (!s.series_id) return deleteOne(s.id);
      const { data, error } = await db().from('training_sessions').delete().eq('series_id', s.series_id).gte('starts_at', s.starts_at).select('id');
      if (error) throw error;
      mustTouch(data);
    },
    async setCanceled(id, canceled) {
      const { data, error } = await db().from('training_sessions').update({ canceled }).eq('id', id).select('id');
      if (error) throw error;
      mustTouch(data);
    },
    async updateSession(s, patch, following) {
      const { error } = await db().rpc('edit_training', {
        p_session: s.id,
        p_starts: patch.starts_at,
        p_duration: patch.duration_min,
        p_title: patch.title,
        p_location: patch.location,
        p_note: patch.note,
        p_following: following,
      });
      if (!error) return;
      if (!isMissing(error)) throw error;
      // before 20261103300000_parents_edit_events.sql: plain updates
      const one = await db().from('training_sessions').update(patch).eq('id', s.id).select('id');
      if (one.error) throw one.error;
      mustTouch(one.data);
      if (!following || !s.series_id) return;
      const later = await db().from('training_sessions').select('id, starts_at').eq('series_id', s.series_id).gt('starts_at', s.starts_at);
      if (later.error) throw later.error;
      const time = new Date(patch.starts_at);
      for (const x of (later.data ?? []) as { id: string; starts_at: string }[]) {
        const d = new Date(x.starts_at);
        d.setHours(time.getHours(), time.getMinutes(), 0, 0);
        const { starts_at: _, ...rest } = patch;
        const { error: e2 } = await db().from('training_sessions').update({ ...rest, starts_at: d.toISOString() }).eq('id', x.id);
        if (e2) throw e2;
      }
    },
    async deleteSession(id) {
      return deleteOne(id);
    },
    async listAnnouncements() {
      const { data, error } = await db()
        .from('team_announcements')
        .select('id, title, body, pinned, author_id, created_at')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const names = await namesFor((data ?? []).map((a) => a.author_id));
      return (data ?? []).map(({ author_id, ...a }) => ({ ...a, author_name: (author_id && names.get(author_id)) || 'הצוות המקצועי' }));
    },
    async postAnnouncement(a) {
      const { data: u } = await db().auth.getUser();
      const { error } = await db()
        .from('team_announcements')
        .insert({ team_id: teamId, title: a.title.trim(), body: a.body.trim(), pinned: a.pinned, author_id: u.user?.id });
      if (error) throw error;
    },
    async setPinned(id, pinned) {
      const { error } = await db().from('team_announcements').update({ pinned }).eq('id', id);
      if (error) throw error;
    },
    async deleteAnnouncement(id) {
      const { error } = await db().from('team_announcements').delete().eq('id', id);
      if (error) throw error;
    },
    async listAbsences() {
      const { data, error } = await db()
        .from('player_absences')
        .select('id, player_id, kind, from_date, to_date, session_id, reason, note, minutes_late, applies_to, reported_by, created_at, players (first_name, last_name)')
        .eq('team_id', teamId)
        .gte('to_date', recentCutoff())
        .order('from_date')
        .limit(200);
      if (error && isMissing(error)) return legacyAbsences(teamId);
      if (error) throw error;
      const names = await namesFor((data ?? []).map((a) => a.reported_by));
      return (data ?? []).map(({ players, reported_by, ...a }) => {
        const p = players as unknown as { first_name: string; last_name: string } | null;
        return {
          ...a,
          kind: a.kind as AbsenceKind,
          reason: a.reason as AbsenceReason,
          applies_to: ((a as { applies_to?: string }).applies_to ?? 'all') as AbsenceScope,
          player_name: p ? `${p.first_name} ${p.last_name}`.trim() : 'שחקן',
          reported_by_name: (reported_by && names.get(reported_by)) || '',
        };
      });
    },
    async reportAbsence(a) {
      const { data: u } = await db().auth.getUser();
      const { applies_to, ...rest } = a;
      const row: Record<string, unknown> = { ...rest, note: a.note.trim(), team_id: teamId, reported_by: u.user?.id };
      const first = await db()
        .from('player_absences')
        .insert(applies_to && applies_to !== 'all' ? { ...row, applies_to } : row)
        .select('id')
        .single();
      if (first.error) throw first.error;
      return (first.data as { id: string } | null)?.id ?? null;
    },
    async updateAbsence(id, a) {
      const patch: Record<string, unknown> = { ...a };
      if (typeof a.note === 'string') patch.note = a.note.trim();
      const { error } = await db().from('player_absences').update(patch).eq('id', id);
      if (error) throw error;
    },
    async deleteAbsence(id) {
      const { error } = await db().from('player_absences').delete().eq('id', id);
      if (error) throw error;
    },
  };
}

/** Upcoming trainings of one team that I may see (team, goalkeeper, personal). */
export async function listTeamSessions(teamId: string): Promise<TrainingSession[]> {
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const query = (cols: string) =>
    db().from('training_sessions').select(cols).eq('team_id', teamId).gte('starts_at', since.toISOString()).order('starts_at').limit(120);
  const full = await query('id, starts_at, duration_min, title, location, note, canceled, kind, audience, series_id, private, created_by, training_participants (player_id)');
  if (!full.error) {
    return ((full.data ?? []) as unknown as (TrainingSession & { training_participants?: { player_id: string }[] })[]).map(({ training_participants, ...s }) => ({
      ...s,
      participants: (training_participants ?? []).map((p) => p.player_id),
    }));
  }
  if (!isMissing(full.error)) throw full.error;
  const { data, error } = await query('id, starts_at, duration_min, title, location, note, canceled');
  if (error) throw error;
  return (data ?? []) as unknown as TrainingSession[];
}

async function deleteOne(id: string) {
  const { data, error } = await db().from('training_sessions').delete().eq('id', id).select('id');
  if (error) throw error;
  mustTouch(data);
}

/** Row-level security skips rows silently: no row changed = not allowed. */
function mustTouch(rows: unknown[] | null) {
  if (!rows || rows.length === 0) throw new Error('not allowed');
}

/** Before the calendar migration: the same list without applies_to. */
async function legacyAbsences(teamId: string): Promise<Absence[]> {
  const { data, error } = await db()
    .from('player_absences')
    .select('id, player_id, kind, from_date, to_date, session_id, reason, note, minutes_late, reported_by, created_at, players (first_name, last_name)')
    .eq('team_id', teamId)
    .gte('to_date', recentCutoff())
    .order('from_date')
    .limit(200);
  if (error) throw error;
  const names = await namesFor((data ?? []).map((a) => a.reported_by));
  return (data ?? []).map(({ players, reported_by, ...a }) => {
    const p = players as unknown as { first_name: string; last_name: string } | null;
    return {
      ...a,
      kind: a.kind as AbsenceKind,
      reason: a.reason as AbsenceReason,
      applies_to: 'all' as AbsenceScope,
      player_name: p ? `${p.first_name} ${p.last_name}`.trim() : 'שחקן',
      reported_by_name: (reported_by && names.get(reported_by)) || '',
    };
  });
}

/* ----------------------------------------------------------------- demo */

interface DemoTeam {
  sessions: TrainingSession[];
  announcements: Announcement[];
  absences: Absence[];
}

const STORAGE_KEY = 'iplays.coach.demo.v1';
const memory: Record<string, DemoTeam> = {};

function loadAll(): Record<string, DemoTeam> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(memory, JSON.parse(raw));
  } catch {
    /* storage blocked: keep in memory only */
  }
  return memory;
}
function saveAll() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);

export interface DemoSeed {
  coach: string;
  /** weekly training slots: weekday 0=Sunday, "HH:MM", minutes, place */
  slots: { weekday: number; time: string; duration: number; location: string; title?: string }[];
  /** other players on the roster (used for sample reports the coach sees) */
  others: { id: string; name: string }[];
}

function seed(s: DemoSeed): DemoTeam {
  const today = new Date();
  const sessions: TrainingSession[] = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    for (const slot of s.slots.filter((x) => x.weekday === d.getDay())) {
      sessions.push({
        id: uid(),
        starts_at: localIso(ymd(d), slot.time),
        duration_min: slot.duration,
        title: slot.title ?? 'אימון קבוצתי',
        location: slot.location,
        note: '',
        canceled: false,
      });
    }
  }
  if (sessions[1]) sessions[1].note = 'להביא בקבוק מים ונעלי קט-רגל';
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const announcements: Announcement[] = [
    {
      id: uid(),
      title: 'ברוכים הבאים ללוח המאמן',
      body: 'כאן אפרסם עדכונים, שינויים בלוח האימונים ותזכורות. אם הילד לא יכול להגיע או מאחר, דווחו בכפתור "דיווח איחור / אי־הגעה". אירועים ידועים מראש (חתונה, טיול) אפשר לסמן כבר עכשיו.',
      pinned: true,
      author_name: s.coach,
      created_at: ago(72),
    },
    {
      id: uid(),
      title: 'תזכורת: אישורי רפואה',
      body: 'מי שעוד לא העביר אישור בדיקה רפואית לעונה, נא להביא לאימון הקרוב.',
      pinned: false,
      author_name: s.coach,
      created_at: ago(20),
    },
  ];
  const absences: Absence[] = [];
  const [a, b] = s.others;
  if (a && sessions[0]) {
    absences.push({
      id: uid(),
      player_id: a.id,
      player_name: a.name,
      kind: 'late',
      from_date: sessionDate(sessions[0]),
      to_date: sessionDate(sessions[0]),
      session_id: sessions[0].id,
      reason: 'school',
      note: 'חוזר מחוג',
      minutes_late: 15,
      applies_to: 'all',
      reported_by_name: 'הורה',
      created_at: ago(5),
    });
  }
  if (b) {
    const from = addDays(ymd(today), 8);
    absences.push({
      id: uid(),
      player_id: b.id,
      player_name: b.name,
      kind: 'absent',
      from_date: from,
      to_date: addDays(from, 2),
      session_id: null,
      reason: 'family_event',
      note: 'חתונה של בן דוד',
      minutes_late: null,
      applies_to: 'all',
      reported_by_name: 'הורה',
      created_at: ago(30),
    });
  }
  return { sessions, announcements, absences };
}

/** Demo backend for one team, persisted in this browser only. */
export function demoCoach(key: string, s: DemoSeed, me: { name: string; players: Map<string, string> }): CoachBackend {
  const all = loadAll();
  if (!all[key]) {
    all[key] = seed(s);
    saveAll();
  }
  const t = () => all[key];
  const done = async () => saveAll();
  const sortSessions = () => t().sessions.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  return {
    async listSessions() {
      const since = Date.now() - 24 * 3600_000;
      return sortSessions().filter((x) => new Date(x.starts_at).getTime() >= since);
    },
    async addSessions(input) {
      for (let i = 0; i < Math.max(1, input.repeatWeeks); i++) {
        t().sessions.push({
          id: uid(),
          starts_at: localIso(addDays(input.date, i * 7), input.time),
          duration_min: input.duration_min,
          title: input.title.trim() || 'אימון קבוצתי',
          location: input.location.trim(),
          note: input.note.trim(),
          canceled: false,
        });
      }
      return done();
    },
    async setCanceled(id, canceled) {
      const x = t().sessions.find((y) => y.id === id);
      if (x) x.canceled = canceled;
      return done();
    },
    async updateSession(s, patch) {
      const x = t().sessions.find((y) => y.id === s.id);
      if (x) Object.assign(x, patch);
      return done();
    },
    async deleteSession(id) {
      t().sessions = t().sessions.filter((x) => x.id !== id);
      t().absences.forEach((a) => a.session_id === id && (a.session_id = null));
      return done();
    },
    async deleteSeriesFrom(x) {
      return this.deleteSession(x.id);
    },
    async listAnnouncements() {
      return [...t().announcements].sort((x, y) => y.created_at.localeCompare(x.created_at));
    },
    async postAnnouncement(a) {
      t().announcements.push({ id: uid(), title: a.title.trim(), body: a.body.trim(), pinned: a.pinned, author_name: s.coach, created_at: new Date().toISOString() });
      return done();
    },
    async setPinned(id, pinned) {
      const x = t().announcements.find((y) => y.id === id);
      if (x) x.pinned = pinned;
      return done();
    },
    async deleteAnnouncement(id) {
      t().announcements = t().announcements.filter((x) => x.id !== id);
      return done();
    },
    async listAbsences() {
      const cutoff = recentCutoff();
      return t()
        .absences.filter((a) => a.to_date >= cutoff)
        .sort((x, y) => x.from_date.localeCompare(y.from_date));
    },
    async reportAbsence(a) {
      const id = uid();
      t().absences.push({
        ...a,
        applies_to: a.applies_to ?? 'all',
        note: a.note.trim(),
        id,
        player_name: me.players.get(a.player_id) ?? s.others.find((o) => o.id === a.player_id)?.name ?? 'שחקן',
        reported_by_name: me.name,
        created_at: new Date().toISOString(),
      });
      await done();
      return id;
    },
    async updateAbsence(id, patch) {
      const x = t().absences.find((y) => y.id === id);
      if (x) Object.assign(x, patch);
      return done();
    },
    async deleteAbsence(id) {
      t().absences = t().absences.filter((x) => x.id !== id);
      return done();
    },
  };
}
