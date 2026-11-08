import { useEffect, useRef, useState } from 'react';
import { friendlyError, type MyTeam } from '../lib/api';
import { addDays, sessionDate, todayYmd, type TrainingSession } from '../lib/coachApi';
import { AttendanceCard } from './CalendarScreen';
import { dayLabel, sessionsBetween, timeLabel } from './data';
import { AnimatedPitch } from './pitch/AnimatedPitch';
import { parseDiagram } from './pitch/model';
import { getAssignment, getReport, submitReport, type Assignment, type BlockStatus, type TrainingReport } from './plans/api';
import { clock, stationFor, stationPhase } from './plans/timer';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

type SnapBlock = Assignment['snapshot']['blocks'][number] & { minutes?: number };

/** #os/day (today's training, or the next one) and #os/day/<sessionId> */
export function TrainingDayScreen({ team, sessionId }: { team: MyTeam; sessionId?: string }) {
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    sessionsBetween(team.id, addDays(todayYmd(), -7), addDays(todayYmd(), 7))
      .then((l) => setSessions(l.filter((s) => !s.canceled)))
      .catch((e) => setError(friendlyError(e)));
  }, [team.id]);
  if (error) return <ErrorNote message={error} />;
  if (!sessions) return <Loading />;
  const today = sessions.filter((s) => sessionDate(s) === todayYmd());
  const chosen =
    sessions.find((s) => s.id === sessionId) ?? today[0] ?? sessions.find((s) => new Date(s.starts_at).getTime() > Date.now());
  const recent = sessions.filter((s) => new Date(s.starts_at).getTime() <= Date.now() + 3600_000).slice(-4).reverse();
  if (!chosen) return <NoData>אין אימון היום או בשבוע הקרוב</NoData>;
  return (
    <div className="os-stack">
      {recent.length > 1 && (
        <nav className="os-row os-row--start os-small" aria-label="אימונים אחרונים">
          <span className="os-muted">אימון:</span>
          {recent.map((s) => (
            <a key={s.id} className={`os-chip${s.id === chosen.id ? ' os-chip--done' : ''}`} href={`#os/day/${s.id}`}>
              {dayLabel(s.starts_at)} {timeLabel(s.starts_at)}
            </a>
          ))}
        </nav>
      )}
      <DayBody key={chosen.id} s={chosen} />
    </div>
  );
}

function DayBody({ s }: { s: TrainingSession }) {
  const [a, setA] = useState<Assignment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getAssignment(s.id).then(setA).catch((e) => setError(friendlyError(e)));
  }, [s.id]);
  const started = new Date(s.starts_at).getTime() <= Date.now() + 3600_000;
  const blocks = ((a?.snapshot.blocks ?? []) as SnapBlock[]);
  return (
    <>
      <section className="os-card">
        <div className="os-card__head">
          <h2>
            {s.title} · {dayLabel(s.starts_at)} · {timeLabel(s.starts_at)}
          </h2>
          <a className="os-back" href={`#os/calendar/${s.id}`}>
            ביומן
          </a>
        </div>
        <p className="os-muted">
          {s.duration_min} דק׳{s.location ? ` · ${s.location}` : ''}
          {a ? ` · מערך: ${a.snapshot.title} (${a.snapshot.total_min} דק׳)` : ''}
        </p>
        {a?.snapshot.goal && <p>נושא: {a.snapshot.goal}</p>}
      </section>
      {error && <ErrorNote message={error} />}
      {a === undefined && !error ? (
        <Loading />
      ) : a ? (
        <Runner sessionId={s.id} blocks={blocks} />
      ) : (
        <section className="os-card">
          <p className="os-muted">לאימון הזה לא שויך מערך, ולכן אין טיימר שלבים.</p>
          <a className="os-btn os-btn--ghost" href="#os/plans">
            שייך מערך
          </a>
        </section>
      )}
      {started ? <AttendanceCard session={s} /> : <NoData>סימון נוכחות נפתח שעה לפני האימון</NoData>}
      {!started ? <NoData>הדוח נפתח כשהאימון מתחיל</NoData> : a !== undefined && <ReportCard sessionId={s.id} blocks={blocks} />}
    </>
  );
}

interface RunState {
  index: number;
  elapsed: number; // seconds in the current block, while paused
  runningSince: number | null; // epoch ms
}
const key = (id: string) => `iplays.os.day.${id}`;
function loadRun(id: string): RunState {
  try {
    const r = JSON.parse(localStorage.getItem(key(id)) ?? '');
    if (typeof r.index === 'number') return r;
  } catch {
    /* no saved timer */
  }
  return { index: 0, elapsed: 0, runningSince: null };
}
function saveRun(id: string, r: RunState) {
  try {
    localStorage.setItem(key(id), JSON.stringify(r));
  } catch {
    /* storage unavailable: the timer lasts for this visit */
  }
}

