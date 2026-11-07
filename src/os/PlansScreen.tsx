import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { friendlyError, type MyTeam } from '../lib/api';
import { addDays, todayYmd, type TrainingSession } from '../lib/coachApi';
import { sessionsBetween, dayLabel, timeLabel } from './data';
import { byTopics, listCategories, listExercises, type Category, type Exercise } from './exercisesApi';
import { TopicChips, TopicTags, useTopics } from './TopicChips';
import { catLabel } from './LibraryScreen';
import { Pitch } from './pitch/Pitch';
import { assignPlan, assignedSessions, deletePlan, getPlan, listPlans, savePlan, type PlanRow } from './plans/api';
import { blockMinutes, newBlock, planMinutes, validate, type BlockKind, type Plan, type PlanBlock, type PlanExercise } from './plans/model';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

/** #os/plans (list), #os/plans/new, #os/plans/<id> (builder + assign) */
export function PlansScreen({ team, param }: { team: MyTeam; param?: string }) {
  if (param === 'new') return <PlanLoader team={team} id={null} />;
  if (param) return <PlanLoader team={team} id={param} />;
  return <PlanList team={team} />;
}

const minutesLabel = (n: number) => `${n} דק׳`;

function PlanList({ team }: { team: MyTeam }) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listPlans(team.id).then(setRows).catch((e) => setError(friendlyError(e)));
  }, [team.id]);
  if (error) return <ErrorNote message={error} />;
  if (!rows) return <Loading />;
  return (
    <div className="os-stack">
      <section className="os-card">
        <div className="os-row">
          <div>
            <h2>מערכי האימון של {team.name}</h2>
            <p className="os-muted os-small">צוות הקבוצה רואה את המערכים. הורים ושחקנים רואים רק את שם המערך והנושא של האימון.</p>
          </div>
          <a className="os-btn" href="#os/plans/new">
            + מערך חדש
          </a>
        </div>
      </section>
      {rows.length === 0 ? (
        <NoData>עוד אין מערכים לקבוצה הזאת</NoData>
      ) : (
        <section className="os-card">
          <div className="os-card__head">
            <h2>{rows.length} מערכים</h2>
            <SourceTag source="db" />
          </div>
          <ul className="os-list">
            {rows.map((r) => (
              <li key={r.id}>
                <a href={`#os/plans/${r.id}`}>
                  <span>
                    <strong>{r.title}</strong>
                    <span className="os-muted os-small"> · {r.goal || 'בלי נושא'}</span>
                  </span>
                  <span className="os-ex-card__tags">
                    <span className="os-chip">{minutesLabel(r.total_min)}</span>
                    <span className="os-chip">{r.blocks} שלבים</span>
                    {r.assigned > 0 && <span className="os-chip os-chip--done">משויך ל-{r.assigned} אימונים</span>}
                    {r.status === 'draft' && <span className="os-chip os-chip--warn">טיוטה</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PlanLoader({ team, id }: { team: MyTeam; id: string | null }) {
  const [plan, setPlan] = useState<Plan | null | undefined>(id ? undefined : { id: null, team_id: team.id, title: '', goal: '', notes: '', status: 'draft', blocks: [] });
  const [cats, setCats] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listCategories().then(setCats).catch(() => setCats([]));
    if (id) getPlan(id).then(setPlan).catch((e) => setError(friendlyError(e)));
  }, [id]);
  if (error) return <ErrorNote message={error} />;
  if (plan === undefined) return <Loading />;
  if (plan === null) return <NoData>המערך לא נמצא, או שאין לך הרשאה לראות אותו</NoData>;
  if (plan.team_id !== team.id) return <NoData>המערך שייך לקבוצה אחרת. החלף קבוצה למעלה כדי לפתוח אותו.</NoData>;
  return <PlanBuilder key={plan.id ?? 'new'} team={team} initial={plan} cats={cats} />;
}

const toPlanExercise = (e: Exercise): PlanExercise => ({
  id: e.id,
  title: e.title,
  category: e.category,
  pitch_preset: e.pitch_preset,
  area_w_m: e.area_w_m,
  area_l_m: e.area_l_m,
  diagram: e.diagram,
  coaching_points: e.coaching_points,
  equipment: e.equipment,
});

type PickTarget = { kind: 'new' } | { kind: 'block'; key: string } | { kind: 'station'; key: string; index: number };

function PlanBuilder({ team, initial, cats }: { team: MyTeam; initial: Plan; cats: Category[] }) {
  const [plan, setPlan] = useState<Plan>(initial);
  const [target, setTarget] = useState(90);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const total = planMinutes(plan.blocks);

  const update = (patch: Partial<Plan>) => {
    setPlan((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const setBlocks = (fn: (b: PlanBlock[]) => PlanBlock[]) => {
    setPlan((p) => ({ ...p, blocks: fn(p.blocks) }));
    setDirty(true);
  };
  const patchBlock = (key: string, patch: Partial<PlanBlock>) => setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const move = (key: string, to: number) =>
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.key === key);
      if (from < 0 || to < 0 || to >= bs.length) return bs;
      const next = [...bs];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  const add = (kind: BlockKind) => {
    if (kind === 'exercise') return setPick({ kind: 'new' });
    setBlocks((bs) => [...bs, newBlock(kind)]);
  };

  const onPicked = (e: Exercise) => {
    const ex = toPlanExercise(e);
    if (!pick) return;
    if (pick.kind === 'new') setBlocks((bs) => [...bs, newBlock('exercise', ex, e.duration_min)]);
    else if (pick.kind === 'block') patchBlock(pick.key, { exercise: ex });
    else
      setBlocks((bs) =>
        bs.map((b) => (b.key === pick.key ? { ...b, stations: b.stations.map((s, i) => (i === pick.index ? { ...s, exercise: ex } : s)) } : b)),
      );
    setPick(null);
  };

  const save = async () => {
    const problems = validate(plan);
    if (problems.length) return setError(problems.join(' · '));
    setSaving(true);
    setError(null);
    try {
      const id = await savePlan(plan);
      setDirty(false);
      if (!plan.id) window.location.hash = `os/plans/${id}`;
      else setPlan((p) => ({ ...p, id }));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };
  const duplicate = async () => {
    if (!plan.id || dirty) return;
    setSaving(true);
    setError(null);
    try {
      const id = await savePlan({ ...plan, id: null, status: 'draft', title: `${plan.title.trim()} (עותק)`.slice(0, 80) });
      window.location.hash = `os/plans/${id}`;
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!plan.id || !window.confirm('למחוק את המערך? אימונים שכבר שויכו שומרים את העותק שלהם.')) return;
    try {
      await deletePlan(plan.id);
      window.location.hash = 'os/plans';
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  const onDrop = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (dragKey) move(dragKey, index);
    setDragKey(null);
  };

  return (
    <div className="os-stack">
      <a className="os-back" href="#os/plans">
        → למערכים
      </a>
      <section className="os-card">
        <div className="os-form">
          <label className="os-form__wide">
            שם המערך
            <input value={plan.title} maxLength={80} onChange={(e) => update({ title: e.target.value })} placeholder="למשל: מסירה וקבלה תחת לחץ" />
          </label>
          <label className="os-form__wide">
            נושא ומטרה (גלוי גם להורים)
            <input value={plan.goal} maxLength={200} onChange={(e) => update({ goal: e.target.value })} />
          </label>
          <label>
            מצב
            <select value={plan.status} onChange={(e) => update({ status: e.target.value as Plan['status'] })}>
              <option value="draft">טיוטה</option>
              <option value="ready">מוכן</option>
            </select>
          </label>
          <label>
            משך האימון (דק׳)
            <input type="number" inputMode="numeric" min={15} max={300} value={target} onChange={(e) => setTarget(Math.max(15, Number(e.target.value) || 90))} />
          </label>
        </div>
        <div className={`os-total${total > target ? ' is-over' : total === target ? ' is-exact' : ''}`} aria-live="polite">
          <strong>{minutesLabel(total)}</strong>
          <span>
            {total === target ? 'בדיוק לפי משך האימון' : total > target ? `${total - target} דק׳ יותר ממשך האימון` : `נשארו ${target - total} דק׳`}
          </span>
          <span className="os-total__bar" style={{ ['--p' as string]: `${Math.min(100, (total / target) * 100)}%` }} />
        </div>
      </section>

      <ol className="os-blocks">
        {plan.blocks.map((b, i) => (
          <li
            key={b.key}
            className={`os-block os-block--${b.kind}${dragKey === b.key ? ' is-dragging' : ''}`}
            draggable
            onDragStart={() => setDragKey(b.key)}
            onDragEnd={() => setDragKey(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, i)}
          >
            <BlockCard
              b={b}
              index={i}
              count={plan.blocks.length}
              cats={cats}
              patch={(p) => patchBlock(b.key, p)}
              move={(to) => move(b.key, to)}
              remove={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}
              pickExercise={() => setPick({ kind: 'block', key: b.key })}
              pickStation={(index) => setPick({ kind: 'station', key: b.key, index })}
            />
          </li>
        ))}
      </ol>
      {plan.blocks.length === 0 && <NoData>המערך ריק. הוסף שלב ראשון: תרגיל מהספרייה, בלוק תחנות או הפסקה.</NoData>}

      <section className="os-card">
        <div className="os-row os-row--start">
          <button type="button" className="os-btn os-btn--ghost" onClick={() => add('exercise')}>
            + תרגיל מהספרייה
          </button>
          <button type="button" className="os-btn os-btn--ghost" onClick={() => add('stations')}>
            + בלוק תחנות
          </button>
          <button type="button" className="os-btn os-btn--ghost" onClick={() => add('break')}>
            + הפסקה
          </button>
        </div>
        <label className="os-form os-form--one">
          <span>הערות למאמנים</span>
          <textarea rows={2} maxLength={1000} value={plan.notes} onChange={(e) => update({ notes: e.target.value })} />
        </label>
        {error && <ErrorNote message={error} />}
        <div className="os-row os-row--start">
          <button type="button" className="os-btn" onClick={save} disabled={saving}>
            {saving ? 'שומר…' : plan.id ? 'שמירת שינויים' : 'שמירת המערך'}
          </button>
          {plan.id && !dirty && (
            <button type="button" className="os-btn os-btn--ghost" onClick={duplicate} disabled={saving}>
              שכפול המערך
            </button>
          )}
          {plan.id && (
            <button type="button" className="os-btn os-btn--ghost" onClick={remove}>
              מחיקת המערך
            </button>
          )}
          {dirty && <span className="os-muted os-small">יש שינויים שלא נשמרו</span>}
        </div>
      </section>

      {plan.id && !dirty && <AssignCard team={team} planId={plan.id} />}
      {plan.id && dirty && <p className="os-muted os-small">שמור את השינויים כדי לשייך את המערך לאימון.</p>}

      {pick && <ExercisePicker cats={cats} onPick={onPicked} onClose={() => setPick(null)} />}
    </div>
  );
}

const kindLabel: Record<BlockKind, string> = { exercise: 'תרגיל', stations: 'תחנות', break: 'הפסקה' };

function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
    </label>
  );
}

function BlockCard({
  b,
  index,
  count,
  cats,
  patch,
  move,
  remove,
  pickExercise,
  pickStation,
}: {
  b: PlanBlock;
  index: number;
  count: number;
  cats: Category[];
  patch: (p: Partial<PlanBlock>) => void;
  move: (to: number) => void;
  remove: () => void;
  pickExercise: () => void;
  pickStation: (i: number) => void;
}) {
  const setStations = (n: number) => {
    const stations = b.stations.slice(0, n);
    while (stations.length < n) stations.push({ exercise: null, title: '', responsible: '' });
    const full = b.rounds === b.stations.length; // every group visits every station: keep it that way
    patch({ stations, rounds: full ? n : Math.min(b.rounds, n), groups: b.groups === b.stations.length ? n : b.groups });
  };
  return (
    <div className="os-card">
      <div className="os-card__head">
        <h2>
          <span className="os-block__num">{index + 1}</span> {kindLabel[b.kind]}
          {b.kind === 'exercise' && b.exercise ? `: ${b.exercise.title}` : b.title ? `: ${b.title}` : ''}
        </h2>
        <span className="os-ex-card__tags">
          <span className="os-chip os-chip--done">{minutesLabel(blockMinutes(b))}</span>
          <button type="button" className="os-icon-btn" aria-label="הזז למעלה" disabled={index === 0} onClick={() => move(index - 1)}>
            ↑
          </button>
          <button type="button" className="os-icon-btn" aria-label="הזז למטה" disabled={index === count - 1} onClick={() => move(index + 1)}>
            ↓
          </button>
          <button type="button" className="os-icon-btn" aria-label="הסר שלב" onClick={remove}>
            ✕
          </button>
        </span>
      </div>

      {b.kind === 'exercise' && (
        <div className="os-block__ex">
          {b.exercise && (
            <a href={`#os/library/${b.exercise.id}`} className="os-block__thumb" title="פתח את התרגיל">
              <Pitch preset={b.exercise.pitch_preset} areaW={b.exercise.area_w_m} areaL={b.exercise.area_l_m} diagram={b.exercise.diagram} className="os-pitch--thumb" />
            </a>
          )}
          <div className="os-form">
            {b.exercise ? (
              <p className="os-muted os-small os-form__wide">{catLabel(cats, b.exercise.category)}</p>
            ) : (
              <label className="os-form__wide">
                כותרת (בלי תרגיל מהספרייה)
                <input value={b.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} placeholder="למשל: משחק מסכם" />
              </label>
            )}
            <NumField label="משך (דק׳)" value={b.duration_min} min={1} max={120} onChange={(n) => patch({ duration_min: n })} />
            <label className="os-form__wide">
              מטרה בשלב הזה
              <input value={b.goal} maxLength={200} onChange={(e) => patch({ goal: e.target.value })} />
            </label>
            <button type="button" className="os-btn os-btn--ghost" onClick={pickExercise}>
              {b.exercise ? 'החלף תרגיל' : 'בחר תרגיל מהספרייה'}
            </button>
          </div>
        </div>
      )}

      {b.kind === 'break' && (
        <div className="os-form">
          <label className="os-form__wide">
            כותרת
            <input value={b.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <NumField label="משך (דק׳)" value={b.duration_min} min={1} max={30} onChange={(n) => patch({ duration_min: n })} />
        </div>
      )}

      {b.kind === 'stations' && (
        <>
          <div className="os-form">
            <label className="os-form__wide">
              כותרת
              <input value={b.title} maxLength={80} onChange={(e) => patch({ title: e.target.value })} placeholder="למשל: תחנות טכניקה" />
            </label>
            <label>
              מספר תחנות
              <select value={b.stations.length} onChange={(e) => setStations(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <NumField label="קבוצות עבודה" value={b.groups} min={2} max={8} onChange={(n) => patch({ groups: n })} />
            <NumField label="סבבים" value={b.rounds} min={1} max={b.stations.length} onChange={(n) => patch({ rounds: n })} />
            <NumField label="משך תחנה (דק׳)" value={b.station_min} min={1} max={60} onChange={(n) => patch({ station_min: n })} />
            <NumField label="זמן מעבר (דק׳)" value={b.transition_min} min={0} max={10} onChange={(n) => patch({ transition_min: n })} />
          </div>
          <p className="os-formula">
            {b.rounds} סבבים × {b.station_min} דק׳ + {Math.max(b.rounds - 1, 0)} מעברים × {b.transition_min} דק׳ = <strong>{minutesLabel(blockMinutes(b))}</strong>
            <span className="os-muted os-small"> · כל הקבוצות מתחלפות יחד, לכן הזמן לא מוכפל במספר הקבוצות</span>
          </p>
          <ol className="os-stations">
            {b.stations.map((s, i) => (
              <li key={i}>
                <span className="os-block__num">{i + 1}</span>
                <div className="os-stations__main">
                  {s.exercise ? (
                    <a href={`#os/library/${s.exercise.id}`}>{s.exercise.title}</a>
                  ) : (
                    <input
                      aria-label={`תחנה ${i + 1}: כותרת`}
                      value={s.title}
                      maxLength={80}
                      placeholder="כותרת או תרגיל מהספרייה"
                      onChange={(e) => patch({ stations: b.stations.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                    />
                  )}
                  <button type="button" className="os-link-btn" onClick={() => pickStation(i)}>
                    {s.exercise ? 'החלף' : 'מהספרייה'}
                  </button>
                  {s.exercise && (
                    <button type="button" className="os-link-btn" onClick={() => patch({ stations: b.stations.map((x, j) => (j === i ? { ...x, exercise: null } : x)) })}>
                      הסר תרגיל
                    </button>
                  )}
                </div>
                <input
                  aria-label={`תחנה ${i + 1}: אחראי`}
                  className="os-stations__resp"
                  value={s.responsible}
                  maxLength={40}
                  placeholder="אחראי"
                  onChange={(e) => patch({ stations: b.stations.map((x, j) => (j === i ? { ...x, responsible: e.target.value } : x)) })}
                />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function ExercisePicker({ cats, onPick, onClose }: { cats: Category[]; onPick: (e: Exercise) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [today, setToday] = useState<string[]>([]);
  const topics = useTopics();
  useEffect(() => {
    listExercises().then(setRows).catch((e) => setError(friendlyError(e)));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shown = useMemo(
    () => byTopics((rows ?? []).filter((r) => (!cat || r.category === cat) && (!q.trim() || r.title.includes(q.trim()))), today),
    [rows, q, cat, today],
  );
  return (
    <div className="os-sheet" role="dialog" aria-modal="true" aria-label="בחירת תרגיל">
      <div className="os-sheet__panel">
        <div className="os-card__head">
          <h2>בחירת תרגיל</h2>
          <button type="button" className="os-icon-btn" aria-label="סגירה" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="os-form">
          <label>
            חיפוש
            <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>
            קטגוריה
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">הכול</option>
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <TopicChips topics={topics} value={today} onChange={setToday} label="מה מאמנים היום?" />
        {error && <ErrorNote message={error} />}
        {!rows && !error && <Loading />}
        {rows && shown.length === 0 && <NoData>אין תרגיל שמתאים</NoData>}
        <ul className="os-ex-grid os-ex-grid--pick">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" className="os-ex-card" onClick={() => onPick(r)}>
                <Pitch preset={r.pitch_preset} areaW={r.area_w_m} areaL={r.area_l_m} diagram={r.diagram} className="os-pitch--thumb" />
                <span className="os-ex-card__body">
                  <strong>{r.title}</strong>
                  <span className="os-muted os-small">
                    {catLabel(cats, r.category)} · {r.duration_min} דק׳
                  </span>
                  <TopicTags topics={topics} codes={r.topics} highlight={today} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Assign the saved plan to one of the team's trainings in the next 4 weeks. */
function AssignCard({ team, planId }: { team: MyTeam; planId: string }) {
  const [sessions, setSessions] = useState<TrainingSession[] | null>(null);
  const [withPlan, setWithPlan] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    // last 7 days too: a coach can attach the plan to a training that already happened
    const all = (await sessionsBetween(team.id, addDays(todayYmd(), -7), addDays(todayYmd(), 28))).filter((s) => !s.canceled);
    const now = Date.now();
    // upcoming first (soonest on top), then last week's (latest on top)
    const list = [...all.filter((s) => new Date(s.starts_at).getTime() >= now), ...all.filter((s) => new Date(s.starts_at).getTime() < now).reverse()];
    setSessions(list);
    setWithPlan(await assignedSessions(list.map((s) => s.id)));
  };
  useEffect(() => {
    load().catch((e) => setError(friendlyError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id, planId]);
  const assign = async (s: TrainingSession) => {
    if (withPlan.has(s.id) && !window.confirm('לאימון הזה כבר משויך מערך. להחליף אותו במערך הזה?')) return;
    setBusy(s.id);
    setError(null);
    try {
      await assignPlan(s.id, planId);
      setDone(s.id);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>שיוך לאימון ביומן</h2>
        <SourceTag source="db" />
      </div>
      <p className="os-muted os-small">השיוך שומר עותק של המערך כפי שהוא עכשיו. שינוי מאוחר במערך לא משנה אימון שכבר שויך; משייכים שוב כדי לעדכן.</p>
      {error && <ErrorNote message={error} />}
      {!sessions ? (
        <Loading />
      ) : sessions.length === 0 ? (
        <NoData>אין אימונים בשבוע שעבר או ב-4 השבועות הקרובים</NoData>
      ) : (
        <ul className="os-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <span>
                <a href={`#os/calendar/${s.id}`}>
                  {dayLabel(s.starts_at)} · {timeLabel(s.starts_at)}
                </a>
                <span className="os-muted os-small"> · {s.title} · {s.duration_min} דק׳</span>
                {new Date(s.starts_at).getTime() < Date.now() && <span className="os-chip"> עבר</span>}
                {withPlan.has(s.id) && <span className="os-chip os-chip--done"> {done === s.id ? 'שויך עכשיו' : 'יש מערך'}</span>}
              </span>
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy !== null} onClick={() => assign(s)}>
                {busy === s.id ? 'משייך…' : withPlan.has(s.id) ? 'החלף לזה' : 'שייך'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
