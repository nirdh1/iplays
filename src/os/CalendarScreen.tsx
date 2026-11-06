import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { friendlyError, type MyTeam } from '../lib/api';
import { addDays, localIso, sessionDate, supabaseCoach, todayYmd, type TrainingSession } from '../lib/coachApi';
import { eventAttendance, markAttendance, markLabel, type AttendanceRow, type MarkStatus } from '../lib/matchApi';
import { reasonLabel, type AbsenceReason } from '../lib/coachApi';
import { dayLabel, sessionsBetween, timeLabel } from './data';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

/** Team calendar (14 days back, 28 ahead) and, with a session id, that training's page. */
export function CalendarScreen({ team, sessionId }: { team: MyTeam; sessionId?: string }) {
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    const today = todayYmd();
    return sessionsBetween(team.id, addDays(today, -14), addDays(today, 28))
      .then(setSessions)
      .catch((e) => setError(friendlyError(e)));
  }, [team.id]);
  useEffect(() => {
    setSessions(null);
    setError(null);
    void load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!sessions) return <Loading />;

  if (sessionId) {
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return <NoData>האימון לא נמצא בטווח של היומן (14 ימים אחורה, 28 קדימה)</NoData>;
    return <SessionPage team={team} session={s} onChanged={load} />;
  }

  const byDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    const d = sessionDate(s);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const today = todayYmd();

  return (
    <div className="os-stack">
      <div className="os-row">
        <span className="os-muted">14 ימים אחורה, 28 קדימה</span>
        <button type="button" className="os-btn" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? 'סגירה' : '+ אימון חדש'}
        </button>
      </div>
      {adding && (
        <NewSessionForm
          team={team}
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {sessions.length === 0 && <NoData>אין אימונים בטווח הזה</NoData>}
      {[...byDay.entries()].map(([d, list]) => (
        <section key={d} className={`os-day${d === today ? ' is-today' : ''}`}>
          <h3>{d === today ? 'היום · ' : ''}{dayLabel(list[0].starts_at)}</h3>
          <ul className="os-list">
            {list.map((s) => (
              <li key={s.id}>
                <a href={`#os/calendar/${s.id}`}>
                  <span>
                    <strong>{timeLabel(s.starts_at)}</strong> {s.title} · {s.duration_min} דק׳
                    {s.location ? <span className="os-muted"> · {s.location}</span> : null}
                  </span>
                  <SessionChip s={s} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SessionChip({ s }: { s: TrainingSession }) {
  if (s.canceled) return <span className="os-chip os-chip--off">בוטל</span>;
  if (new Date(s.starts_at).getTime() > Date.now()) return <span className="os-chip">מתוכנן</span>;
  return <span className="os-chip os-chip--done">התקיים</span>;
}

function NewSessionForm({ team, onDone }: { team: MyTeam; onDone: () => void }) {
  const [date, setDate] = useState(todayYmd());
  const [time, setTime] = useState('17:30');
  const [duration, setDuration] = useState(90);
  const [title, setTitle] = useState('אימון קבוצתי');
  const [location, setLocation] = useState('');
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await supabaseCoach(team.id).addSessions({ date, time, duration_min: duration, title: title.trim() || 'אימון קבוצתי', location: location.trim(), note: '', repeatWeeks: weeks });
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="os-card os-form" onSubmit={submit}>
      <label>
        תאריך
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>
        שעה
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </label>
      <label>
        משך (דק׳)
        <input type="number" min={15} max={300} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} required />
      </label>
      <label>
        כותרת
        <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        מקום
        <input value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label>
        חזרה שבועית
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
          <option value={1}>פעם אחת</option>
          <option value={4}>4 שבועות</option>
          <option value={8}>8 שבועות</option>
          <option value={12}>12 שבועות</option>
        </select>
      </label>
      {error && <ErrorNote message={error} />}
      <button type="submit" className="os-btn" disabled={busy}>
        {busy ? 'שומר…' : 'שמירה'}
      </button>
    </form>
  );
}

function SessionPage({ team, session: s, onChanged }: { team: MyTeam; session: TrainingSession; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = new Date(s.starts_at).getTime() <= Date.now() + 60 * 60 * 1000; // attendance opens an hour before

  const toggleCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await supabaseCoach(team.id).setCanceled(s.id, !s.canceled);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="os-stack">
      <a className="os-back" href="#os/calendar">
        → ליומן
      </a>
      <section className="os-card">
        <div className="os-card__head">
          <h2>
            {s.title} · {dayLabel(s.starts_at)} · {timeLabel(s.starts_at)}
          </h2>
          <SessionChip s={s} />
        </div>
        <p className="os-muted">
          {s.duration_min} דק׳{s.location ? ` · ${s.location}` : ''}
          {s.note ? ` · ${s.note}` : ''}
        </p>
        <p className="os-muted os-small">מערך אימון: עוד לא מומש (יום 4)</p>
        <div className="os-row">
          <button type="button" className="os-btn os-btn--ghost" onClick={() => setEditing((v) => !v)} disabled={busy}>
            {editing ? 'סגירת עריכה' : 'עריכה'}
          </button>
          <button type="button" className="os-btn os-btn--ghost" onClick={toggleCancel} disabled={busy}>
            {s.canceled ? 'החזרת האימון' : 'ביטול האימון'}
          </button>
        </div>
        {error && <ErrorNote message={error} />}
        {editing && (
          <EditSession
            team={team}
            s={s}
            onDone={async () => {
              setEditing(false);
              await onChanged();
            }}
          />
        )}
      </section>
      {!s.canceled && (started ? <AttendanceCard session={s} /> : <NoData>סימון נוכחות נפתח שעה לפני האימון</NoData>)}
    </div>
  );
}

function EditSession({ team, s, onDone }: { team: MyTeam; s: TrainingSession; onDone: () => Promise<void> }) {
  const d = new Date(s.starts_at);
  const [date, setDate] = useState(sessionDate(s));
  const [time, setTime] = useState(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  const [duration, setDuration] = useState(s.duration_min);
  const [title, setTitle] = useState(s.title);
  const [location, setLocation] = useState(s.location);
  const [note, setNote] = useState(s.note);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await supabaseCoach(team.id).updateSession(s, { starts_at: localIso(date, time), duration_min: duration, title: title.trim() || s.title, location: location.trim(), note: note.trim() }, following);
      await onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="os-form os-form--inline" onSubmit={submit}>
      <label>
        תאריך
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>
        שעה
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </label>
      <label>
        משך
        <input type="number" min={15} max={300} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
      </label>
      <label>
        כותרת
        <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        מקום
        <input value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label>
        הערה
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      {s.series_id && (
        <label className="os-check">
          <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
          גם לאימונים הבאים בסדרה
        </label>
      )}
      {error && <ErrorNote message={error} />}
      <button type="submit" className="os-btn" disabled={busy}>
        {busy ? 'שומר…' : 'שמירת שינויים'}
      </button>
    </form>
  );
}

const marks: { v: MarkStatus; label: string }[] = [
  { v: 'present', label: 'הגיע' },
  { v: 'late', label: 'איחר' },
  { v: 'absent', label: 'לא הגיע' },
];

/** Fast attendance: one tap per player, saved immediately through mark_attendance. */
function AttendanceCard({ session }: { session: TrainingSession }) {
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const reload = useCallback(() => eventAttendance('training', session.id).then(setRows).catch((e) => setError(friendlyError(e))), [session.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const mark = async (playerIds: string[], status: MarkStatus | null) => {
    setError(null);
    setSaving((s) => new Set([...s, ...playerIds]));
    setRows((rs) => rs && rs.map((r) => (playerIds.includes(r.player_id) ? { ...r, status, effective: status ?? r.expected } : r)));
    try {
      for (const id of playerIds) await markAttendance('training', session.id, id, status, status === 'late' ? 10 : null);
    } catch (e) {
      setError(friendlyError(e));
      await reload();
    } finally {
      setSaving((s) => new Set([...s].filter((x) => !playerIds.includes(x))));
    }
  };

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, open: 0 };
    for (const r of rows ?? []) {
      if (r.status === 'present') c.present++;
      else if (r.status === 'late') c.late++;
      else if (r.status === 'absent' || r.status === 'excused') c.absent++;
      else c.open++;
    }
    return c;
  }, [rows]);

  if (error && !rows) return <ErrorNote message={error} />;
  if (!rows) return <Loading />;
  const unmarked = rows.filter((r) => !r.status && r.expected === 'coming').map((r) => r.player_id);

  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>נוכחות</h2>
        <SourceTag source="coach" />
      </div>
      <p className="os-muted">
        הגיעו {counts.present} · איחרו {counts.late} · לא הגיעו {counts.absent} · לא סומנו {counts.open}
      </p>
      {unmarked.length > 0 && (
        <button type="button" className="os-btn" onClick={() => mark(unmarked, 'present')}>
          סמן את כל השאר "הגיע" ({unmarked.length})
        </button>
      )}
      {error && <ErrorNote message={error} />}
      <ul className="os-attn">
        {rows.map((r) => (
          <li key={r.player_id} className={saving.has(r.player_id) ? 'is-saving' : undefined}>
            <span className="os-shirt">{r.shirt_number ?? '–'}</span>
            <span className="os-attn__name">
              {r.first_name} {r.last_name}
              {r.expected !== 'coming' && (
                <small className="os-chip os-chip--warn">
                  דווח: {markLabel[r.expected]}
                  {r.reason ? ` · ${reasonLabel[r.reason as AbsenceReason] ?? r.reason}` : ''}
                </small>
              )}
            </span>
            <span className="os-seg" role="group" aria-label={`נוכחות ${r.first_name}`}>
              {marks.map((m) => (
                <button key={m.v} type="button" className={r.status === m.v ? `is-on is-${m.v}` : undefined} aria-pressed={r.status === m.v} onClick={() => mark([r.player_id], r.status === m.v ? null : m.v)}>
                  {m.label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
