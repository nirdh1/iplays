/**
 * Unified calendar helpers: personal / goalkeeper trainings, medical
 * documents for absences, attendance reports and conflict detection.
 * Server side: supabase/migrations/20261102100000_calendar_absences.sql
 */
import { supabase } from './supabase';
import { isMissing, type AbsenceReason, type TrainingAudience, type TrainingKind } from './coachApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/** The profile's position list uses 'שוער' for a goalkeeper. */
export const isGoalkeeperPosition = (position: string | null | undefined) => !!position && /שוער|^gk$|goalkeeper/i.test(position.trim());

export const trainingTypeLabel = (kind?: TrainingKind, audience?: TrainingAudience): string | null => {
  if (!kind || kind === 'team') return null;
  if (kind === 'personal') return 'אימון אישי';
  return audience === 'goalkeepers' ? 'שוערים · קבוצתי' : 'שוערים';
};

/* ------------------------------------------------------------ trainings */

export interface NewTraining {
  teamId: string;
  kind: TrainingKind;
  audience: TrainingAudience;
  starts: string[]; // ISO, one per date
  durationMin: number;
  title: string;
  location: string;
  note: string;
  players: string[];
}

export async function createTrainings(t: NewTraining): Promise<void> {
  const { error } = await db().rpc('create_trainings', {
    p_team: t.teamId,
    p_kind: t.kind,
    p_audience: t.audience,
    p_starts: t.starts,
    p_duration: t.durationMin,
    p_title: t.title.trim() || null,
    p_location: t.location.trim(),
    p_note: t.note.trim(),
    p_players: t.players,
  });
  if (error) throw error;
}

export function calendarError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? '';
  if (isMissing(e)) return 'האפשרות הזו תפעל אחרי עדכון מסד הנתונים (קובץ SQL של היומן המאוחד).';
  if (msg.includes('include your own child')) return 'צריך לבחור לפחות ילד אחד שלכם.';
  if (msg.includes('only for parents of a goalkeeper')) return 'אימון שוערים קבוצתי פתוח להורים של שוערים בקבוצה.';
  if (msg.includes('pick 1 to 40 players')) return 'בחרו לפחות שחקן אחד (עד 40).';
  if (msg.includes('player not in this team')) return 'אחד השחקנים כבר לא בקבוצה.';
  if (msg.includes('between 1 and 52 dates')) return 'אפשר להוסיף עד 52 מועדים בבת אחת.';
  if (msg.includes('not allowed')) return 'אין לך הרשאה לפעולה הזו.';
  if (msg.includes('player_absences_reason_check')) return 'הסיבה הזו תפעל אחרי עדכון מסד הנתונים.';
  if (msg.includes('mime') || msg.includes('size_bytes') || msg.includes('Payload too large')) return 'אפשר לצרף תמונה או PDF עד 10MB.';
  return null;
}

/* ---------------------------------------------------- medical documents */

const BUCKET = 'medical-docs';
export const docTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

export interface AbsenceDoc {
  id: string;
  absence_id: string;
  storage_path: string;
  file_name: string;
  mime: string;
}

export async function uploadAbsenceDoc(absenceId: string, file: File): Promise<void> {
  if (!docTypes.includes(file.type)) throw new Error('mime');
  if (file.size > MAX_DOC_BYTES) throw new Error('size_bytes');
  const ext = (file.name.split('.').pop() || (file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const path = `${absenceId}/${crypto.randomUUID()}.${ext}`;
  const up = await db().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const { data: u } = await db().auth.getUser();
  const { error } = await db().from('absence_documents').insert({
    absence_id: absenceId,
    // player / team are filled from the absence by the server
    player_id: '00000000-0000-0000-0000-000000000000',
    team_id: '00000000-0000-0000-0000-000000000000',
    storage_path: path,
    file_name: file.name.slice(0, 120),
    mime: file.type,
    size_bytes: file.size,
    uploaded_by: u.user?.id,
  });
  if (error) {
    await db().storage.from(BUCKET).remove([path]);
    throw error;
  }
}

/** Documents I may see (RLS: the child's family, people with the medical permission). */
export async function listAbsenceDocs(absenceIds: string[]): Promise<AbsenceDoc[]> {
  if (!absenceIds.length) return [];
  const { data, error } = await db().from('absence_documents').select('id, absence_id, storage_path, file_name, mime').in('absence_id', absenceIds);
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return (data ?? []) as AbsenceDoc[];
}

export async function openAbsenceDoc(doc: AbsenceDoc): Promise<void> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(doc.storage_path, 120);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

export async function removeAbsenceDoc(doc: AbsenceDoc): Promise<void> {
  const { error } = await db().from('absence_documents').delete().eq('id', doc.id);
  if (error) throw error;
  await db().storage.from(BUCKET).remove([doc.storage_path]);
}

/* ----------------------------------------------------------- attendance */

export type CellStatus = 'present' | 'late' | 'absent' | 'excused';

export interface AttendanceCell {
  player_id: string;
  first_name: string;
  last_name: string;
  kind: 'training' | 'match';
  event_id: string;
  starts_at: string;
  title: string;
  status: CellStatus;
  reason: AbsenceReason | null;
  source: 'mark' | 'report' | 'default';
}

export async function attendanceReport(teamId: string, from: string, to: string): Promise<AttendanceCell[]> {
  const { data, error } = await db().rpc('attendance_report', { p_team: teamId, p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as AttendanceCell[];
}

export type ChildCell = Omit<AttendanceCell, 'player_id' | 'first_name' | 'last_name'> & { team_id: string };

export async function playerAttendance(playerId: string, from: string, to: string): Promise<ChildCell[]> {
  const { data, error } = await db().rpc('player_attendance', { p_player: playerId, p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as ChildCell[];
}

export const attended = (s: CellStatus) => s === 'present' || s === 'late';

export function rateOf(cells: { status: CellStatus }[]): number | null {
  if (!cells.length) return null;
  return Math.round((100 * cells.filter((c) => attended(c.status)).length) / cells.length);
}

/* ------------------------------------------------------------ conflicts */

export interface Timed {
  key: string;
  at: number;
  endsAt: number;
  canceled?: boolean;
}

/** Keys of events that overlap another event in the same list. */
export function overlapping<T extends Timed>(list: T[]): Set<string> {
  const out = new Set<string>();
  const live = list.filter((e) => !e.canceled).sort((a, b) => a.at - b.at);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length && live[j].at < live[i].endsAt; j++) {
      out.add(live[i].key);
      out.add(live[j].key);
    }
  }
  return out;
}
