/**
 * Executive Decision Cockpit, phase A (user approval 2026-11-11).
 * Area A: today's pitches (planned only; live status comes with phase C).
 * Area B: decision hub: three insights, each "what happened / why / what to do",
 *         linked to one intervention (opened once, never duplicated).
 * Area C (trends) stays in DashboardScreen with the existing components.
 */
import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/api';
import type { Insight, SetupStep } from './insights';
import {
  METRIC_HE,
  OUTCOME_HE,
  STATUS_HE,
  israelDate,
  isOpen,
  listInterventions,
  openIntervention,
  ownerOptions,
  type Intervention,
  type OwnerOption,
  type TodaySession,
} from './interventionsApi';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

const LEVEL_HE = { critical: 'דחוף', warn: 'לטיפול השבוע', chance: 'הזדמנות' };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

/** A small pitch drawing (lines only): the Stitch pitch card without invented player dots. */
function PitchLines() {
  return (
    <svg className="os-pitch__lines" viewBox="0 0 300 180" preserveAspectRatio="none" aria-hidden="true">
      <rect x="6" y="6" width="288" height="168" rx="4" />
      <line x1="150" y1="6" x2="150" y2="174" />
      <circle cx="150" cy="90" r="26" />
      <circle cx="150" cy="90" r="2" className="is-fill" />
      <rect x="6" y="52" width="34" height="76" />
      <rect x="260" y="52" width="34" height="76" />
    </svg>
  );
}

export type PitchState = 'ended' | 'now' | 'planned';
export function pitchState(s: TodaySession, now = Date.now()): PitchState {
  const start = new Date(s.starts_at).getTime();
  const end = start + s.duration_min * 60000;
  return now > end ? 'ended' : now >= start ? 'now' : 'planned';
}
const STATE_HE: Record<PitchState, string> = { ended: 'הסתיים לפי היומן', now: 'בשעות האימון · לא מאומת', planned: 'מתוכנן' };

