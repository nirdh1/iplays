/**
 * Attendance for one training or match. Everyone counts as coming unless a
 * parent reported otherwise; staff mark only the exceptions (or confirm).
 */
import { useCallback, useEffect, useState } from 'react';
import { BottomSheet } from '../components/shell';
import { Tag } from '../components/ui';
import { friendlyError } from '../lib/api';
import { reasonLabel, type AbsenceReason } from '../lib/coachApi';
import { eventAttendance, markAttendance, markLabel, matchError, type AttendanceRow, type EventKind, type MarkStatus } from '../lib/matchApi';

const marks: MarkStatus[] = ['present', 'late', 'absent', 'excused'];

export function AttendanceSheet({ kind, eventId, title, onClose }: { kind: EventKind; eventId: string | null; title: string; onClose: () => void }) {
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      setRows(await eventAttendance(kind, eventId));
    } catch (e) {
      setError(matchError(e) ?? friendlyError(e));
    }
  }, [kind, eventId]);

  useEffect(() => {
    setRows(null);
    setError(null);
    void load();
  }, [load]);

  async function mark(r: AttendanceRow, status: MarkStatus) {
    if (!eventId) return;
    let minutes: number | null = null;
    if (status === 'late') {
      const v = prompt('כמה דקות איחור?', String(r.reported_minutes_late ?? 10));
      if (v === null) return;
      minutes = Math.max(1, Math.min(180, Number(v) || 10));
    }
    try {
      await markAttendance(kind, eventId, r.player_id, r.status === status && status !== 'late' ? null : status, minutes);
      await load();
    } catch (e) {
      setError(matchError(e) ?? friendlyError(e));
    }
  }

  const count = (s: string) => rows?.filter((r) => r.effective === s).length ?? 0;

  return (
    <BottomSheet open={eventId !== null} onClose={onClose} title={title}>
      <div className="ip-form ip-form--sheet">
        {rows && (
          <p className="ip-muted">
            {count('coming') + count('present')} מגיעים · {count('late')} באיחור · {count('absent') + count('excused')} חסרים
          </p>
        )}
        <p className="ip-footnote">ברירת המחדל: כולם מגיעים, אלא אם הורה דיווח אחרת. מסמנים רק חריגים, או "נוכח/ת" לאישור.</p>
        {error && <p className="ip-error" role="alert">{error}</p>}
        {rows === null ? (
          <p className="ip-muted">טוען…</p>
        ) : rows.length === 0 ? (
          <p className="ip-muted">אין שחקנים, או שאין לך הרשאה לנוכחות בקבוצה הזו.</p>
        ) : (
          <ul className="ip-att-list">
            {rows.map((r) => (
              <li key={r.player_id} className={`ip-att is-${r.effective}`}>
                <div className="ip-att-who">
                  <span className="ip-roster-no">{r.shirt_number ?? '–'}</span>
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">
                      {r.first_name} {r.last_name}
                    </span>
                    <span className="ip-list-row-sub">
                      {r.expected !== 'coming'
                        ? `דיווח הורה: ${r.expected === 'late' ? `איחור${r.reported_minutes_late ? ` ${r.reported_minutes_late} דק׳` : ''}` : 'לא מגיע/ה'}${r.reason ? ` · ${reasonLabel[r.reason as AbsenceReason] ?? r.reason}` : ''}`
                        : r.status
                          ? 'סומן ע״י הצוות'
                          : 'ברירת מחדל'}
                    </span>
                  </span>
                  <Tag tone={r.effective === 'absent' ? 'live' : r.effective === 'late' || r.effective === 'excused' ? 'warning' : 'lime'}>
                    {markLabel[r.effective]}
                    {r.effective === 'late' && r.minutes_late ? ` ${r.minutes_late}׳` : ''}
                  </Tag>
                </div>
                <div className="ip-att-marks" role="group" aria-label={`נוכחות ${r.first_name}`}>
                  {marks.map((m) => (
                    <button key={m} type="button" className={r.status === m ? 'is-on' : ''} onClick={() => void mark(r, m)}>
                      {markLabel[m]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
