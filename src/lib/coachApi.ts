/**
 * Coach board data: training sessions, coach announcements and absence /
 * lateness reports. Two backends share one interface: Supabase (RLS in
 * supabase/migrations/20261101100000_coach.sql) and a demo store kept in
 * the browser so the static preview stays fully clickable.
 */
import { supabase } from './supabase';

export type AbsenceKind = 'absent' | 'late';
export type AbsenceReason = 'family_event' | 'vacation' | 'sick' | 'school' | 'other';

export const reasonLabel: Record<AbsenceReason, string> = {
  family_event: 'אירוע משפחתי',
  vacation: 'חופשה / נסיעה',
  sick: 'מחלה / פציעה',
  school: 'לימודים / מבחן',
  other: 'אחר',
};

export interface TrainingSession {
  id: string;
  starts_at: string; // ISO
  duration_min: number;
  title: string;
  location: string;
  note: string;
  canceled: boolean;
}

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
}

export interface CoachBackend {
  listSessions(): Promise<TrainingSession[]>;
  addSessions(input: SessionInput): Promise<void>;
  setCanceled(id: string, canceled: boolean): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listAnnouncements(): Promise<Announcement[]>;
  postAnnouncement(a: { title: string; body: string; pinned: boolean }): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  deleteAnnouncement(id: string): Promise<void>;
  listAbsences(): Promise<Absence[]>;
  reportAbsence(a: AbsenceInput): Promise<void>;
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
  const d = sessionDate(s);
  return a.from_date <= d && d <= a.to_date;
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
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const { data, error } = await db()
        .from('training_sessions')
        .select('id, starts_at, duration_min, title, location, note, canceled')
        .eq('team_id', teamId)
        .gte('starts_at', since.toISOString())
        .order('starts_at')
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
    async addSessions(input) {
      const rows = Array.from({ length: Math.max(1, input.repeatWeeks) }, (_, i) => ({
        team_id: teamId,
        starts_at: localIso(addDays(input.date, i * 7), input.time),
        duration_min: input.duration_min,
        title: input.title.trim() || 'אימון קבוצתי',
        location: input.location.trim(),
        note: input.note.trim(),
      }));
      const { error } = await db().from('training_sessions').insert(rows);
      if (error) throw error;
    },
    async setCanceled(id, canceled) {
      const { error } = await db().from('training_sessions').update({ canceled }).eq('id', id);
      if (error) throw error;
    },
    async deleteSession(id) {
      const { error } = await db().from('training_sessions').delete().eq('id', id);
      if (error) throw error;
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
          player_name: p ? `${p.first_name} ${p.last_name}`.trim() : 'שחקן',
          reported_by_name: (reported_by && names.get(reported_by)) || '',
        };
      });
    },
    async reportAbsence(a) {
      const { data: u } = await db().auth.getUser();
      const { error } = await db()
        .from('player_absences')
        .insert({ ...a, note: a.note.trim(), team_id: teamId, reported_by: u.user?.id });
      if (error) throw error;
    },
    async deleteAbsence(id) {
      const { error } = await db().from('player_absences').delete().eq('id', id);
      if (error) throw error;
    },
  };
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
    async deleteSession(id) {
      t().sessions = t().sessions.filter((x) => x.id !== id);
      t().absences.forEach((a) => a.session_id === id && (a.session_id = null));
      return done();
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
      t().absences.push({
        ...a,
        note: a.note.trim(),
        id: uid(),
        player_name: me.players.get(a.player_id) ?? s.others.find((o) => o.id === a.player_id)?.name ?? 'שחקן',
        reported_by_name: me.name,
        created_at: new Date().toISOString(),
      });
      return done();
    },
    async deleteAbsence(id) {
      t().absences = t().absences.filter((x) => x.id !== id);
      return done();
    },
  };
}