/** Area A. Only what the calendar says; never a "live" state without a check-in. */
export function TodayPitches({ rows, coachOf }: { rows: TodaySession[] | null | undefined; coachOf: Map<string, string | null> }) {
  const now = Date.now();
  return (
    <section className="os-area os-cockpit__live" aria-labelledby="ck-live">
      <div className="os-area__head">
        <div>
          <span className="os-eyebrow">אזור A · מגרשים היום</span>
          <h2 id="ck-live">מה קורה היום במגרשים?</h2>
        </div>
        <span className="os-badge os-badge--planned">מתוכנן בלבד · לפי היומן</span>
      </div>
      {rows === undefined ? (
        <Loading />
      ) : rows === null ? (
        <NoData>אין נתוני יומן זמינים</NoData>
      ) : rows.length === 0 ? (
        <div className="os-pitch os-pitch--empty">
          <div className="os-pitch__field">
            <PitchLines />
            <div className="os-pitch__overlay">
              <strong>אין אימונים ביומן להיום</strong>
              <small>אימון שיוזן ביומן של קבוצה במועדון יופיע כאן כמגרש</small>
            </div>
          </div>
        </div>
      ) : (
        <ul className="os-today os-pitches">
          {rows.map((s) => {
            const st = pitchState(s, now);
            const end = new Date(new Date(s.starts_at).getTime() + s.duration_min * 60000).toISOString();
            const coach = coachOf.get(s.team_id);
            return (
              <li key={s.session_id} className={`os-pitch is-${st}`}>
                <div className="os-pitch__head">
                  <span className="os-pitch__dot" aria-hidden="true" />
                  <span className="os-today__team">
                    <strong>{s.location || 'מגרש לא צוין'}</strong>
                    <small>
                      {s.team_name}
                      {coach ? ` · מאמן: ${coach}` : ''}
                    </small>
                  </span>
                  <span className="os-today__state">
                    <span className="os-chip os-chip--off">{st === 'planned' ? `${STATE_HE.planned} ${hhmm(s.starts_at)}` : STATE_HE[st]}</span>
                  </span>
                </div>
                <div className="os-pitch__field">
                  <PitchLines />
                  <div className="os-pitch__overlay">
                    <span className="os-today__time">{hhmm(s.starts_at)}</span>
                    <small>עד {hhmm(end)} · {s.duration_min} דק׳</small>
                  </div>
                </div>
                <div className="os-pitch__foot">
                  {s.has_plan ? <span className="os-chip os-chip--done">מערך משויך</span> : <span className="os-chip os-chip--warn">בלי מערך</span>}
                  <small className="os-muted">מצב חי (מי על המגרש, מאמן שהגיע) יגיע עם צ'ק־אין מאמנים</small>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Area C, impact: what the club's interventions changed (server-measured before / after). */
export function ImpactCard({ list }: { list: Intervention[] | null | undefined }) {
  const all = list ?? [];
  const open = all.filter((i) => isOpen(i.status));
  const closed = all.filter((i) => i.status === 'closed');
  const improved = closed.filter((i) => i.outcome === 'improved').length;
  const shown = [...open, ...closed].slice(0, 4);
  return (
    <section className="os-card os-impact" aria-labelledby="ck-impact">
      <div className="os-card__head">
        <h2 id="ck-impact">מדידת השפעה של החלטות</h2>
        <SourceTag source="db" />
      </div>
      {list === undefined ? (
        <Loading />
      ) : list === null ? (
        <NoData>ההתערבויות לא זמינות</NoData>
      ) : all.length === 0 ? (
        <p className="os-muted">עוד לא נפתחו התערבויות. כל החלטה שתיפתח ממרכז ההחלטות תימדד כאן: מדד לפני, מדד עכשיו, ותוצאה.</p>
      ) : (
        <>
          <div className="os-impact__kpis">
            <div>
              <strong>{open.length}</strong>
              <small>פתוחות</small>
            </div>
            <div>
              <strong>{closed.length}</strong>
              <small>נסגרו</small>
            </div>
            <div>
              <strong className="is-good">{improved}</strong>
              <small>השתפרו</small>
            </div>
          </div>
          <ul className="os-impact__list">
            {shown.map((i) => {
              const unit = METRIC_HE[i.metric]?.unit ?? '';
              const fmt = (v: number | null) => (v === null ? '–' : `${Math.round(v * 10) / 10}${unit}`);
              const d = i.baseline_value !== null && i.current_value !== null ? i.current_value - i.baseline_value : null;
              return (
                <li key={i.id}>
                  <a href={`#os/interventions/${i.id}`}>
                    <span className="os-impact__text">
                      <strong>{i.title}</strong>
                      <small>
                        {i.team_name ?? 'כל המועדון'} · {i.status === 'closed' && i.outcome ? OUTCOME_HE[i.outcome] : STATUS_HE[i.status]}
                      </small>
                    </span>
                    <span className={`os-impact__delta${d !== null && d > 0 ? ' is-up' : d !== null && d < 0 ? ' is-down' : ''}`}>
                      {fmt(i.baseline_value)} → {fmt(i.current_value)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** Area B. */
export function DecisionHub({ club, insights, canManage, onList }: { club: string; insights: Insight[]; canManage: boolean; onList?: (l: Intervention[] | null | undefined) => void }) {
  const [list, setList] = useState<Intervention[] | null | undefined>(undefined);
  useEffect(() => {
    onList?.(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  const [opening, setOpening] = useState<Insight | null>(null);
  const reload = () =>
    listInterventions(club)
      .then((d) => setList(d ?? []))
      .catch(() => setList(null));
  useEffect(() => {
    setList(undefined);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club]);
  const openByKey = new Map((list ?? []).filter((i) => isOpen(i.status)).map((i) => [i.insight_key, i]));
  const open = (list ?? []).filter((i) => isOpen(i.status));
  const overdue = open.filter((i) => i.overdue).length;
  const checking = open.filter((i) => i.status === 'checking').length;

  return (
    <section className="os-area os-cockpit__hub" aria-labelledby="ck-hub">
      <div className="os-area__head">
        <div>
          <span className="os-eyebrow">אזור B · מרכז החלטות</span>
          <h2 id="ck-hub">מרכז פעולה ניהולי · {insights.length || 'אין'} החלטות</h2>
          <small className="os-muted">פחות נתונים, יותר החלטות: תובנה ← פעולה ← תוצאה</small>
        </div>
        <SourceTag source="db" />
      </div>
      {insights.length === 0 ? (
        <p className="os-muted">אין תובנות פתוחות. כל הקבוצות מסמנות נוכחות, מגישות דוחות ומתכננות אימונים.</p>
      ) : (
        <div className="os-dcards">
          {insights.map((x, i) => {
            const linked = openByKey.get(x.key);
            return (
              <article key={x.key} className={`os-dcard os-insight is-${x.level}`} data-insight={x.key}>
                <header className="os-dcard__head">
                  <span className={`os-dcard__level is-${x.level}`}>
                    {i + 1} · {LEVEL_HE[x.level]}
                  </span>
                  <h3>{x.title}</h3>
                </header>
                <div className="os-dcard__cols">
                  <div>
                    <span className="os-eyebrow">מה קרה?</span>
                    <p>{x.what}</p>
                  </div>
                  <div>
                    <span className="os-eyebrow">למה זה משנה?</span>
                    <p>{x.why}</p>
                  </div>
                </div>
                <div className="os-dcard__todo">
                  <span className="os-eyebrow">פעולה מומלצת</span>
                  <p>{x.todo}</p>
                </div>
                <div className="os-dcard__actions">
                  {linked ? (
                    <a className="os-btn os-btn--big" href={`#os/interventions/${linked.id}`}>
                      התערבות פתוחה · {STATUS_HE[linked.status]}
                    </a>
                  ) : canManage ? (
                    <button type="button" className="os-btn os-btn--big" onClick={() => setOpening(x)} disabled={list === undefined}>
                      פתיחת התערבות
                    </button>
                  ) : null}
                  <a className="os-btn os-btn--ghost" href={x.href}>
                    {x.cta}
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <a className="os-cockpit__open" href="#os/interventions">
        {list === undefined
          ? 'התערבויות…'
          : list === null
            ? 'התערבויות (לא זמין)'
            : `${open.length} התערבויות פתוחות${checking ? ` · ${checking} בבדיקת תוצאה` : ''}${overdue ? ` · ${overdue} באיחור` : ''}`}
      </a>
      {opening && (
        <OpenSheet
          club={club}
          insight={opening}
          onClose={() => setOpening(null)}
          onDone={(id) => {
            setOpening(null);
            reload();
            window.location.hash = `os/interventions/${id}`;
          }}
        />
      )}
    </section>
  );
}

function OpenSheet({ club, insight, onClose, onDone }: { club: string; insight: Insight; onClose: () => void; onDone: (id: string) => void }) {
  const [title, setTitle] = useState(insight.title);
  const [why, setWhy] = useState(`${insight.what} ${insight.why}`);
  const [plan, setPlan] = useState(insight.todo);
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState(israelDate(14));
  const [owners, setOwners] = useState<OwnerOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ownerOptions(club, insight.teamId)
      .then((d) => setOwners(d ?? []))
      .catch(() => setOwners([]));
  }, [club, insight.teamId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await openIntervention({
        club,
        team: insight.teamId,
        kind: insight.kind,
        title,
        why,
        plan,
        owner: owner || null,
        due,
        context: insight.context,
      });
      onDone(r.id);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <div className="os-sheet" role="dialog" aria-modal="true" aria-label="פתיחת התערבות">
      <div className="os-sheet__panel">
        <div className="os-card__head">
          <h2>פתיחת התערבות</h2>
          <button type="button" className="os-icon-btn" aria-label="סגירה" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="os-muted os-small">
          מדד הבסיס נמדד עכשיו על ידי המערכת מהנתונים האמיתיים. אם אין נתונים, יירשם "אין נתון בסיס".
        </p>
        <form className="os-form os-iv__form" onSubmit={submit}>
          <label className="os-form__full">
            מה ההחלטה
            <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={160} />
          </label>
          <label className="os-form__full">
            למה (התובנה)
            <textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} />
          </label>
          <label className="os-form__full">
            מה עושים
            <textarea rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={1000} />
          </label>
          <label>
            אחראי
            <select value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!owners}>
              <option value="">{owners ? 'בלי אחראי כרגע' : 'טוען…'}</option>
              {(owners ?? []).map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.name} · {o.role}
                </option>
              ))}
            </select>
          </label>
          <label>
            תאריך יעד לבדיקה
            <input type="date" value={due} min={israelDate(0)} max={israelDate(180)} onChange={(e) => setDue(e.target.value)} required />
          </label>
          {error && <ErrorNote message={error} />}
          <div className="os-row os-form__full">
            <button type="submit" className="os-btn" disabled={busy}>
              {busy ? 'פותח…' : 'פתיחה'}
            </button>
            <button type="button" className="os-btn os-btn--ghost" onClick={onClose}>
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** "What's missing for the full picture": real steps, each with its link. Hidden once all are done. */
export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  // Open while most of the picture is missing; afterwards a slim, expandable bar.
  return (
    <details className="os-card os-setup" open={done < steps.length / 2}>
      <summary className="os-card__head">
        <h2 id="ck-setup">מה חסר כדי לראות את התמונה המלאה</h2>
        <span className="os-setup__count">
          {done} מתוך {steps.length}
        </span>
      </summary>
      <span className="os-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(4, (100 * done) / steps.length)}%` }} />
      </span>
      <ol className="os-setup__list">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'is-done' : ''}>
            <span className="os-setup__mark" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <span className="os-setup__text">
              <strong>{s.label}</strong>
              <small>{s.detail}</small>
            </span>
            {!s.done && (
              <a className="os-btn os-btn--ghost os-btn--sm" href={s.href}>
                {s.cta}
              </a>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Quick ways from the cockpit to the rest of the professional side. */
export function QuickLinks({ openCount }: { openCount: number | null }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav className="os-quick" aria-label="קיצורים">
      <a href="#os/interventions">התערבויות{openCount ? ` (${openCount})` : ''}</a>
      <button type="button" onClick={() => scrollTo('ck-duel')}>
        תחרות בין האזורים
      </button>
      <button type="button" onClick={() => scrollTo('ck-rivals')}>
        מול מועדונים אחרים
      </button>
      <button type="button" onClick={() => scrollTo('ck-trends')}>
        מגמות וגרפים
      </button>
      <a href="#os/library">ספריית תרגילים</a>
      <a href="#os/setup">שיוך קבוצות</a>
    </nav>
  );
}
