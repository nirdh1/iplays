/**
 * Club OS data access. Reuses the V1 API modules (same tables, RPCs and RLS);
 * the only new query here is a date-range read of training_sessions.
 */
import { supabase } from '../lib/supabase';
import { addDays, todayYmd, type TrainingSession } from '../lib/coachApi';
import { attendanceReport, type AttendanceCell } from '../lib/calendarApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/** Trainings of one team between two local dates (inclusive), oldest first. */
export async function sessionsBetween(teamId: string, from: string, to: string): Promise<TrainingSession[]> {
  const start = new Date(`${from}T00:00:00`).toISOString();
  const end = new Date(`${addDays(to, 1)}T00:00:00`).toISOString();
  const { data, error } = await db()
    .from('training_sessions')
    .select('id, starts_at, duration_min, title, location, note, canceled, kind, audience, series_id, private, created_by')
    .eq('team_id', teamId)
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at')
    .limit(300);
  if (error) throw error;
  return (data ?? []) as TrainingSession[];
}

export interface PastAttendance {
  /** trainings in the window that already happened and were not canceled */
  held: string[];
  /** of those, trainings where staff marked nobody */
  unmarked: string[];
  /** marked cells only (present / late / absent / excused); null when nothing was marked */
  rate: number | null;
  markedCells: number;
}

/** Attendance over the last `days` days, counted from staff marks only. */
export async function pastAttendance(teamId: string, days = 14): Promise<PastAttendance> {
  const to = todayYmd();
  const from = addDays(to, -days);
  const cells: AttendanceCell[] = await attendanceReport(teamId, from, to);
  const now = Date.now();
  const training = cells.filter((c) => c.kind === 'training' && new Date(c.starts_at).getTime() < now);
  const held = [...new Set(training.map((c) => c.event_id))];
  const markedEvents = new Set(training.filter((c) => c.source === 'mark').map((c) => c.event_id));
  const marked = training.filter((c) => c.source === 'mark');
  const came = marked.filter((c) => c.status === 'present' || c.status === 'late').length;
  return {
    held,
    unmarked: held.filter((id) => !markedEvents.has(id)),
    rate: marked.length ? Math.round((came / marked.length) * 100) : null,
    markedCells: marked.length,
  };
}

export const weekStart = (d = todayYmd()) => {
  const [y, m, day] = d.split('-').map(Number);
  const dow = new Date(y, m - 1, day).getDay(); // 0 = Sunday, the Israeli week start
  return addDays(d, -dow);
};

const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });
export const dayLabel = (iso: string) => dayFmt.format(new Date(iso));
export const timeLabel = (iso: string) => timeFmt.format(new Date(iso));
