/**
 * Career tab with real data: a child's appearances, goals, starts, training
 * attendance, monthly trend, seasons, athletic progress and derived
 * highlights. Parents see their own children (tabs when there are several);
 * staff open any player of their team through #career/<player id>.
 * Nothing here is invented: a number with no source is not shown.
 */
import '../theme/career.css';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { BarChart, CHART_BLUE, CHART_LIME, type ChartSeries } from '../components/CareerChart';
import { Icon, type IconName } from '../components/Icon';
import { BottomSheet, ScreenTitle } from '../components/shell';
import { Button, Card, EmptyState, ProgressBar, SectionHeader, Segmented, StatTile, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError, isStaffRole } from '../lib/api';
import {
  addFitnessTest,
  attributeLabels,
  dayLabel,
  fitnessSummary,
  getCareer,
  getFitnessTestTypes,
  latestAttributes,
  monthLabel,
  removeMetric,
  saveAssessment,
  type Career,
  type FitnessTestType,
} from '../lib/careerApi';
import { NoTeam, useMyKids } from './RealScreens';
import { BodySection, MedicalSection } from './CareerProfile';
import { AffiliationsSection, PositionsSection, useProfileExtra } from './CareerAffiliations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

export function RealCareerScreen({ playerId, onShowSample }: { playerId?: string; onShowSample: () => void }) {
  const { teams } = useAuth();
  const kids = useMyKids();
  const myKids = useMemo(() => {
    const seen = new Set<string>();
    return (kids ?? []).filter((k) => (seen.has(k.id) ? false : (seen.add(k.id), true)));
  }, [kids]);
  const direct = playerId && UUID.test(playerId) ? playerId : undefined;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const selected = direct ?? (picked && myKids.some((k) => k.id === picked) ? picked : myKids[0]?.id);
  const staffTeam = teams.find((t) => isStaffRole(t.role));

  return (
    <div className="ip-stack">
      <ScreenTitle title="קריירה" />
      {!teams.length && !direct ? (
        <NoTeam onShowSample={onShowSample} />
      ) : kids === null && !direct ? (
        <p className="ip-muted">טוען…</p>
      ) : !selected ? (
        <Card>
          <EmptyState
            icon="career"
            title="עוד אין ילד מקושר אליך"
            text={staffTeam ? 'כדי לראות קריירה של שחקן או להזין הערכה ומבדק כושר, פתחו את השחקן מהסגל בדף הקבוצה.' : 'הוסיפו את הילד שלכם לקבוצה, והקריירה שלו תופיע כאן.'}
          />
          {staffTeam && (
            <div className="ip-btn-row">
              <Button variant="primary" icon="team" onClick={() => (window.location.hash = `myteam/${staffTeam.id}`)}>
                לסגל של {staffTeam.name}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          {!direct && myKids.length > 1 && (
            <Segmented label="בחירת ילד" items={myKids.map((k) => ({ id: k.id, label: k.first_name }))} value={selected} onChange={setPicked} />
          )}
          <PlayerCareer key={selected} playerId={selected} />
        </>
      )}
    </div>
  );
}

/** A load error with the server's own words, so a missing migration or a bad row can be told apart. */
function careerLoadError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  const msg = err?.message ?? String(e);
  if (code === 'PGRST202' || /Could not find the function/.test(msg)) return 'מסך הקריירה מחכה לעדכון מסד הנתונים (iplays-player-career.sql).';
  if (code === '42P01' || /does not exist/.test(msg)) return `חסרה טבלה במסד הנתונים: ${msg}`;
  if (/Failed to fetch/.test(msg)) return friendlyError(e);
  return `לא הצלחנו לטעון את הקריירה. ${code ? `(${code}) ` : ''}${msg}`;
}

function PlayerCareer({ playerId }: { playerId: string }) {
  const [career, setCareer] = useState<Career | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'assessment' | 'fitness' | null>(null);
  const { extra, reload: reloadExtra } = useProfileExtra(playerId);

  const load = useCallback(() => {
    return getCareer(playerId)
      .then((c) => {
        setCareer(c);
        setError(null);
      })
      .catch((e) => setError(careerLoadError(e)));
  }, [playerId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Card>
        <Err error={error} />
        <div className="ip-btn-row">
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            לנסות שוב
          </Button>
        </div>
      </Card>
    );
  }
  if (career === undefined) return <p className="ip-muted">טוען…</p>;
  if (career === null) {
    return (
      <Card>
        <EmptyState icon="career" title="אין גישה לשחקן הזה" text="רק ההורים של הילד וחברי הקבוצה שלו רואים את הקריירה שלו." />
      </Card>
    );
  }

  const p = career.player;
  const sport = career.sport ?? p.sport ?? 'football';
  const scoring = sport === 'football' || sport === 'basketball';
  const isBasket = sport === 'basketball';
  const goalsLabel = isBasket ? 'נקודות' : 'שערים';
  const goals = isBasket ? career.totals.points : career.totals.goals;
  const t = career.totals;
  const rate = t.trainings ? Math.round((t.trainings_attended / t.trainings) * 100) : null;

  return (
    <>
      <Card tone="navy" className="ip-career-hero">
        <div className="ip-career-hero-id">
          <InitialsAvatar name={`${p.first_name} ${p.last_name}`} size={56} tone="lime" />
          <span>
            <strong>
              {p.first_name} {p.last_name}
            </strong>
            <span className="ip-on-navy-muted">{[p.shirt_number != null && `#${p.shirt_number}`, p.position, p.team_name].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
        <div className="ip-career-hero-stats">
          <div>
            <strong>{t.appearances}</strong>
            <span>הופעות</span>
          </div>
          {scoring && (
            <div>
              <strong className="ip-lime-text">{goals}</strong>
              <span>{goalsLabel}</span>
            </div>
          )}
          {scoring && (
            <div>
              <strong>{t.starts}</strong>
              <span>בהרכב הפותח</span>
            </div>
          )}
          <div>
            <strong>{rate == null ? '–' : `${rate}%`}</strong>
            <span>נוכחות באימונים</span>
          </div>
        </div>
        {p.club && <span className="ip-on-navy-muted">{p.club}</span>}
      </Card>

      {extra && <PositionsSection career={career} extra={extra} onChanged={() => Promise.all([load(), reloadExtra()]).then(() => undefined)} />}
      <MonthlyTrend career={career} sport={sport} />
      <Seasons career={career} scoring={scoring} goalsLabel={goalsLabel} isBasket={isBasket} />
      {career.assessments !== null && (
        <Athletic career={career} onAdd={setSheet} onChanged={load} />
      )}
      <BodySection career={career} onChanged={load} />
      <MedicalSection career={career} onChanged={load} />
      {extra && <AffiliationsSection career={career} extra={extra} onChanged={() => Promise.all([load(), reloadExtra()]).then(() => undefined)} />}
      <Highlights career={career} isBasket={isBasket} />

      {career.edit_team_id && (
        <>
          <AssessmentSheet open={sheet === 'assessment'} playerId={p.id} teamId={career.edit_team_id} name={p.first_name} onClose={() => setSheet(null)} onSaved={load} />
          <FitnessSheet open={sheet === 'fitness'} playerId={p.id} teamId={career.edit_team_id} name={p.first_name} onClose={() => setSheet(null)} onSaved={load} />
        </>
      )}
    </>
  );
}

function MonthlyTrend({ career, sport }: { career: Career; sport: string }) {
  // last 6 months, but drop leading months with nothing at all (keep at least 3)
  let months = career.monthly.slice(-6);
  const empty = (m: (typeof months)[number]) => !m.appearances && !m.goals && !m.points && !m.trainings;
  while (months.length > 3 && empty(months[0])) months = months.slice(1);
  const scoring = sport === 'football' || sport === 'basketball';
  const isBasket = sport === 'basketball';
  const series: ChartSeries[] = scoring
    ? [
        { label: isBasket ? 'נקודות' : 'שערים', color: CHART_BLUE },
        { label: 'הופעות', color: CHART_LIME },
      ]
    : [
        { label: 'אימונים שהגיע', color: CHART_BLUE },
        { label: 'הופעות', color: CHART_LIME },
      ];
  const data = months.map((m) => ({
    month: monthLabel(m.month),
    values: scoring ? [isBasket ? m.points : m.goals, m.appearances] : [m.trainings_attended, m.appearances],
  }));
  const nothing = months.every(empty);
  const last = months[months.length - 1];
  return (
    <section>
      <SectionHeader title="מגמה לפי חודש" icon="career" />
      <Card>
        {nothing ? (
          <p className="ip-muted">עוד אין משחקים או אימונים בחודשים האחרונים.</p>
        ) : (
          <>
            <BarChart data={data} series={series} />
            {last && last.trainings > 0 && (
              <div className="ip-stats ip-stats--compact">
                <StatTile value={`${last.trainings_attended}/${last.trainings}`} label={`אימונים ב${monthLabel(last.month)}`} />
                <StatTile value={last.appearances} label={`משחקים ב${monthLabel(last.month)}`} />
              </div>
            )}
          </>
        )}
        <p className="ip-footnote">{scoring ? 'שערים מדיווח השערים במשחק. הופעה = סימון נוכחות או הרכב שפורסם.' : 'לפי סימון הנוכחות של הצוות.'}</p>
      </Card>
    </section>
  );
}

function Seasons({ career, scoring, goalsLabel, isBasket }: { career: Career; scoring: boolean; goalsLabel: string; isBasket: boolean }) {
  if (!career.seasons.length) return null;
  return (
    <section>
      <SectionHeader title="לפי עונה" icon="calendar" />
      <Card padded={false}>
        <ul className="ip-career-seasons">
          {career.seasons.map((s) => (
            <li key={s.season + s.team_id}>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">{s.team_name}</span>
                <span className="ip-list-row-sub">עונת {s.season}</span>
              </span>
              <span className="ip-career-season-nums">
                <span>
                  <strong>{s.appearances}</strong> הופעות
                </span>
                {scoring && (
                  <span>
                    <strong>{isBasket ? s.points : s.goals}</strong> {goalsLabel}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Athletic({ career, onAdd, onChanged }: { career: Career; onAdd: (s: 'assessment' | 'fitness') => void; onChanged: () => Promise<void> }) {
  const assessments = career.assessments ?? [];
  const attrs = latestAttributes(assessments);
  const tests = fitnessSummary(career.fitness ?? []);
  const editable = !!career.edit_team_id;
  const [manage, setManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastDate = assessments.length ? assessments[assessments.length - 1].date : null;

  async function remove(kind: 'assessment' | 'fitness', id: string) {
    if (!window.confirm('למחוק את הרישום הזה?')) return;
    try {
      await removeMetric(kind, id);
      await onChanged();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <section>
      <SectionHeader title="התקדמות אתלטית" icon="bolt" action={editable && (assessments.length || tests.length) ? (manage ? 'סיום' : 'ניהול') : undefined} onAction={() => setManage((v) => !v)} />
      <Card>
        {!attrs.length && !tests.length ? (
          <p className="ip-muted">{editable ? 'עוד לא הוזנו הערכה או מבדק כושר.' : 'המאמן עוד לא הזין הערכה או מבדק כושר.'}</p>
        ) : (
          <>
            {attrs.length > 0 && (
              <div className="ip-progress-list">
                {attrs.map((a) => (
                  <ProgressBar key={a.key} label={a.label} value={a.value * 10} display={`${a.value}/10`} delta={a.delta} />
                ))}
              </div>
            )}
            {lastDate && <p className="ip-footnote">הערכת המאמן מ-{dayLabel(lastDate)} · השינוי מוצג ביחס להערכה הקודמת</p>}
            {tests.length > 0 && (
              <ul className="ip-fitness-list">
                {tests.map((f) => (
                  <li key={f.test}>
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{f.label}</span>
                      <span className="ip-list-row-sub">
                        {dayLabel(f.date)}
                        {f.count > 1 && !f.isBest && ` · שיא: ${fmt(f.best.value)}`}
                      </span>
                    </span>
                    <span className="ip-fitness-value">
                      <strong dir="ltr">{fmt(f.value)}</strong> {f.unit}
                      {f.isBest ? (
                        <Tag tone="lime" icon="star">שיא אישי</Tag>
                      ) : f.change != null && f.change !== 0 ? (
                        <Tag tone={f.better ? 'lime' : 'neutral'}>{`${f.change > 0 ? '+' : '−'}${fmt(Math.abs(f.change))}`}</Tag>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {manage && (
          <ul className="ip-fitness-list ip-fitness-list--manage">
            {[...assessments].reverse().map((a) => (
              <li key={a.id}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">הערכה · {dayLabel(a.date)}</span>
                  <span className="ip-list-row-sub">
                    {attributeLabels.filter((x) => a[x.key] != null).map((x) => `${x.label} ${a[x.key]}`).join(' · ')}
                  </span>
                </span>
                <button type="button" className="ip-icon-btn" aria-label="מחיקת ההערכה" onClick={() => remove('assessment', a.id)}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
            {[...(career.fitness ?? [])].reverse().map((f) => (
              <li key={f.id}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{f.label} · {dayLabel(f.date)}</span>
                  <span className="ip-list-row-sub">
                    {fmt(f.value)} {f.unit}
                  </span>
                </span>
                <button type="button" className="ip-icon-btn" aria-label="מחיקת התוצאה" onClick={() => remove('fitness', f.id)}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Err error={error} />
        {editable && (
          <div className="ip-btn-row">
            <Button variant="secondary" size="sm" icon="plus" onClick={() => onAdd('assessment')}>
              הערכה חדשה
            </Button>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => onAdd('fitness')}>
              תוצאת מבדק
            </Button>
          </div>
        )}
        {!editable && <p className="ip-footnote">רק ההורים של הילד וצוות הקבוצה רואים את החלק הזה.</p>}
      </Card>
    </section>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

function Highlights({ career, isBasket }: { career: Career; isBasket: boolean }) {
  const items: { date: string; title: string; detail: string; icon: IconName }[] = [];
  const gm = career.goal_matches;
  if (gm.length) {
    const first = gm[0];
    items.push({ date: first.date, title: isBasket ? 'הסל הראשון' : 'שער ראשון', detail: `מול ${first.opponent}`, icon: 'goal' });
  }
  if (isBasket) {
    const best = gm.reduce<(typeof gm)[number] | null>((b, m) => (!b || m.points > b.points ? m : b), null);
    if (best && gm.length > 1) items.push({ date: best.date, title: `שיא נקודות: ${best.points}`, detail: `מול ${best.opponent}`, icon: 'star' });
  } else {
    for (const m of gm) {
      if (m.goals >= 3) items.push({ date: m.date, title: m.goals === 3 ? 'שלושער' : `${m.goals} שערים במשחק`, detail: `מול ${m.opponent}`, icon: 'star' });
      else if (m.goals === 2) items.push({ date: m.date, title: 'צמד', detail: `מול ${m.opponent}`, icon: 'goal' });
    }
  }
  for (const f of fitnessSummary(career.fitness ?? [])) {
    if (f.isBest) items.push({ date: f.date, title: `שיא אישי ב${f.label}`, detail: `${fmt(f.value)} ${f.unit}`, icon: 'bolt' });
  }
  if (!items.length) return null;
  items.sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section>
      <SectionHeader title="רגעים מיוחדים" icon="star" />
      <Card padded={false}>
        <ol className="ip-timeline">
          {items.slice(0, 6).map((h) => (
            <li key={h.date + h.title}>
              <span className={`ip-icon-tile ip-icon-tile--${h.icon === 'star' ? 'lime' : 'blue'}`}>
                <Icon name={h.icon} size={20} />
              </span>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">{h.title}</span>
                <span className="ip-list-row-sub">{h.detail}</span>
              </span>
              <Tag>{dayLabel(h.date).slice(0, 5)}</Tag>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function AssessmentSheet({ open, playerId, teamId, name, onClose, onSaved }: { open: boolean; playerId: string; teamId: string; name: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(today());
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDate(today());
      setVals({});
      setNote('');
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!attributeLabels.some((a) => vals[a.key] != null)) {
      setError('דרגו לפחות תכונה אחת.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveAssessment({
        playerId,
        teamId,
        date,
        speed: vals.speed ?? null,
        stamina: vals.stamina ?? null,
        technique: vals.technique ?? null,
        vision: vals.vision ?? null,
        note,
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
    <BottomSheet open={open} onClose={onClose} title={`הערכה ל${name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <p className="ip-footnote">דרגו מ-1 עד 10. אפשר לדלג על תכונה. ההורים של {name} יראו את ההערכה.</p>
        {attributeLabels.map((a) => (
          <div key={a.key} className="ip-rate-row">
            <span>{a.label}</span>
            <span className="ip-rate-scale" role="radiogroup" aria-label={a.label}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={vals[a.key] === n}
                  className={vals[a.key] === n ? 'is-on' : ''}
                  onClick={() => setVals((v) => ({ ...v, [a.key]: v[a.key] === n ? null : n }))}
                >
                  {n}
                </button>
              ))}
            </span>
          </div>
        ))}
        <Field label="תאריך">
          <input className="ip-input" type="date" dir="ltr" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="הערה">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="לא חובה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function FitnessSheet({ open, playerId, teamId, name, onClose, onSaved }: { open: boolean; playerId: string; teamId: string; name: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [types, setTypes] = useState<FitnessTestType[]>([]);
  const [test, setTest] = useState('');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setValue('');
    setDate(today());
    setError(null);
    getFitnessTestTypes()
      .then((t) => {
        setTypes(t);
        setTest((cur) => cur || t[0]?.code || '');
      })
      .catch((e) => setError(friendlyError(e)));
  }, [open]);
  const unit = types.find((t) => t.code === test)?.unit ?? '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = Number(value.replace(',', '.'));
    if (!test || !value || !Number.isFinite(v) || v < 0) {
      setError('הזינו תוצאה במספרים.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addFitnessTest({ playerId, teamId, test, value: v, date, note: '' });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`תוצאת מבדק ל${name}`}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="מבדק">
          <select className="ip-input" value={test} onChange={(e) => setTest(e.target.value)}>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={unit ? `תוצאה (${unit})` : 'תוצאה'}>
          <input className="ip-input" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, '').slice(0, 8))} placeholder="לדוגמה: 5.2" required />
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
