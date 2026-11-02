/**
 * Career page: "מדדים, כושר והתפתחות" — the child's private area.
 * Body measurements (history + charts + BMI), personal goals and nutrition.
 * Only the child's parents get data back from the server (RLS + parent
 * checks in every RPC); for anyone else the section is not rendered at all.
 */
import '../theme/development.css';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { TrendChart } from '../components/TrendChart';
import { Button, Card, ProgressBar, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  addBodyMeasurement,
  addGoalProgress,
  allergyOptions,
  bmiSeries,
  bodyFields,
  categoryLabel,
  emptyNutrition,
  getPrivateProfile,
  goalCategories,
  goalPercent,
  goalStatuses,
  removeBodyMeasurement,
  removeGoalRecord,
  restrictionOptions,
  saveGoal,
  saveNutrition,
  setGoalStatus,
  statusLabel,
  type BodyKey,
  type BodyMeasurement,
  type ChildGoal,
  type CustomMeasure,
  type GoalCategory,
  type GoalStatus,
  type MetricKind,
  type Nutrition,
  type PrivateProfile,
} from '../lib/privateApi';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const fmt = (v: number) => String(Math.round(v * 100) / 100);
const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
const num = (s: string) => {
  const v = Number(s.replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(v) ? null : v;
};
const decimal = (s: string) => s.replace(/[^\d.,]/g, '').slice(0, 7);

type Tab = 'body' | 'goals' | 'food';

export function DevelopmentSection({ playerId, name }: { playerId: string; name: string }) {
  const [data, setData] = useState<PrivateProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('body');

  const load = useCallback(
    () =>
      getPrivateProfile(playerId)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(friendlyError(e))),
    [playerId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // not a parent (or the migration hasn't run): nothing at all is shown
  if (data === null) return null;
  if (data === undefined && !error) return null;

  return (
    <section>
      <SectionHeader title="מדדים, כושר והתפתחות" icon="shield" />
      <Card>
        <p className="ip-private-note">
          <Icon name="eye" size={16} /> אזור פרטי: רק ההורים של {name} רואים אותו. מאמנים, הנהלת הקבוצה והמועדון לא רואים את המידע הזה.
        </p>
        {error && <Err error={error} />}
        {data && (
          <>
            <Segmented
              label="בחירת אזור"
              items={[
                { id: 'body', label: 'מדדי גוף' },
                { id: 'goals', label: 'יעדים' },
                { id: 'food', label: 'תזונה' },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div className="ip-dev-body">
              {tab === 'body' && <BodyTab playerId={playerId} name={name} list={data.measurements} onChanged={load} />}
              {tab === 'goals' && <GoalsTab playerId={playerId} name={name} goals={data.goals} onChanged={load} />}
              {tab === 'food' && <NutritionTab playerId={playerId} name={name} nutrition={data.nutrition} onChanged={load} />}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

/* ================================================================== body */

interface Series {
  id: string;
  label: string;
  unit: string;
  points: { date: string; value: number }[];
}

function seriesOf(list: BodyMeasurement[]): Series[] {
  const out: Series[] = [];
  for (const f of bodyFields) {
    const pts = list.filter((m) => m[f.key] != null).map((m) => ({ date: m.date, value: m[f.key] as number }));
    if (pts.length) out.push({ id: f.key, label: f.label, unit: f.unit, points: pts });
    if (f.key === 'weight_kg') {
      const bmi = bmiSeries(list);
      if (bmi.length) out.push({ id: 'bmi', label: 'BMI', unit: '', points: bmi });
    }
  }
  const custom = new Map<string, Series>();
  for (const m of list) {
    for (const c of m.custom) {
      const s = custom.get(c.label) ?? { id: `c:${c.label}`, label: c.label, unit: c.unit, points: [] };
      s.points.push({ date: m.date, value: c.value });
      custom.set(c.label, s);
    }
  }
  return [...out, ...custom.values()];
}

function BodyTab({ playerId, name, list, onChanged }: { playerId: string; name: string; list: BodyMeasurement[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const series = useMemo(() => seriesOf(list), [list]);
  const [picked, setPicked] = useState<string>('height_cm');
  const chart = series.find((s) => s.id === picked) ?? series[0];
  const customLabels = useMemo(() => [...new Set(list.flatMap((m) => m.custom.map((c) => `${c.label}|${c.unit}`)))], [list]);

  async function remove(id: string) {
    if (!window.confirm('למחוק את המדידה הזו?')) return;
    try {
      await removeBodyMeasurement(id);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <>
      {!series.length ? (
        <p className="ip-muted">עוד לא הוזנו מדידות. כל מדידה נשמרת עם תאריך, כך שאפשר לראות את ההתפתחות לאורך זמן.</p>
      ) : (
        <>
          <div className="ip-measure-grid">
            {series.map((s) => {
              const last = s.points[s.points.length - 1];
              const prev = s.points.length > 1 ? s.points[s.points.length - 2] : null;
              const change = prev ? last.value - prev.value : null;
              return (
                <div key={s.id}>
                  <span>{s.label}</span>
                  <strong>
                    {fmt(last.value)} {s.unit && <small>{s.unit}</small>}
                  </strong>
                  {change != null && change !== 0 && s.id !== 'bmi' && <em dir="ltr">{`${change > 0 ? '+' : '−'}${fmt(Math.abs(change))}`}</em>}
                </div>
              );
            })}
          </div>
          <p className="ip-footnote">מדידה אחרונה: {day(list[list.length - 1].date)} · השינוי ביחס למדידה הקודמת</p>

          <h3 className="ip-dev-subtitle">התפתחות לאורך זמן</h3>
          <div className="ip-chip-row" role="group" aria-label="בחירת מדד לגרף">
            {series.map((s) => (
              <button type="button" key={s.id} className={`ip-chip ${chart?.id === s.id ? 'is-on' : ''}`} onClick={() => setPicked(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          {chart && chart.points.length > 1 ? (
            <TrendChart key={chart.id} points={chart.points} unit={chart.unit} label={chart.label} />
          ) : (
            <p className="ip-muted ip-dev-gap">צריך לפחות שתי מדידות של {chart?.label} כדי לראות גרף.</p>
          )}
          {series.some((s) => s.id === 'bmi') && (
            <p className="ip-footnote ip-bmi-note">
              BMI = משקל (ק״ג) חלקי גובה (מ׳) בריבוע. אצל ילדים המדד משתנה עם הגיל והמין, ולכן לא מוצגות כאן קטגוריות של מבוגרים ואין דירוג. זה לא אבחון רפואי; לשאלות על גדילה ומשקל פנו לרופא/ת הילדים.
            </p>
          )}
        </>
      )}

      {manage && list.length > 0 && (
        <ul className="ip-fitness-list ip-fitness-list--manage">
          {[...list].reverse().map((m) => (
            <li key={m.id}>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">מדידה · {day(m.date)}</span>
                <span className="ip-list-row-sub">
                  {[
                    ...bodyFields.filter((f) => m[f.key] != null).map((f) => `${f.label} ${fmt(m[f.key] as number)}`),
                    ...m.custom.map((c) => `${c.label} ${fmt(c.value)}`),
                  ].join(' · ')}
                </span>
              </span>
              <button type="button" className="ip-icon-btn" aria-label="מחיקת המדידה" onClick={() => remove(m.id)}>
                <Icon name="close" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Err error={error} />
      <div className="ip-btn-row">
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setOpen(true)}>
          מדידה חדשה
        </Button>
        {list.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setManage((v) => !v)}>
            {manage ? 'סגירת ההיסטוריה' : `היסטוריה (${list.length})`}
          </Button>
        )}
      </div>
      <BodySheet open={open} playerId={playerId} name={name} customLabels={customLabels} onClose={() => setOpen(false)} onSaved={onChanged} />
    </>
  );
}

function BodySheet({ open, playerId, name, customLabels, onClose, onSaved }: { open: boolean; playerId: string; name: string; customLabels: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<{ label: string; unit: string; value: string }[]>([]);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setVals({});
      // offer the extra measures used before, empty
      setCustom(customLabels.slice(0, 8).map((k) => ({ label: k.split('|')[0], unit: k.split('|')[1] ?? '', value: '' })));
      setDate(today());
      setError(null);
    }
  }, [open, customLabels]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const values = Object.fromEntries(bodyFields.map((f) => [f.key, num(vals[f.key] ?? '')])) as Record<BodyKey, number | null>;
    const extra: CustomMeasure[] = custom
      .map((c) => ({ label: c.label.trim(), unit: c.unit.trim(), value: num(c.value) }))
      .filter((c): c is CustomMeasure => c.label !== '' && c.value != null);
    if (custom.some((c) => c.value.trim() !== '' && !c.label.trim())) {
      setError('תנו שם לכל מדד נוסף שמילאתם.');
      return;
    }
    if (Object.values(values).every((v) => v == null) && !extra.length) {
      setError('מלאו לפחות מדידה אחת.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addBodyMeasurement({ playerId, date, values, custom: extra, note: '' });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`מדידה ל${name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <p className="ip-footnote">אפשר למלא רק חלק. מדידה חדשה לא מוחקת את הקודמות. היקפים נמדדים בסרט מדידה.</p>
        <div className="ip-field-row ip-field-row--wrap">
          {bodyFields.map((f) => (
            <Field key={f.key} label={`${f.label} (${f.unit})`}>
              <input className="ip-input" inputMode="decimal" dir="ltr" value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: decimal(e.target.value) })} />
            </Field>
          ))}
        </div>
        <h3 className="ip-dev-subtitle">מדדים נוספים</h3>
        {custom.map((c, i) => (
          <div className="ip-custom-row" key={i}>
            <input className="ip-input" placeholder="שם המדד" value={c.label} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, 30) } : x)))} aria-label="שם המדד" />
            <input className="ip-input" placeholder="יחידה" value={c.unit} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, unit: e.target.value.slice(0, 10) } : x)))} aria-label="יחידה" />
            <input className="ip-input" placeholder="ערך" inputMode="decimal" dir="ltr" value={c.value} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, value: decimal(e.target.value) } : x)))} aria-label="ערך" />
            <button type="button" className="ip-icon-btn" aria-label="הסרת המדד" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
        {custom.length < 8 && (
          <Button type="button" variant="ghost" size="sm" icon="plus" onClick={() => setCustom([...custom, { label: '', unit: 'ס״מ', value: '' }])}>
            הוספת מדד משלכם
          </Button>
        )}
        <Field label="תאריך המדידה">
          <input className="ip-input" type="date" dir="ltr" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/* ================================================================= goals */

function GoalsTab({ playerId, name, goals, onChanged }: { playerId: string; name: string; goals: ChildGoal[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<ChildGoal | 'new' | null>(null);
  const [progressFor, setProgressFor] = useState<ChildGoal | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <>
      {!goals.length && <p className="ip-muted">עוד אין יעדים. הגדירו יעד אישי, למשל שיפור מהירות או רגל חלשה, ועדכנו התקדמות מדי פעם.</p>}
      <ul className="ip-goal-list">
        {goals.map((g) => {
          const pct = goalPercent(g);
          const last = g.progress[g.progress.length - 1];
          const isOpen = openId === g.id;
          return (
            <li key={g.id} className={`ip-goal ${g.status !== 'active' ? 'is-muted' : ''}`}>
              <button type="button" className="ip-goal-head" onClick={() => setOpenId(isOpen ? null : g.id)} aria-expanded={isOpen}>
                <span className="ip-goal-tags">
                  <Tag tone="blue">{categoryLabel(g.category)}</Tag>
                  <Tag tone={g.status === 'achieved' ? 'lime' : g.status === 'active' ? 'navy' : 'neutral'} icon={g.status === 'achieved' ? 'check' : undefined}>
                    {statusLabel(g.status)}
                  </Tag>
                </span>
                <ProgressBar
                  value={pct}
                  label={g.title}
                  display={
                    g.metric_kind === 'number' && last ? (
                      <span dir="ltr">
                        {fmt(last.value)} / {fmt(g.target_value ?? 0)} {g.unit}
                      </span>
                    ) : (
                      `${pct}%`
                    )
                  }
                />
                <span className="ip-goal-dates">
                  מ־{day(g.start_on)}
                  {g.target_on && ` · יעד: ${day(g.target_on)}`}
                  {g.metric_kind === 'number' && ` · ${g.metric_label || 'מדד'}: ${fmt(g.baseline ?? 0)} → ${fmt(g.target_value ?? 0)} ${g.unit}`}
                </span>
              </button>
              {isOpen && (
                <div className="ip-goal-more">
                  {g.description && <p>{g.description}</p>}
                  <div className="ip-chip-row" role="group" aria-label="סטטוס">
                    {goalStatuses.map((s) => (
                      <button type="button" key={s.id} className={`ip-chip ${g.status === s.id ? 'is-on' : ''}`} onClick={() => g.status !== s.id && run(() => setGoalStatus(g.id, s.id))}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {g.progress.length > 0 && (
                    <ul className="ip-fitness-list">
                      {[...g.progress].reverse().map((p) => (
                        <li key={p.id}>
                          <span className="ip-list-row-text">
                            <span className="ip-list-row-title" dir="auto">
                              {g.metric_kind === 'percent' ? `${fmt(p.value)}%` : `${fmt(p.value)} ${g.unit}`}
                            </span>
                            <span className="ip-list-row-sub">
                              {day(p.date)}
                              {p.note && ` · ${p.note}`}
                            </span>
                          </span>
                          <button type="button" className="ip-icon-btn" aria-label="מחיקת העדכון" onClick={() => window.confirm('למחוק את העדכון?') && run(() => removeGoalRecord('progress', p.id))}>
                            <Icon name="close" size={18} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="ip-btn-row">
                    <Button variant="primary" size="sm" icon="plus" onClick={() => setProgressFor(g)}>
                      עדכון התקדמות
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(g)}>
                      עריכה
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => window.confirm('למחוק את היעד וכל העדכונים שלו?') && run(() => removeGoalRecord('goal', g.id))}>
                      מחיקה
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Err error={error} />
      <div className="ip-btn-row">
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setEditing('new')}>
          יעד חדש
        </Button>
      </div>
      <GoalSheet open={editing !== null} goal={editing === 'new' ? null : editing} playerId={playerId} name={name} onClose={() => setEditing(null)} onSaved={onChanged} />
      <ProgressSheet goal={progressFor} onClose={() => setProgressFor(null)} onSaved={onChanged} />
    </>
  );
}

function GoalSheet({ open, goal, playerId, name, onClose, onSaved }: { open: boolean; goal: ChildGoal | null; playerId: string; name: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [category, setCategory] = useState<GoalCategory>('speed');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(today());
  const [targetOn, setTargetOn] = useState('');
  const [kind, setKind] = useState<MetricKind>('percent');
  const [metricLabel, setMetricLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState<GoalStatus>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory(goal?.category ?? 'speed');
    setTitle(goal?.title ?? '');
    setDescription(goal?.description ?? '');
    setStart(goal?.start_on ?? today());
    setTargetOn(goal?.target_on ?? '');
    setKind(goal?.metric_kind ?? 'percent');
    setMetricLabel(goal?.metric_label ?? '');
    setUnit(goal?.unit ?? '');
    setBaseline(goal?.baseline != null ? String(goal.baseline) : '');
    setTarget(goal?.target_value != null ? String(goal.target_value) : '');
    setStatus(goal?.status ?? 'active');
    setError(null);
  }, [open, goal]);

  function pickCategory(c: GoalCategory) {
    // fill the title from the category while it is still empty or a category name
    if (!title.trim() || goalCategories.some((x) => x.label === title)) setTitle(c === 'other' ? '' : categoryLabel(c));
    setCategory(c);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('תנו שם ליעד.');
    if (targetOn && targetOn < start) return setError('תאריך היעד לפני תאריך ההתחלה.');
    const b = num(baseline);
    const t = num(target);
    if (kind === 'number' && (b == null || t == null || b === t)) return setError('למדד מספרי צריך ערך התחלה וערך יעד שונים.');
    setBusy(true);
    setError(null);
    try {
      await saveGoal({
        playerId,
        id: goal?.id ?? null,
        title: title.trim(),
        category,
        description: description.trim(),
        start,
        targetOn: targetOn || null,
        kind,
        metricLabel: metricLabel.trim(),
        unit: unit.trim(),
        baseline: b,
        targetValue: t,
        status,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={goal ? 'עריכת יעד' : `יעד חדש ל${name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <div className="ip-chip-row" role="group" aria-label="סוג היעד">
          {goalCategories.map((c) => (
            <button type="button" key={c.id} className={`ip-chip ${category === c.id ? 'is-on' : ''}`} onClick={() => pickCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <Field label="שם היעד">
          <input className="ip-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 60))} required />
        </Field>
        <Field label="תיאור">
          <textarea className="ip-input ip-textarea" rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="לא חובה" />
        </Field>
        <div className="ip-field-row">
          <Field label="התחלה">
            <input className="ip-input" type="date" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="תאריך יעד">
            <input className="ip-input" type="date" dir="ltr" min={start} value={targetOn} onChange={(e) => setTargetOn(e.target.value)} />
          </Field>
        </div>
        <Field label="איך מודדים התקדמות">
          <Segmented
            label="סוג מדד"
            items={[
              { id: 'percent', label: 'אחוזים (הערכה)' },
              { id: 'number', label: 'מדד מספרי' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </Field>
        {kind === 'number' && (
          <>
            <div className="ip-field-row">
              <Field label="מה מודדים">
                <input className="ip-input" value={metricLabel} onChange={(e) => setMetricLabel(e.target.value.slice(0, 40))} placeholder="ספרינט 30 מ׳" />
              </Field>
              <Field label="יחידה">
                <input className="ip-input" value={unit} onChange={(e) => setUnit(e.target.value.slice(0, 10))} placeholder="שניות" />
              </Field>
            </div>
            <div className="ip-field-row">
              <Field label="ערך התחלה">
                <input className="ip-input" inputMode="decimal" dir="ltr" value={baseline} onChange={(e) => setBaseline(decimal(e.target.value))} required />
              </Field>
              <Field label="ערך יעד">
                <input className="ip-input" inputMode="decimal" dir="ltr" value={target} onChange={(e) => setTarget(decimal(e.target.value))} required />
              </Field>
            </div>
            <p className="ip-footnote">אפשר גם יעד שבו מספר נמוך יותר טוב יותר (למשל זמן ריצה).</p>
          </>
        )}
        {goal && (
          <Field label="סטטוס">
            <Segmented label="סטטוס" items={goalStatuses} value={status} onChange={setStatus} />
          </Field>
        )}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function ProgressSheet({ goal, onClose, onSaved }: { goal: ChildGoal | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (goal) {
      const last = goal.progress[goal.progress.length - 1];
      setValue(goal.metric_kind === 'percent' && last ? String(last.value) : '');
      setNote('');
      setDate(today());
      setError(null);
    }
  }, [goal]);
  if (!goal) return null;
  const isPct = goal.metric_kind === 'percent';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = num(value);
    if (v == null) return setError('מלאו ערך.');
    if (isPct && (v < 0 || v > 100)) return setError('אחוז בין 0 ל־100.');
    setBusy(true);
    setError(null);
    try {
      await addGoalProgress(goal!.id, date, v, note.trim());
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={`התקדמות: ${goal.title}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {isPct ? (
          <Field label={`כמה מהיעד הושג? (${value || 0}%)`}>
            <input type="range" min={0} max={100} step={5} value={num(value) ?? 0} onChange={(e) => setValue(e.target.value)} className="ip-range" />
          </Field>
        ) : (
          <Field label={`${goal.metric_label || 'ערך'} (${goal.unit || 'ערך'})`}>
            <input className="ip-input" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(decimal(e.target.value))} required />
          </Field>
        )}
        <Field label="הערה">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לא חובה" />
        </Field>
        <Field label="תאריך">
          <input className="ip-input" type="date" dir="ltr" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/* ============================================================= nutrition */

const tips: { title: string; text: string }[] = [
  { title: 'לפני אימון', text: 'ארוחה רגילה 2–3 שעות לפני, עם פחמימה (לחם, אורז, פסטה) וחלבון. אם עבר זמן רב, נשנוש קל כשעה לפני: פרי, בננה או פרוסה.' },
  { title: 'שתייה', text: 'בקבוק מים לכל אימון ומשחק, ולגימות כל 15–20 דקות, יותר בימים חמים. מים מספיקים לרוב הילדים; אין צורך במשקאות אנרגיה.' },
  { title: 'אחרי אימון', text: 'בשעה שאחרי: ארוחה או נשנוש עם חלבון ופחמימה, למשל כריך, יוגורט, שוקו או ארוחת ערב רגילה, ושתייה.' },
  { title: 'התאוששות', text: 'שינה מספקת, ארוחות סדירות ומגוונות עם ירקות ופירות. ילד שמתאמן צריך לאכול מספיק, לא פחות.' },
];

function NutritionTab({ playerId, name, nutrition, onChanged }: { playerId: string; name: string; nutrition: Nutrition | null; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const v = nutrition ?? emptyNutrition;
  const allergies = [...v.allergies.map((a) => allergyOptions.find((o) => o.id === a)?.label ?? a), ...(v.allergy_other ? [v.allergy_other] : [])];
  const restrictions = [...v.restrictions.map((a) => restrictionOptions.find((o) => o.id === a)?.label ?? a), ...(v.restriction_other ? [v.restriction_other] : [])];
  const facts: [string, string][] = [
    ['העדפות מזון', v.preferences],
    ['שעות אימון', v.training_times],
    ['צרכים סביב הפעילות', v.sport_needs],
  ];

  return (
    <>
      {!nutrition ? (
        <p className="ip-muted">עוד לא מילאתם פרטי תזונה ל{name}: העדפות, רגישויות ואלרגיות, הגבלות ושעות אימון.</p>
      ) : (
        <dl className="ip-food-facts">
          <div>
            <dt>רגישויות ואלרגיות</dt>
            <dd>{allergies.length ? allergies.map((a) => <Tag key={a} tone="warning">{a}</Tag>) : 'אין'}</dd>
          </div>
          <div>
            <dt>הגבלות תזונתיות</dt>
            <dd>{restrictions.length ? restrictions.map((a) => <Tag key={a}>{a}</Tag>) : 'אין'}</dd>
          </div>
          {facts.filter(([, val]) => val).map(([k, val]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="ip-btn-row">
        <Button variant="secondary" size="sm" icon={nutrition ? undefined : 'plus'} onClick={() => setOpen(true)}>
          {nutrition ? 'עריכה' : 'מילוי פרטי תזונה'}
        </Button>
      </div>

      <h3 className="ip-dev-subtitle">המלצות כלליות סביב אימונים</h3>
      <ul className="ip-tips">
        {tips.map((t) => (
          <li key={t.title}>
            <strong>{t.title}</strong>
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
      {allergies.length > 0 && <p className="ip-footnote">בכל המלצה, התאימו לרגישויות של {name}: {allergies.join(', ')}.</p>}
      <p className="ip-footnote">
        אלה המלצות כלליות לילדים פעילים, לא תפריט ולא דיאטה. iplays לא בונה דיאטות הרזיה, הגבלות קלוריות או תוכניות רפואיות לילדים. לאלרגיה, למצב רפואי או לשאלות על משקל וגדילה פנו לרופא/ת הילדים או לדיאטנית קלינית.
      </p>
      <NutritionSheet open={open} playerId={playerId} name={name} initial={v} onClose={() => setOpen(false)} onSaved={onChanged} />
    </>
  );
}

function NutritionSheet({ open, playerId, name, initial, onClose, onSaved }: { open: boolean; playerId: string; name: string; initial: Nutrition; onClose: () => void; onSaved: () => Promise<void> }) {
  const [v, setV] = useState<Nutrition>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setV(initial);
      setError(null);
    }
  }, [open, initial]);
  const toggle = <T extends string>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveNutrition(playerId, v);
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`תזונה של ${name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="רגישויות ואלרגיות">
          <div className="ip-chip-row">
            {allergyOptions.map((o) => (
              <button type="button" key={o.id} className={`ip-chip ${v.allergies.includes(o.id) ? 'is-on' : ''}`} aria-pressed={v.allergies.includes(o.id)} onClick={() => setV({ ...v, allergies: toggle(v.allergies, o.id) })}>
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="רגישות אחרת">
          <input className="ip-input" value={v.allergy_other} onChange={(e) => setV({ ...v, allergy_other: e.target.value.slice(0, 200) })} placeholder="לא חובה" />
        </Field>
        <Field label="הגבלות תזונתיות">
          <div className="ip-chip-row">
            {restrictionOptions.map((o) => (
              <button type="button" key={o.id} className={`ip-chip ${v.restrictions.includes(o.id) ? 'is-on' : ''}`} aria-pressed={v.restrictions.includes(o.id)} onClick={() => setV({ ...v, restrictions: toggle(v.restrictions, o.id) })}>
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="הגבלה אחרת">
          <input className="ip-input" value={v.restriction_other} onChange={(e) => setV({ ...v, restriction_other: e.target.value.slice(0, 200) })} placeholder="לא חובה" />
        </Field>
        <Field label="העדפות מזון">
          <textarea className="ip-input ip-textarea" rows={2} maxLength={500} value={v.preferences} onChange={(e) => setV({ ...v, preferences: e.target.value })} placeholder="מה אוהב/ת לאכול, מה לא" />
        </Field>
        <Field label="שעות אימון">
          <input className="ip-input" value={v.training_times} onChange={(e) => setV({ ...v, training_times: e.target.value.slice(0, 200) })} placeholder="למשל: א׳ וג׳ 17:00–18:30" />
        </Field>
        <Field label="צרכים סביב הפעילות">
          <textarea className="ip-input ip-textarea" rows={2} maxLength={500} value={v.sport_needs} onChange={(e) => setV({ ...v, sport_needs: e.target.value })} placeholder="למשל: מגיע לאימון ישר מבית הספר" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
