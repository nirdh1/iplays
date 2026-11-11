/**
 * Management interventions (phase A): list and one intervention's life cycle
 * identify -> decide -> act -> check -> result. Metrics are measured by the
 * server from real rows; "no data" is shown as such, never as 0.
 * Before/after is shown with a causality caveat (Stitch decision tracking).
 */
import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/api';
import {
  METRIC_HE,
  OUTCOME_HE,
  STATUS_HE,
  actOnIntervention,
  cancelIntervention,
  closeIntervention,
  fmtMetric,
  getIntervention,
  isOpen,
  israelDate,
  listInterventions,
  measureIntervention,
  ownerOptions,
  type Intervention,
  type InterventionDetail,
  type LogEntry,
  type Outcome,
  type OwnerOption,
} from './interventionsApi';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

const fmtDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' }) : '');
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

export function InterventionsScreen({ id }: { id?: string }) {
  return id ? <InterventionPage key={id} id={id} /> : <InterventionList />;
}

type Filter = 'open' | 'done' | 'all';

/** The life-cycle stages as a pipeline (Stitch "מעקב החלטות"): how many interventions sit in each. */
const PIPE: { status: Intervention['status']; label: string; sub: string; tone: string }[] = [
  { status: 'open', label: 'קבלת החלטה', sub: 'הוחלט, טרם התחיל', tone: 'warn' },
  { status: 'in_progress', label: 'ביצוע פעולה', sub: 'בביצוע', tone: 'chance' },
  { status: 'checking', label: 'בדיקת תוצאה', sub: 'מדידה מול הבסיס', tone: 'info' },
  { status: 'closed', label: 'הושלמו', sub: 'נסגרו עם מסקנה', tone: 'good' },
];