function Runner({ sessionId, blocks }: { sessionId: string; blocks: SnapBlock[] }) {
  const [run, setRun] = useState<RunState>(() => loadRun(sessionId));
  const [, tick] = useState(0);
  const beeped = useRef<string>('');
  useEffect(() => saveRun(sessionId, run), [sessionId, run]);
  useEffect(() => {
    if (!run.runningSince) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [run.runningSince]);

  if (!blocks.length) return <NoData>המערך ריק</NoData>;
  const idx = Math.min(run.index, blocks.length - 1);
  const b = blocks[idx];
  const elapsed = run.elapsed + (run.runningSince ? (Date.now() - run.runningSince) / 1000 : 0);
  const minutes = b.minutes ?? (b.kind === 'stations' ? (b.rounds ?? 1) * (b.station_min ?? 0) + Math.max((b.rounds ?? 1) - 1, 0) * (b.transition_min ?? 0) : b.duration_min ?? 0);
  const phase = b.kind === 'stations' ? stationPhase(elapsed, b.rounds ?? 1, b.station_min ?? 1, b.transition_min ?? 0) : null;
  const remaining = phase ? phase.remainingSec : minutes * 60 - elapsed;
  const over = !phase && remaining < 0;
  const phaseKey = phase ? `${idx}-${phase.round}-${phase.transition}` : `${idx}-${over}`;
  if (run.runningSince && phaseKey !== beeped.current) {
    if (beeped.current && 'vibrate' in navigator) navigator.vibrate?.(300);
    beeped.current = phaseKey;
  }

  const toggle = () =>
    setRun((r) => (r.runningSince ? { ...r, elapsed: r.elapsed + (Date.now() - r.runningSince) / 1000, runningSince: null } : { ...r, runningSince: Date.now() }));
  const go = (to: number) => setRun((r) => ({ index: Math.max(0, Math.min(blocks.length - 1, to)), elapsed: 0, runningSince: r.runningSince ? Date.now() : null }));
  const ex = b.kind === 'exercise' ? b.exercise : null;
  const n = b.stations?.length ?? 0;

  return (
    <section className="os-card os-run" aria-live="polite">
      <div className="os-card__head">
        <h2>
          שלב {idx + 1} מתוך {blocks.length}: {b.kind === 'stations' ? `תחנות${b.title ? ` · ${b.title}` : ''}` : b.kind === 'break' ? b.title || 'הפסקה' : ex?.title ?? b.title}
        </h2>
        <span className="os-chip">{minutes} דק׳</span>
      </div>
      <div className={`os-run__clock${over ? ' is-over' : ''}${phase?.transition ? ' is-transition' : ''}`}>
        <strong>{over ? `+${clock(-remaining)}` : clock(remaining)}</strong>
        <span>
          {phase
            ? phase.done
              ? 'התחנות הסתיימו'
              : phase.transition
                ? `מעבר אחרי סבב ${phase.round}`
                : `סבב ${phase.round} מתוך ${b.rounds}`
            : over
              ? 'הזמן של השלב עבר'
              : 'נשאר בשלב'}
        </span>
      </div>
      <div className="os-row os-row--start">
        <button type="button" className="os-btn" onClick={toggle}>
          {run.runningSince ? 'השהה' : elapsed > 0 ? 'המשך' : 'התחל'}
        </button>
        <button type="button" className="os-btn os-btn--ghost" onClick={() => go(idx - 1)} disabled={idx === 0}>
          הקודם
        </button>
        <button type="button" className="os-btn os-btn--ghost" onClick={() => go(idx + 1)} disabled={idx === blocks.length - 1}>
          השלב הבא
        </button>
        <button type="button" className="os-btn os-btn--ghost" onClick={() => setRun((r) => ({ ...r, elapsed: 0, runningSince: r.runningSince ? Date.now() : null }))}>
          איפוס השלב
        </button>
      </div>

      {b.goal && <p>מטרה: {b.goal}</p>}
      {ex && (
        <div className="os-block__ex">
          <AnimatedPitch preset={ex.pitch_preset} areaW={ex.area_w_m} areaL={ex.area_l_m} diagram={parseDiagram(ex.diagram)} className="os-pitch--day" />
          <div>
            {ex.coaching_points && <p className="os-pre">{ex.coaching_points}</p>}
            {ex.equipment && ex.equipment.length > 0 && <p className="os-muted os-small">ציוד: {ex.equipment.join(' · ')}</p>}
          </div>
        </div>
      )}
      {b.kind === 'stations' && phase && (
        <table className="os-table">
          <thead>
            <tr>
              <th>קבוצה</th>
              <th>תחנה עכשיו</th>
              <th>אחראי</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(b.groups ?? n, n) }, (_, g) => {
              const st = b.stations[stationFor(g, phase.round, n)];
              return (
                <tr key={g}>
                  <td>קבוצה {g + 1}</td>
                  <td>
                    <strong>{stationFor(g, phase.round, n) + 1}.</strong> {st.exercise?.title ?? st.title}
                  </td>
                  <td>{st.responsible || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {b.kind === 'stations' && (b.groups ?? n) > n && <p className="os-muted os-small">יש יותר קבוצות מתחנות; הטבלה מציגה קבוצה אחת לכל תחנה.</p>}

      <ol className="os-run__steps">
        {blocks.map((x, i) => (
          <li key={i} className={i === idx ? 'is-now' : i < idx ? 'is-past' : ''}>
            <button type="button" onClick={() => go(i)}>
              {x.kind === 'stations' ? `תחנות${x.title ? `: ${x.title}` : ''}` : x.kind === 'break' ? x.title || 'הפסקה' : x.exercise?.title ?? x.title}
              <span className="os-muted os-small"> · {x.minutes ?? '—'} דק׳</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

const statusLabel: Record<BlockStatus, string> = { done: 'בוצע', changed: 'שונה', skipped: 'דולג' };

function ReportCard({ sessionId, blocks }: { sessionId: string; blocks: SnapBlock[] }) {
  const [report, setReport] = useState<TrainingReport | null | undefined>(undefined);
  const [statuses, setStatuses] = useState<BlockStatus[]>(() => blocks.map(() => 'done'));
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    getReport(sessionId)
      .then((r) => {
        setReport(r);
        if (r) {
          setStatuses(blocks.map((_, i) => r.blocks.find((x) => x.ord === i)?.status ?? 'done'));
          setRating(r.rating);
          setNote(r.note);
        }
      })
      .catch((e) => setError(friendlyError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitReport(sessionId, { blocks: blocks.map((_, ord) => ({ ord, status: statuses[ord] ?? 'done' })), rating, note });
      setReport(await getReport(sessionId));
      setEditing(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (report === undefined && !error) return <Loading />;
  const showForm = !report || editing;
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>דוח בדקה</h2>
        {report && <span className="os-chip os-chip--done">נשלח {new Date(report.updated_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {error && <ErrorNote message={error} />}
      {!showForm && report ? (
        <>
          <ul className="os-list os-list--plain">
            {blocks.map((b, i) => (
              <li key={i}>
                {b.kind === 'stations' ? 'תחנות' : b.kind === 'break' ? b.title || 'הפסקה' : b.exercise?.title ?? b.title}: <strong>{statusLabel[statuses[i] ?? 'done']}</strong>
              </li>
            ))}
          </ul>
          <p>
            {report.rating ? `דירוג: ${report.rating}/5` : 'בלי דירוג'}
            {report.note ? ` · ${report.note}` : ''}
          </p>
          <SourceTag source="coach" />
          <button type="button" className="os-btn os-btn--ghost" onClick={() => setEditing(true)}>
            עריכת הדוח
          </button>
        </>
      ) : (
        <>
          {blocks.length > 0 && (
            <ul className="os-attn">
              {blocks.map((b, i) => (
                <li key={i}>
                  <span className="os-block__num">{i + 1}</span>
                  <span className="os-attn__name">{b.kind === 'stations' ? `תחנות${b.title ? `: ${b.title}` : ''}` : b.kind === 'break' ? b.title || 'הפסקה' : b.exercise?.title ?? b.title}</span>
                  <span className="os-seg" role="group" aria-label={`שלב ${i + 1}`}>
                    {(['done', 'changed', 'skipped'] as BlockStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        aria-pressed={(statuses[i] ?? 'done') === st}
                        className={(statuses[i] ?? 'done') === st ? `is-on ${st === 'done' ? 'is-present' : st === 'changed' ? 'is-late' : 'is-absent'}` : ''}
                        onClick={() => setStatuses((s) => blocks.map((_, j) => (j === i ? st : s[j] ?? 'done')))}
                      >
                        {statusLabel[st]}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="os-form os-form--inline">
            <div className="os-form__wide">
              <span className="os-muted os-small">איך היה האימון? (לא חובה)</span>
              <div className="os-seg" role="group" aria-label="דירוג">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-pressed={rating === n} className={rating === n ? 'is-on is-present' : ''} onClick={() => setRating(rating === n ? null : n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="os-form__full">
              הערה קצרה
              <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה עבד, מה לשנות בפעם הבאה" />
            </label>
          </div>
          <button type="button" className="os-btn" onClick={send} disabled={busy}>
            {busy ? 'שולח…' : report ? 'עדכון הדוח' : 'שליחת הדוח'}
          </button>
        </>
      )}
    </section>
  );
}
