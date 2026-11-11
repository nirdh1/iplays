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
  STATUS_HE,
  israelDate,
  isOpen,
  listInterventions,
  openIntervention,
  ownerOptions,
  todaySessions,
  type Intervention,
  type OwnerOption,
  type TodaySession,
} from './interventionsApi';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

const LEVEL_HE = { critical: 'דחוף', warn: 'לטיפול השבוע', chance: 'הזדמנות' };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

/** Area A. Only what the calendar says; never a "live" state without a check-in. */
export function TodayPitches({ club }: { club: string }) {
  const [rows, setRows] = useState<TodaySession[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setRows(undefined);
    todaySessions(club)
      .then((d) => live && setRows(d ?? null))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [club]);
  const now = Date.now();
  return (
    <section className="os-card os-cockpit__live" aria-labelledby="ck-live">
      <div className="os-card__head">
        <h2 id="ck-live">מגרשים היום</h2>
        <span className="os-badge os-badge--planned">מתוכנן בלבד</span>
      </div>
      <p className="os-muted os-small">
        לפי היומן. מצב חי (מי על המגרש עכשיו, מאמן שהגיע) יתווסף עם צ'ק־אין מאמנים ומפת מגרשים בשלב C.
      </p>
      {rows === undefined ? (
        <Loading />
      ) : rows === null ? (
        <NoData>אין נתוני יומן זמינים</NoData>
      ) : rows.length === 0 ? (
        <NoData>אין אימונים ביומן להיום</NoData>
      ) : (
        <ul className="os-today">
          {rows.map((s) => {
            const start = new Date(s.starts_at).getTime();
            const end = start + s.duration_min * 60000;
            const when = now > end ? 'הסתיים לפי היומן' : now >= start ? 'בשעות האימון לפי היומן' : `מתוכנן ${hhmm(s.starts_at)}`;
            return (
              <li key={s.session_id}>
                <span className="os-today__time">{hhmm(s.starts_at)}</span>
                <span className="os-today__team">
                  <strong>{s.team_name}</strong>
                  <small>{s.location || 'מגרש לא צוין'}</small>
                </span>
                <span className="os-today__state">
                  <span className="os-chip os-chip--off">{when}</span>
                  {!s.has_plan && <span className="os-chip os-chip--warn">בלי מערך</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Area B. */
export function DecisionHub({ club, insights, canManage }: { club: string; insights: Insight[]; canManage: boolean }) {
  const [list, setList] = useState<Intervention[] | null | undefined>(undefined);
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
    <section className="os-card os-cockpit__hub" aria-labelledby="ck-hub">
      <div className="os-card__head">
        <h2 id="ck-hub">מרכז החלטות</h2>
        <SourceTag source="db" />
      </div>
      {insights.length === 0 ? (
        <p className="os-muted">אין תובנות פתוחות. כל הקבוצות מסמנות נוכחות, מגישות דוחות ומתכננות אימונים.</p>
      ) : (
        <div className="os-dash__actions">
          {insights.map((x, i) => {
            const linked = openByKey.get(x.key);
            return (
              <article key={x.key} className={`os-dash__action os-insight is-${x.level}`} data-insight={x.key}>
                <span className="os-dash__level">
                  {i + 1}. {LEVEL_HE[x.level]}
                </span>
                <h3>{x.title}</h3>
                <dl className="os-insight__dl">
                  <dt>מה קרה</dt>
                  <dd>{x.what}</dd>
                  <dt>למה זה חשוב</dt>
                  <dd>{x.why}</dd>
                  <dt>מה לעשות</dt>
                  <dd>{x.todo}</dd>
                </dl>
                <div className="os-row os-insight__actions">
                  {linked ? (
                    <a className="os-btn" href={`#os/interventions/${linked.id}`}>
                      התערבות פתוחה · {STATUS_HE[linked.status]}
                    </a>
                  ) : canManage ? (
                    <button type="button" className="os-btn" onClick={() => setOpening(x)} disabled={list === undefined}>
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
  return (
    <section className="os-card os-setup" aria-labelledby="ck-setup">
      <div className="os-card__head">
        <h2 id="ck-setup">מה חסר כדי לראות את התמונה המלאה</h2>
        <span className="os-setup__count">
          {done} מתוך {steps.length}
        </span>
      </div>
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
    </section>
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
      <button type="button" onClick={() => scrollTo('ck-trends')}>
        מגמות וגרפים
      </button>
      <a href="#os/library">ספריית תרגילים</a>
      <a href="#club/search">שיוך קבוצות</a>
    </nav>
  );
}