function InterventionList() {
  const [list, setList] = useState<Intervention[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  useEffect(() => {
    listInterventions(null)
      .then((d) => setList(d ?? []))
      .catch((e) => setError(friendlyError(e)));
  }, []);
  if (error) return <ErrorNote message={error} />;
  if (list === undefined) return <Loading />;
  const all = list ?? [];
  const shown = all.filter((i) => (filter === 'all' ? true : filter === 'open' ? isOpen(i.status) : !isOpen(i.status)));
  const clubs = new Set(all.map((i) => i.club_id));
  const open = all.filter((i) => isOpen(i.status));
  const closed = all.filter((i) => i.status === 'closed');
  const improved = closed.filter((i) => i.outcome === 'improved').length;
  const count = (f: Filter) => all.filter((i) => (f === 'all' ? true : f === 'open' ? isOpen(i.status) : !isOpen(i.status))).length;
  return (
    <div className="os-stack os-ivs">
      <header className="os-area__head">
        <div>
          <span className="os-eyebrow">מעקב החלטות · DECISION ROI</span>
          <h2>מעקב החלטות ושיפור מועדוני</h2>
          <small className="os-muted">פחות נתונים, יותר החלטות ותוצאות: מעקב התערבויות מקצועיות, יישום בשטח ומדידת שינוי לאורך זמן</small>
        </div>
        <a className="os-btn os-btn--ghost" href="#os/dashboard">
          חזרה לקוקפיט
        </a>
      </header>

      <ol className="os-pipe" aria-label="שלבי ההתערבויות">
        {PIPE.map((p, k) => (
          <li key={p.status} className={`is-${p.tone}`}>
            <span className="os-pipe__step">שלב {k + 1}</span>
            <strong>{all.filter((i) => i.status === p.status).length}</strong>
            <span className="os-pipe__label">{p.label}</span>
            <small>{p.sub}</small>
          </li>
        ))}
      </ol>

      <div className="os-ivkpis">
        <div>
          <small>התערבויות פתוחות</small>
          <strong>{open.length}</strong>
        </div>
        <div className={open.some((i) => i.overdue) ? 'is-alert' : ''}>
          <small>עברו את תאריך היעד</small>
          <strong>{open.filter((i) => i.overdue).length}</strong>
        </div>
        <div>
          <small>נסגרו עם מסקנה</small>
          <strong>{closed.length}</strong>
        </div>
        <div className="is-good">
          <small>שיעור שיפור בסגורות</small>
          <strong>{closed.length ? `${Math.round((100 * improved) / closed.length)}%` : '–'}</strong>
        </div>
      </div>

      <div className="os-row os-row--between">
        <h3 className="os-ivs__title">{shown.length} התערבויות</h3>
        <div className="os-seg" role="group" aria-label="סינון">
          {(['open', 'done', 'all'] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? 'is-on is-present' : ''} onClick={() => setFilter(f)}>
              {f === 'open' ? 'פתוחות' : f === 'done' ? 'נסגרו' : 'הכל'} ({count(f)})
            </button>
          ))}
        </div>
      </div>
      {all.length === 0 ? (
        <NoData>
          עדיין אין התערבויות. פותחים התערבות מתוך תובנה במרכז ההחלטות בקוקפיט, או שעדיין לא הוקצתה לך אחת.
        </NoData>
      ) : shown.length === 0 ? (
        <NoData>{filter === 'open' ? 'אין התערבויות פתוחות' : 'אין התערבויות שנסגרו'}</NoData>
      ) : (
        <ul className="os-ivlist">
          {shown.map((i) => {
            const m = METRIC_HE[i.metric];
            const b = i.baseline_value;
            const c = i.current_value ?? null;
            const d = b !== null && c !== null ? c - b : null;
            const good = d !== null && (m?.higherIsBetter ? d > 0 : d < 0);
            const bad = d !== null && d !== 0 && !good;
            return (
              <li key={i.id}>
                <a href={`#os/interventions/${i.id}`} className={`os-ivcard is-${i.status}${i.overdue ? ' is-overdue' : ''}`}>
                  <span className="os-ivcard__top">
                    <span className={`os-chip os-iv-status is-${i.status}`}>{STATUS_HE[i.status]}</span>
                    {i.overdue && <span className="os-chip os-chip--warn">באיחור</span>}
                    {i.outcome && <span className="os-chip">{OUTCOME_HE[i.outcome]}</span>}
                    <span className="os-muted os-small">
                      {i.team_name ?? 'כל המועדון'}
                      {clubs.size > 1 && i.club_name ? ` · ${i.club_name}` : ''}
                    </span>
                  </span>
                  <strong className="os-ivcard__title">{i.title}</strong>
                  <span className="os-ivcard__body">
                    <span className="os-ivcard__cols">
                      <span>
                        <span className="os-eyebrow">הבעיה שזוהתה</span>
                        <span className="os-ivcard__text">{i.why || '—'}</span>
                      </span>
                      <span>
                        <span className="os-eyebrow">ההחלטה וההנחיה</span>
                        <span className="os-ivcard__text">{i.action_plan || '—'}</span>
                      </span>
                      <span>
                        <span className="os-eyebrow">אחראי ויעד</span>
                        <span className="os-ivcard__text">
                          {i.owner_name ?? 'לא נקבע'}
                          {i.due_on ? ` · יעד ${fmtDate(i.due_on)}` : ''}
                        </span>
                      </span>
                    </span>
                    <span className={`os-ivcard__ba${good ? ' is-good' : bad ? ' is-bad' : ''}`}>
                      <span className="os-muted os-small">{m?.label ?? 'מדד'}</span>
                      <span className="os-ivcard__nums">
                        <span>
                          <small>לפני</small>
                          <b>{fmtMetric(i.metric, b)}</b>
                        </span>
                        <span aria-hidden="true">←</span>
                        <span>
                          <small>עכשיו</small>
                          <b className="is-now">{fmtMetric(i.metric, c)}</b>
                        </span>
                      </span>
                      {m?.unit === '%' && c !== null && (
                        <span className="os-bar" aria-hidden="true">
                          <span style={{ width: `${Math.max(2, Math.min(100, c))}%` }} />
                        </span>
                      )}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STEPS = [
  { id: 'identify', label: 'זיהוי' },
  { id: 'decide', label: 'החלטה' },
  { id: 'act', label: 'ביצוע' },
  { id: 'check', label: 'בדיקה' },
  { id: 'result', label: 'תוצאה' },
];
function stepOf(i: Intervention) {
  if (i.status === 'closed' || i.status === 'canceled') return 4;
  if (i.status === 'checking') return 3;
  if (i.status === 'in_progress') return 2;
  return 1;
}

function InterventionPage({ id }: { id: string }) {
  const [iv, setIv] = useState<InterventionDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    getIntervention(id)
      .then((d) => setIv(d ?? null))
      .catch((e) => setError(friendlyError(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (iv === undefined && !error) return <Loading />;
  if (!iv)
    return (
      <div className="os-stack">
        {error && <ErrorNote message={error} />}
        <NoData>ההתערבות לא נמצאה, או שאין לך הרשאה לראות אותה.</NoData>
        <a className="os-back" href="#os/interventions">
          לכל ההתערבויות
        </a>
      </div>
    );

  const m = METRIC_HE[iv.metric];
  const open = isOpen(iv.status);
  const step = stepOf(iv);
  const diff = iv.baseline_value !== null && iv.current_value !== null ? Number(iv.current_value) - Number(iv.baseline_value) : null;

  return (
    <div className="os-stack os-iv">
      <a className="os-back" href="#os/interventions">
        ← כל ההתערבויות
      </a>
      <header className="os-iv__head">
        <span className="os-muted os-small">
          {iv.team_name ?? 'כל המועדון'} · נפתחה {fmtDate(iv.created_at)}
        </span>
        <h2>{iv.title}</h2>
        <div className="os-row">
          <span className={`os-chip os-iv-status is-${iv.status}`}>{STATUS_HE[iv.status]}</span>
          {iv.overdue && <span className="os-chip os-chip--warn">עבר תאריך היעד</span>}
          {iv.outcome && <span className="os-chip">{OUTCOME_HE[iv.outcome]}</span>}
        </div>
      </header>

      <ol className="os-steps" aria-label="מחזור חיים">
        {STEPS.map((s, k) => (
          <li key={s.id} className={k < step ? 'is-done' : k === step ? 'is-now' : ''} aria-current={k === step ? 'step' : undefined}>
            <span>{k + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {error && <ErrorNote message={error} />}

      <section className="os-card">
        <div className="os-card__head">
          <h3>לפני ואחרי</h3>
          <SourceTag source="db" />
        </div>
        <p className="os-muted os-small">{m.label}. נמדד על ידי המערכת מהנתונים בפועל.</p>
        <div className="os-iv__ba">
          <div>
            <span className="os-muted os-small">בסיס · {fmtDate(iv.baseline_at)}</span>
            <strong>{fmtMetric(iv.metric, iv.baseline_value)}</strong>
          </div>
          <div aria-hidden="true" className="os-iv__arrow">
            ←
          </div>
          <div>
            <span className="os-muted os-small">{iv.current_at ? `עדכני · ${fmtWhen(iv.current_at)}` : 'עדכני'}</span>
            <strong>{iv.current_at ? fmtMetric(iv.metric, iv.current_value) : 'טרם נמדד'}</strong>
          </div>
          {diff !== null && (
            <div className={`os-iv__diff ${diff > 0 === m.higherIsBetter && diff !== 0 ? 'is-up' : diff === 0 ? '' : 'is-down'}`}>
              {diff === 0 ? 'ללא שינוי' : `${diff > 0 ? '+' : ''}${iv.metric === 'form_ppg' ? diff.toFixed(1) : Math.round(diff)}${m.unit}`}
            </div>
          )}
        </div>
        {iv.baseline_value === null && <p className="os-muted os-small">אין נתון בסיס: בזמן הפתיחה לא היו נתונים למדוד. ההשוואה תתאפשר כשיצטברו נתונים.</p>}
        <p className="os-muted os-small">שינוי במדד מראה מה קרה באותו זמן, לא בהכרח שההתערבות גרמה לו.</p>
        {open && iv.can_work && (
          <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => run(() => measureIntervention(iv.id))}>
            למדוד עכשיו
          </button>
        )}
      </section>

      <section className="os-card">
        <h3>ההחלטה</h3>
        <dl className="os-insight__dl">
          <dt>למה</dt>
          <dd>{iv.why || '—'}</dd>
          <dt>מה עושים</dt>
          <dd>{iv.action_plan || '—'}</dd>
          <dt>אחראי</dt>
          <dd>{iv.owner_name ?? 'לא נקבע'}</dd>
          <dt>תאריך יעד</dt>
          <dd>{iv.due_on ? fmtDate(iv.due_on) : 'לא נקבע'}</dd>
        </dl>
        {open && iv.can_manage && <ManageForm iv={iv} busy={busy} run={run} />}
      </section>

      {open && iv.can_work && (
        <section className="os-card">
          <h3>עדכון</h3>
          <div className="os-row">
            {iv.status !== 'in_progress' && (
              <button type="button" className="os-btn" disabled={busy} onClick={() => run(() => actOnIntervention(iv.id, 'status', 'in_progress'))}>
                בביצוע
              </button>
            )}
            {iv.status !== 'checking' && (
              <button type="button" className="os-btn" disabled={busy} onClick={() => run(() => actOnIntervention(iv.id, 'status', 'checking'))}>
                מוכן לבדיקת תוצאה
              </button>
            )}
          </div>
          <NoteForm busy={busy} onSave={(t) => run(() => actOnIntervention(iv.id, 'note', t))} />
        </section>
      )}

      {open && iv.can_manage && <CloseForm iv={iv} busy={busy} run={run} />}

      {!open && iv.conclusion && (
        <section className="os-card">
          <h3>מסקנה מקצועית</h3>
          <p>{iv.conclusion}</p>
        </section>
      )}

      <section className="os-card">
        <h3>יומן פעולות</h3>
        {iv.log.length === 0 ? (
          <NoData>אין רישומים</NoData>
        ) : (
          <ol className="os-ivlog">
            {iv.log.map((l, k) => (
              <li key={k}>
                <span className="os-muted os-small">
                  {fmtWhen(l.at)} · {l.actor_name ?? 'המערכת'}
                </span>
                <span>{logText(l, iv)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function logText(l: LogEntry, iv: Intervention) {
  switch (l.action) {
    case 'opened':
      return `נפתחה. מדד בסיס: ${fmtMetric(iv.metric, l.value)}`;
    case 'status':
      return `סטטוס: ${STATUS_HE[(l.data.to as Intervention['status']) ?? 'open']}`;
    case 'note':
      return l.note ?? '';
    case 'owner':
      return 'אחראי עודכן';
    case 'due':
      return `תאריך יעד: ${fmtDate((l.data.due_on as string) ?? null)}`;
    case 'plan':
      return `תוכנית עודכנה: ${l.note ?? ''}`;
    case 'measured':
      return `נמדד: ${fmtMetric(iv.metric, l.value)}`;
    case 'closed':
      return `נסגרה (${OUTCOME_HE[(l.data.outcome as Outcome) ?? 'inconclusive']}). מדד סופי: ${fmtMetric(iv.metric, l.value)}`;
    case 'canceled':
      return `בוטלה: ${l.note ?? ''}`;
  }
}

function NoteForm({ busy, onSave }: { busy: boolean; onSave: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <form
      className="os-form os-form--one os-form--inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (t.trim()) {
          onSave(t.trim());
          setT('');
        }
      }}
    >
      <label className="os-form__full">
        הערה ליומן
        <textarea rows={2} value={t} onChange={(e) => setT(e.target.value)} maxLength={2000} placeholder="מה נעשה, עם מי דיברת, מה הוחלט" />
      </label>
      <button type="submit" className="os-btn os-btn--ghost" disabled={busy || !t.trim()}>
        הוספה ליומן
      </button>
    </form>
  );
}

type Run = (f: () => Promise<unknown>) => Promise<void>;

function ManageForm({ iv, busy, run }: { iv: Intervention; busy: boolean; run: Run }) {
  const [owners, setOwners] = useState<OwnerOption[] | null>(null);
  const [owner, setOwner] = useState(iv.owner_id ?? '');
  const [due, setDue] = useState(iv.due_on ?? israelDate(14));
  const [plan, setPlan] = useState(iv.action_plan);
  useEffect(() => {
    ownerOptions(iv.club_id, iv.team_id)
      .then((d) => setOwners(d ?? []))
      .catch(() => setOwners([]));
  }, [iv.club_id, iv.team_id]);
  const save = () =>
    run(async () => {
      if ((owner || null) !== (iv.owner_id || null)) await actOnIntervention(iv.id, 'owner', owner);
      if (due !== iv.due_on) await actOnIntervention(iv.id, 'due', due);
      if (plan.trim() !== iv.action_plan) await actOnIntervention(iv.id, 'plan', plan);
    });
  return (
    <details className="os-iv__manage">
      <summary>עריכת אחראי, יעד ותוכנית</summary>
      <div className="os-form os-form--inline">
        <label>
          אחראי
          <select value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!owners}>
            <option value="">בלי אחראי</option>
            {(owners ?? []).map((o) => (
              <option key={o.user_id} value={o.user_id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          תאריך יעד
          <input type="date" value={due} min={israelDate(0)} max={israelDate(180)} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="os-form__full">
          מה עושים
          <textarea rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={1000} />
        </label>
        <button type="button" className="os-btn" disabled={busy} onClick={save}>
          שמירה
        </button>
      </div>
    </details>
  );
}

function CloseForm({ iv, busy, run }: { iv: Intervention; busy: boolean; run: Run }) {
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const ok = outcome !== '' && text.trim().length >= 10;
  return (
    <section className="os-card">
      <h3>בדיקת תוצאה וסגירה</h3>
      <p className="os-muted os-small">בסגירה המערכת מודדת שוב את המדד ושומרת אותו כמדד הסופי. חובה לבחור תוצאה ולכתוב מסקנה מקצועית.</p>
      <div className="os-seg os-seg--wrap" role="radiogroup" aria-label="תוצאה">
        {(Object.keys(OUTCOME_HE) as Outcome[]).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={outcome === o} className={outcome === o ? 'is-on is-present' : ''} onClick={() => setOutcome(o)}>
            {OUTCOME_HE[o]}
          </button>
        ))}
      </div>
      <div className="os-form os-form--one os-form--inline">
        <label className="os-form__full">
          מסקנה מקצועית
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="מה למדנו, מה ממשיכים לעשות, מה משנים" />
        </label>
        <button type="button" className="os-btn" disabled={busy || !ok} onClick={() => run(() => closeIntervention(iv.id, outcome as Outcome, text.trim()))}>
          סגירת ההתערבות
        </button>
        {!ok && <span className="os-muted os-small">צריך לבחור תוצאה ולכתוב לפחות 10 תווים.</span>}
      </div>
      <details className="os-iv__manage">
        <summary>ביטול ההתערבות</summary>
        <div className="os-form os-form--inline">
          <label className="os-form__full">
            סיבה
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="למשל: נפתחה בטעות" />
          </label>
          <button type="button" className="os-btn os-btn--ghost" disabled={busy || reason.trim().length < 3} onClick={() => run(() => cancelIntervention(iv.id, reason.trim()))}>
            ביטול
          </button>
        </div>
      </details>
    </section>
  );
}
