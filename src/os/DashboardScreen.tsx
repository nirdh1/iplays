import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { AREAS, areaOf } from './areas';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

/** club_dashboard(): supabase/migrations/20261106400000_training_reports_dashboard.sql */
interface TeamRow {
  team_id: string;
  name: string;
  held: number;
  held_marked: number;
  marked_cells: number;
  came: number;
  attendance_pct: number | null;
  missing_reports: number;
  upcoming: number;
  upcoming_no_plan: number;
  held_no_plan: number;
}
interface Dash {
  days: number;
  generated_at: string;
  teams: TeamRow[];
  totals: { held: number; marked_cells: number; attendance_pct: number | null; missing_reports: number; upcoming: number; upcoming_no_plan: number; new_club_exercises: number };
}

/** club_team_results(): supabase/migrations/20261109200000_club_team_results.sql */
interface TeamResult {
  team_id: string;
  name: string;
  linked: boolean;
  league_name: string | null;
  has_results: boolean;
  league_teams: number;
  last_result_at: string | null;
  pos: number | null;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  form: string;
  ifa_coach: string | null;
  app_coaches: string[];
}

/** club_trends() / club_drill_usage(): supabase/migrations/20261109400000_club_trends_drills.sql */
interface Week {
  start: string;
  held: number;
  attendance_pct: number | null;
  plan_pct: number | null;
  report_pct?: number | null;
}
interface Trends {
  weeks: Week[];
  teams: { team_id: string; name: string; weeks: Week[] }[];
}
interface DrillRow {
  team_id: string;
  exercise_id: string;
  title: string;
  scope: 'iplays' | 'club';
  topics: string[];
  sessions: number;
}
interface Drills {
  days: number;
  rows: DrillRow[];
  personal: { team_id: string; sessions: number }[];
}

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/** undefined = loading, null = not available (no permission, or that database part is not installed yet) */
function useRpc<T>(fn: string, args: Record<string, unknown> | null, pick?: (d: unknown) => T): T | null | undefined {
  const [v, setV] = useState<T | null | undefined>(undefined);
  const key = JSON.stringify(args);
  useEffect(() => {
    if (!args) return;
    let live = true;
    setV(undefined);
    db()
      .rpc(fn, args)
      .then(({ data, error }) => {
        if (!live) return;
        setV(error || !data ? null : pick ? pick(data) : (data as T));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, key]);
  return v;
}

/**
 * Club director dashboard (user 2026-11-09: purposeful, professional, graphic).
 * Answers three questions: are the teams progressing, where is the problem,
 * what do I do now. Real numbers only; alerts can't be hidden.
 */
export function DashboardScreen() {
  const [clubs, setClubs] = useState<{ club_id: string; name: string }[] | null>(null);
  const [club, setClub] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [dash, setDash] = useState<Dash | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const results = useRpc<TeamResult[]>('club_team_results', club ? { p_club: club } : null, (d) => (d as { teams: TeamResult[] }).teams ?? []);
  const trends = useRpc<Trends>('club_trends', club ? { p_club: club, p_weeks: 8 } : null);
  const drills = useRpc<Drills>('club_drill_usage', club ? { p_club: club, p_days: 90 } : null);

  useEffect(() => {
    db()
      .rpc('my_dashboard_clubs')
      .then(({ data, error }) => {
        if (error) return setError(friendlyError(error));
        const list = (data ?? []) as { club_id: string; name: string }[];
        setClubs(list);
        setClub(list[0]?.club_id ?? null);
      });
  }, []);
  useEffect(() => {
    if (!club) return;
    setDash(undefined);
    db()
      .rpc('club_dashboard', { p_club: club, p_days: days })
      .then(({ data, error }) => (error ? setError(friendlyError(error)) : setDash(data as Dash | null)));
  }, [club, days]);

  if (error) return <ErrorNote message={error} />;
  if (!clubs) return <Loading />;
  if (!clubs.length)
    return (
      <section className="os-state">
        <h2>הדשבורד מיועד להנהלת המועדון</h2>
        <p className="os-muted">החשבון הזה לא מוגדר כבעלים או מנהל של מועדון, ואין לו הרשאת דוחות ברמת המועדון.</p>
      </section>
    );
  if (dash === undefined) return <Loading />;
  if (!dash) return <NoData>אין לך הרשאה לדשבורד של המועדון הזה</NoData>;

  const coachOfTeam = new Map((results ?? []).map((r) => [r.team_id, coachOf(r)]));
  const coaches = coachRows(results ?? [], dash.teams);
  const transfer = drillTransfer(coaches, drills ?? null, coachOfTeam);
  const actions = buildActions(dash, results ?? [], trends ?? null, transfer);

  return (
    <div className="os-stack os-dash">
      <header className="os-dash__head">
        <div>
          <span className="os-dash__eyebrow">דשבורד מנהל מקצועי</span>
          {clubs.length > 1 ? (
            <label className="os-teampick">
              <span className="os-muted">מועדון</span>
              <select value={club ?? ''} onChange={(e) => setClub(e.target.value)}>
                {clubs.map((c) => (
                  <option key={c.club_id} value={c.club_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <h2 className="os-dash__title">{clubs[0].name}</h2>
          )}
        </div>
        <div className="os-seg" role="group" aria-label="תקופה">
          {[7, 30].map((d) => (
            <button key={d} type="button" aria-pressed={days === d} className={days === d ? 'is-on is-present' : ''} onClick={() => setDays(d)}>
              {d} ימים
            </button>
          ))}
        </div>
      </header>

      <Pulse dash={dash} trends={trends} />

      <section className="os-card">
        <div className="os-card__head">
          <h2>מה לעשות עכשיו</h2>
          <SourceTag source="db" />
        </div>
        {actions.length === 0 ? (
          <p className="os-muted">אין פעולות פתוחות. כל הקבוצות מסמנות נוכחות, מגישות דוחות ומתכננות אימונים.</p>
        ) : (
          <div className="os-dash__actions">
            {actions.slice(0, 3).map((x, i) => (
              <article key={i} className={`os-dash__action is-${x.level}`}>
                <span className="os-dash__level">{x.level === 'critical' ? 'דחוף' : x.level === 'warn' ? 'לטיפול השבוע' : 'הזדמנות'}</span>
                <h3>{x.title}</h3>
                <p>{x.body}</p>
                <a className="os-btn" href={x.href}>
                  {x.cta}
                </a>
              </article>
            ))}
          </div>
        )}
      </section>

      <AreaDuel results={results ?? []} work={dash.teams} trends={trends ?? null} days={dash.days} />
      <TeamCards results={results} work={dash.teams} trends={trends} days={dash.days} />
      <CoachBars rows={coaches} loading={results === undefined} />
      <TrendChart trends={trends} />
      <Transfer transfer={transfer} drills={drills} />

      {dash.teams.length === 0 && (
        <p className="os-muted">
          עדיין אין קבוצות משויכות למועדון.{' '}
          <a className="os-back" href="#club/search">
            חיפוש ושיוך קבוצות
          </a>
        </p>
      )}
      <p className="os-muted os-small">
        <SourceTag source="db" /> נוכחות מחושבת רק מסימוני צוות; אימון בלי סימון לא נספר כ־100%. אימונים אישיים לא נכללים. עודכן{' '}
        {new Date(dash.generated_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

/* ---------- numbers ---------- */

const FORM_HE: Record<string, string> = { W: 'נ', D: 'ת', L: 'ה' };
const FORM_PTS: Record<string, number> = { W: 3, D: 1, L: 0 };

function formPpg(form: string): number | null {
  return form ? [...form].reduce((s, c) => s + (FORM_PTS[c] ?? 0), 0) / form.length : null;
}
/** Last-5 points per game against the season's: up / down / steady. */
function trend(r: TeamResult): 'up' | 'down' | 'flat' | null {
  const season = r.played ? r.points! / r.played : null;
  const recent = formPpg(r.form);
  if (season === null || recent === null || (r.played ?? 0) < 4) return null;
  if (recent - season >= 0.4) return 'up';
  if (season - recent >= 0.4) return 'down';
  return 'flat';
}
const TREND_LABEL = { up: 'במגמת עלייה', down: 'במגמת ירידה', flat: 'יציב' };
const TREND_MARK = { up: '↑', down: '↓', flat: '→' };
function coachOf(r: TeamResult): string {
  return r.app_coaches[0] || r.ifa_coach || 'ללא מאמן';
}
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);
const planPct = (w: TeamRow | undefined) => (w && w.held > 0 ? pctOf(w.held - w.held_no_plan, w.held) : null);
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
/** Last N weeks that had trainings, newest last. */
function heldWeeks(ws: Week[]) {
  return ws.filter((w) => w.held > 0);
}
/** Change between the average of the last 2 active weeks and the 2 before them. */
function delta(ws: Week[], key: 'attendance_pct' | 'plan_pct' | 'report_pct'): number | null {
  const h = heldWeeks(ws);
  if (h.length < 3) return null;
  const now = avg(h.slice(-2).map((w) => w[key]));
  const before = avg(h.slice(-4, -2).map((w) => w[key]));
  return now === null || before === null ? null : Math.round(now - before);
}
function level(v: number | null, good = 80, ok = 60): 'good' | 'ok' | 'low' | 'none' {
  if (v === null) return 'none';
  return v >= good ? 'good' : v >= ok ? 'ok' : 'low';
}

interface CoachRow {
  name: string;
  teams: string[];
  teamIds: string[];
  ppg: number | null;
  recent: number | null;
  attendance: number | null;
  plan: number | null;
  report: number | null;
  missing: number;
}
function coachRows(results: TeamResult[], work: TeamRow[]): CoachRow[] {
  const byTeam = new Map(work.map((w) => [w.team_id, w]));
  const groups = new Map<string, TeamResult[]>();
  for (const r of results) groups.set(coachOf(r), [...(groups.get(coachOf(r)) ?? []), r]);
  const rows = [...groups.entries()].map(([name, teams]) => {
    const played = teams.reduce((s, r) => s + (r.played ?? 0), 0);
    const points = teams.reduce((s, r) => s + (r.points ?? 0), 0);
    const ws = teams.map((r) => byTeam.get(r.team_id)).filter((w): w is TeamRow => !!w);
    const cells = ws.reduce((s, w) => s + w.marked_cells, 0);
    const held = ws.reduce((s, w) => s + w.held, 0);
    const missing = ws.reduce((s, w) => s + w.missing_reports, 0);
    return {
      name,
      teams: teams.map((r) => r.name),
      teamIds: teams.map((r) => r.team_id),
      ppg: played ? points / played : null,
      recent: formPpg(teams.map((r) => r.form).join('')),
      attendance: pctOf(ws.reduce((s, w) => s + w.came, 0), cells),
      plan: pctOf(ws.reduce((s, w) => s + w.held - w.held_no_plan, 0), held),
      report: pctOf(held - missing, held),
      missing,
    };
  });
  return rows.sort((a, b) => (b.ppg ?? -1) - (a.ppg ?? -1));
}

/** Professional work score of a coach: the average of attendance, plan % and report %. */
function workScore(c: CoachRow) {
  return avg([c.attendance, c.plan, c.report]);
}

interface TransferPlan {
  from: CoachRow;
  to: CoachRow;
  drills: { exercise_id: string; title: string; topics: string[]; sessions: number }[];
}
/**
 * Who could learn from whom: the strongest coach (results, else work score)
 * and the one who needs the most support, with the shared exercises the strong
 * one uses most that the other has not used.
 */
function drillTransfer(coaches: CoachRow[], drills: Drills | null, coachOfTeam: Map<string, string>): TransferPlan | null {
  const real = coaches.filter((c) => c.name !== 'ללא מאמן');
  if (real.length < 2 || !drills) return null;
  const score = (c: CoachRow) => (c.ppg !== null ? c.ppg * 33 : 0) + (workScore(c) ?? 0);
  const sorted = [...real].sort((a, b) => score(b) - score(a));
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  if (score(from) - score(to) < 10) return null;
  const used = new Set(drills.rows.filter((r) => coachOfTeam.get(r.team_id) === to.name).map((r) => r.exercise_id));
  const tally = new Map<string, { exercise_id: string; title: string; topics: string[]; sessions: number }>();
  for (const r of drills.rows) {
    if (coachOfTeam.get(r.team_id) !== from.name || used.has(r.exercise_id)) continue;
    const t = tally.get(r.exercise_id) ?? { exercise_id: r.exercise_id, title: r.title, topics: r.topics, sessions: 0 };
    t.sessions += r.sessions;
    tally.set(r.exercise_id, t);
  }
  const list = [...tally.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 3);
  return { from, to, drills: list };
}

interface Action {
  level: 'critical' | 'warn' | 'chance';
  title: string;
  body: string;
  cta: string;
  href: string;
}
function buildActions(dash: Dash, results: TeamResult[], trends: Trends | null, transfer: TransferPlan | null): Action[] {
  const out: Action[] = [];
  const noMarks = dash.teams.filter((x) => x.held > x.held_marked);
  if (noMarks.length) {
    const n = noMarks.reduce((s, x) => s + x.held - x.held_marked, 0);
    out.push({ level: 'critical', title: `נוכחות לא סומנה ב־${n} אימונים`, body: `בלי סימון אי אפשר לדעת מי מגיע ומי נושר. קבוצות: ${noMarks.map((x) => x.name).join(', ')}.`, cta: 'ללוח האימונים', href: '#os/calendar' });
  }
  // a team whose attendance dropped 10+ points over the last weeks
  const drops = (trends?.teams ?? [])
    .map((t) => ({ t, d: delta(t.weeks, 'attendance_pct') }))
    .filter((x) => x.d !== null && x.d <= -10)
    .sort((a, b) => a.d! - b.d!);
  if (drops.length) out.push({ level: 'critical', title: `הנוכחות ב${drops[0].t.name} יורדת`, body: `ירידה של ${-drops[0].d!} נקודות בשבועיים האחרונים לעומת השבועיים שלפניהם. כדאי לדבר עם המאמן לפני שילדים נושרים.`, cta: 'לפרטי הקבוצה', href: '#os/calendar' });
  const falling = results.filter((r) => trend(r) === 'down');
  if (falling.length) out.push({ level: 'warn', title: `${falling[0].name} במגמת ירידה במשחקים`, body: `ב־5 המשחקים האחרונים פחות נקודות למשחק מאשר בעונה כולה. ${falling.length > 1 ? `עוד ${falling.length - 1} קבוצות באותו מצב.` : ''}`, cta: 'למאזנים', href: '#os/dashboard' });
  if (transfer && transfer.drills.length) out.push({ level: 'chance', title: `להעביר תרגילים מ${transfer.from.name} ל${transfer.to.name}`, body: `${transfer.drills.length} תרגילים ש${transfer.from.name} משתמש בהם הכי הרבה ו${transfer.to.name} עוד לא ניסה. פרטים למטה.`, cta: 'לתרגילים', href: `#os/library/${transfer.drills[0].exercise_id}` });
  const byMissing = [...dash.teams].filter((x) => x.missing_reports > 0).sort((a, b) => b.missing_reports - a.missing_reports);
  if (byMissing.length) out.push({ level: 'warn', title: `${dash.totals.missing_reports} אימונים בלי דוח`, body: `דוח של דקה בסוף אימון הוא מה שמראה למנהל מה עובד. הכי הרבה חסרים: ${byMissing[0].name} (${byMissing[0].missing_reports}).`, cta: 'למצב אימון', href: '#os/day' });
  const noPlan = dash.teams.filter((x) => x.upcoming_no_plan > 0).sort((a, b) => b.upcoming_no_plan - a.upcoming_no_plan);
  if (noPlan.length) out.push({ level: 'warn', title: `${dash.totals.upcoming_no_plan} אימונים קרובים בלי מערך`, body: `אימון בלי מערך הוא אימון מאולתר. הכי הרבה: ${noPlan[0].name} (${noPlan[0].upcoming_no_plan}).`, cta: 'לבניית מערך', href: '#os/plans' });
  const rank = { critical: 0, warn: 1, chance: 2 };
  // keep one opportunity in the top 3 when there is one
  const sorted = out.sort((a, b) => rank[a.level] - rank[b.level]);
  const chance = sorted.find((a) => a.level === 'chance');
  const top = sorted.filter((a) => a !== chance).slice(0, chance ? 2 : 3);
  return chance ? [...top, chance] : top;
}

/* ---------- graphics ---------- */

function Spark({ values, label }: { values: (number | null)[]; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return <span className="os-spark os-spark--empty" aria-hidden="true" />;
  const w = 100;
  const h = 28;
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - 2 - (Math.max(0, Math.min(100, v)) / 100) * (h - 4);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="os-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.5" fill="currentColor" />
    </svg>
  );
}

function Delta({ d, unit = '' }: { d: number | null; unit?: string }) {
  if (d === null) return <span className="os-delta">אין עדיין השוואה</span>;
  if (d === 0) return <span className="os-delta">ללא שינוי</span>;
  return (
    <span className={`os-delta ${d > 0 ? 'is-up' : 'is-down'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d)}
      {unit} משבועיים קודמים
    </span>
  );
}

function Bar({ value, max = 100, tone }: { value: number | null; max?: number; tone?: string }) {
  const w = value === null ? 0 : Math.max(3, Math.min(100, (value / max) * 100));
  return (
    <span className={`os-bar is-${tone ?? level(value)}`} aria-hidden="true">
      <span style={{ inlineSize: `${w}%` }} />
    </span>
  );
}

function Ring({ value, label }: { value: number | null; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <svg className={`os-ring is-${level(value, 80, 60)}`} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${value === null ? 'אין נתונים' : value}`}>
      <circle cx="50" cy="50" r={r} className="os-ring__bg" />
      <circle cx="50" cy="50" r={r} className="os-ring__fg" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="50" dominantBaseline="central" textAnchor="middle">
        {value === null ? '—' : value}
      </text>
    </svg>
  );
}

/** The club in one look: work score ring + 4 KPIs with 8-week sparklines. */
function Pulse({ dash, trends }: { dash: Dash; trends: Trends | null | undefined }) {
  const t = dash.totals;
  const ws = trends?.weeks ?? [];
  const h = heldWeeks(ws);
  const last4 = h.slice(-4);
  const score = avg([avg(last4.map((w) => w.attendance_pct)), avg(last4.map((w) => w.plan_pct)), avg(last4.map((w) => w.report_pct))]);
  const prev4 = h.slice(-8, -4);
  const prevScore = prev4.length ? avg([avg(prev4.map((w) => w.attendance_pct)), avg(prev4.map((w) => w.plan_pct)), avg(prev4.map((w) => w.report_pct))]) : null;
  const scoreDelta = score !== null && prevScore !== null ? Math.round(score - prevScore) : null;
  const tiles = [
    { label: 'נוכחות', value: t.attendance_pct === null ? '—' : `${t.attendance_pct}%`, spark: ws.map((w) => w.attendance_pct), d: delta(ws, 'attendance_pct'), warn: (t.attendance_pct ?? 100) < 75 },
    { label: 'אימונים עם מערך', value: (() => { const p = pctOf(dash.teams.reduce((s, x) => s + x.held - x.held_no_plan, 0), t.held); return p === null ? '—' : `${p}%`; })(), spark: ws.map((w) => w.plan_pct), d: delta(ws, 'plan_pct'), warn: false },
    { label: 'אימונים עם דוח', value: (() => { const p = pctOf(t.held - t.missing_reports, t.held); return p === null ? '—' : `${p}%`; })(), spark: ws.map((w) => w.report_pct ?? null), d: delta(ws, 'report_pct'), warn: t.missing_reports > 0 },
    { label: `אימונים קרובים בלי מערך`, value: `${t.upcoming_no_plan}/${t.upcoming}`, spark: null, d: null, warn: t.upcoming_no_plan > 0 },
  ];
  return (
    <section className="os-card os-pulse">
      <div className="os-pulse__score">
        <Ring value={score === null ? null : Math.round(score)} label="מדד עבודה מקצועית" />
        <div>
          <h2>מדד עבודה מקצועית</h2>
          <p className="os-muted os-small">ממוצע של נוכחות, אימונים עם מערך ואימונים עם דוח, ב־4 השבועות האחרונים שהיו בהם אימונים.</p>
          {trends === undefined ? <span className="os-delta">טוען…</span> : trends === null ? <span className="os-delta">המגמות עוד לא הופעלו במסד הנתונים</span> : <Delta d={scoreDelta} />}
        </div>
      </div>
      <div className="os-pulse__tiles">
        {tiles.map((x) => (
          <div key={x.label} className={`os-tile${x.warn ? ' is-warn' : ''}`}>
            <span className="os-tile__label">{x.label}</span>
            <strong className="os-tile__value">{x.value}</strong>
            {x.spark && trends ? <Spark values={x.spark} label={`${x.label}, 8 שבועות`} /> : <span className="os-tile__sub">{dash.days} ימים אחרונים</span>}
            {x.spark && trends ? <Delta d={x.d} /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Form({ form }: { form: string }) {
  if (!form) return <span className="os-muted os-small">אין משחקים</span>;
  return (
    <span className="os-wdl os-wdl--lg" aria-label="5 משחקים אחרונים, מהאחרון">
      {[...form].map((c, i) => (
        <span key={i} className={`os-wdl__${c}`}>
          {FORM_HE[c] ?? c}
        </span>
      ))}
    </span>
  );
}

function TeamCards({ results, work, trends, days }: { results: TeamResult[] | null | undefined; work: TeamRow[]; trends: Trends | null | undefined; days: number }) {
  if (results === undefined) return <Loading />;
  const byTeam = new Map(work.map((w) => [w.team_id, w]));
  const trendOf = new Map((trends?.teams ?? []).map((t) => [t.team_id, t.weeks]));
  // results may be unavailable (database part not installed): still show the work numbers
  const list: (TeamResult | { team_id: string; name: string; only: true })[] = results ?? work.map((w) => ({ team_id: w.team_id, name: w.name, only: true as const }));
  const lastResult = (results ?? []).map((r) => r.last_result_at).filter(Boolean).sort().pop();
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>הקבוצות שלי</h2>
        <SourceTag source="db" />
      </div>
      {list.length === 0 ? (
        <p className="os-muted">אין קבוצות משויכות למועדון.</p>
      ) : (
        <div className="os-tcards">
          {list.map((r) => {
            const w = byTeam.get(r.team_id);
            const res = 'only' in r ? null : r;
            const tr = res ? trend(res) : null;
            const p = planPct(w);
            const weeks = trendOf.get(r.team_id) ?? [];
            const drop = delta(weeks, 'attendance_pct');
            const alert = tr === 'down' || (drop !== null && drop <= -10) || (w?.attendance_pct ?? 100) < 70;
            return (
              <article key={r.team_id} className={`os-tcard${alert ? ' is-alert' : ''}`}>
                <div className="os-tcard__top">
                  <div>
                    <h3>{r.name}</h3>
                    <span className="os-muted os-small">{res ? [coachOf(res), res.league_name].filter(Boolean).join(' · ') : 'מאזנים לא זמינים'}</span>
                  </div>
                  {res?.pos ? (
                    <span className="os-tcard__pos" aria-label={`מקום ${res.pos} מתוך ${res.league_teams}`}>
                      <strong>{res.pos}</strong>
                      <span>מתוך {res.league_teams}</span>
                    </span>
                  ) : null}
                </div>
                {res && (
                  <>
                    <Form form={res.form} />
                    <div className="os-tcard__nums">
                      <div>
                        <strong>{res.played ? `${res.won}-${res.drawn}-${res.lost}` : '—'}</strong>
                        <span>נ-ת-ה</span>
                      </div>
                      <div>
                        <strong>{res.played ? `${res.goals_for}:${res.goals_against}` : '—'}</strong>
                        <span>שערים</span>
                      </div>
                      <div>
                        <strong className={tr ? `is-${tr}` : ''}>{tr ? TREND_MARK[tr] : '—'}</strong>
                        <span>{tr ? TREND_LABEL[tr] : 'מגמה'}</span>
                      </div>
                    </div>
                  </>
                )}
                <div className="os-tcard__bars">
                  <div className="os-tcard__bar">
                    <span>נוכחות ({days} ימים)</span>
                    <b>{w?.attendance_pct == null ? 'אין סימונים' : `${w.attendance_pct}%`}</b>
                    <Bar value={w?.attendance_pct ?? null} />
                  </div>
                  <div className="os-tcard__bar">
                    <span>אימונים עם מערך</span>
                    <b>{p === null ? '—' : `${p}%`}</b>
                    <Bar value={p} />
                  </div>
                </div>
                {weeks.some((x) => x.attendance_pct !== null) && (
                  <div className="os-tcard__spark">
                    <span className="os-muted os-small">נוכחות, 8 שבועות</span>
                    <Spark values={weeks.map((x) => x.attendance_pct)} label={`נוכחות ${r.name}, 8 שבועות`} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="os-muted os-small">
        תוצאות רק ממה שההתאחדות פרסמה ונטען לאפליקציה{lastResult ? ` (עדכון אחרון ${new Date(lastResult).toLocaleDateString('he-IL')})` : ''}. מגמה: 5 המשחקים האחרונים מול כל העונה.
      </p>
    </section>
  );
}

function CoachBars({ rows, loading }: { rows: CoachRow[]; loading: boolean }) {
  if (loading) return null;
  if (!rows.length) return null;
  const metrics: { key: keyof CoachRow; label: string; max: number; fmt: (v: number) => string }[] = [
    { key: 'ppg', label: 'נקודות למשחק', max: 3, fmt: (v) => v.toFixed(1) },
    { key: 'attendance', label: 'נוכחות', max: 100, fmt: (v) => `${v}%` },
    { key: 'plan', label: 'עם מערך', max: 100, fmt: (v) => `${v}%` },
    { key: 'report', label: 'עם דוח', max: 100, fmt: (v) => `${v}%` },
  ];
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>השוואת מאמנים</h2>
        <SourceTag source="db" />
      </div>
      <div className="os-scroll">
        <div className="os-cmp" role="table" aria-label="השוואת מאמנים">
          <div className="os-cmp__row os-cmp__row--head" role="row">
            <span role="columnheader">מאמן</span>
            {metrics.map((m) => (
              <span key={m.key} role="columnheader">
                {m.label}
              </span>
            ))}
          </div>
          {rows.map((c) => (
            <div key={c.name} className="os-cmp__row" role="row">
              <span role="cell" className="os-cmp__name">
                <strong>{c.name}</strong>
                <span className="os-muted os-small">{c.teams.length > 1 ? `${c.teams.length} קבוצות` : c.teams[0]}</span>
              </span>
              {metrics.map((m) => {
                const v = c[m.key] as number | null;
                const tone = m.key === 'ppg' ? (v === null ? 'none' : v >= 1.8 ? 'good' : v >= 1.2 ? 'ok' : 'low') : undefined;
                return (
                  <span key={m.key} role="cell" className="os-cmp__cell">
                    <Bar value={v} max={m.max} tone={tone} />
                    <b>{v === null ? '—' : m.fmt(v)}</b>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="os-muted os-small">
        ההשוואה מעלה שאלות, היא לא פוסקת מי מאמן טוב. בגילאים צעירים התוצאה תלויה גם בליגה ובסגל, ולכן היא מוצגת לצד מדדי העבודה. מאמן: הרשום באפליקציה, ואם אין, זה שבאתר ההתאחדות.
      </p>
    </section>
  );
}

function TrendChart({ trends }: { trends: Trends | null | undefined }) {
  if (trends === undefined) return null;
  if (trends === null)
    return (
      <section className="os-card">
        <h2>מגמות לאורך זמן</h2>
        <p className="os-muted">החלק הזה עוד לא הופעל במסד הנתונים.</p>
      </section>
    );
  const ws = trends.weeks;
  if (!heldWeeks(ws).length)
    return (
      <section className="os-card">
        <h2>מגמות, 8 שבועות</h2>
        <p className="os-muted">עדיין אין אימונים שהתקיימו ב־8 השבועות האחרונים.</p>
      </section>
    );
  const series = [
    { key: 'attendance_pct' as const, label: 'נוכחות', cls: 'a' },
    { key: 'plan_pct' as const, label: 'אימונים עם מערך', cls: 'p' },
    { key: 'report_pct' as const, label: 'אימונים עם דוח', cls: 'r' },
  ];
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const x = (i: number) => pad.l + (i / Math.max(1, ws.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b);
  const label = (s: string) => {
    const d = new Date(s);
    return `${d.getDate()}.${d.getMonth() + 1}`;
  };
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>מגמות, 8 שבועות</h2>
        <SourceTag source="db" />
      </div>
      <ul className="os-legend">
        {series.map((s) => (
          <li key={s.key} className={`os-legend__${s.cls}`}>
            {s.label}
          </li>
        ))}
      </ul>
      <svg className="os-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="נוכחות, מערכים ודוחות לפי שבוע" style={{ direction: 'ltr' }}>
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="os-chart__grid" />
            <text x={pad.l - 6} y={y(g)} textAnchor="end" dominantBaseline="central" className="os-chart__axis">
              {g}%
            </text>
          </g>
        ))}
        {ws.map((w, i) => (
          <g key={w.start}>
            <rect x={x(i) - 8} y={H - pad.b - Math.min(40, w.held * 3)} width="16" height={Math.min(40, w.held * 3)} className="os-chart__held" />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="os-chart__axis">
              {label(w.start)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = ws.map((w, i) => ({ v: w[s.key] ?? null, i })).filter((p): p is { v: number; i: number } => p.v !== null);
          if (!pts.length) return null;
          const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
          return (
            <g key={s.key} className={`os-chart__s os-chart__s--${s.cls}`}>
              <path d={d} fill="none" strokeWidth="2.5" strokeLinejoin="round" />
              {pts.map((p) => (
                <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5">
                  <title>{`${s.label}, שבוע ${label(ws[p.i].start)}: ${p.v}%`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <p className="os-muted os-small">עמודות אפורות: מספר האימונים שהתקיימו באותו שבוע. שבוע מתחיל ביום ראשון.</p>
    </section>
  );
}

function Transfer({ transfer, drills }: { transfer: TransferPlan | null; drills: Drills | null | undefined }) {
  if (drills === undefined) return null;
  return (
    <section className="os-card">
      <div className="os-card__head">
        <h2>להעביר ידע ממי שמצליח למי שצריך עזרה</h2>
        <SourceTag source="db" />
      </div>
      {drills === null ? (
        <p className="os-muted">החלק הזה עוד לא הופעל במסד הנתונים.</p>
      ) : !transfer ? (
        <p className="os-muted">
          עוד אין מספיק נתונים להשוואה: צריך לפחות שני מאמנים עם תוצאות או מדדי עבודה, ומערכים משויכים לאימונים שהתקיימו ({drills.days} ימים אחרונים).
        </p>
      ) : (
        <div className="os-xfer">
          <div className="os-xfer__side is-from">
            <span className="os-muted os-small">מקור</span>
            <strong>{transfer.from.name}</strong>
            <span className="os-small">{transfer.from.teams.join(', ')}</span>
            <CoachLine c={transfer.from} />
          </div>
          <div className="os-xfer__mid">
            {transfer.drills.length === 0 ? (
              <p className="os-muted">ל{transfer.from.name} אין תרגילים משותפים שעוד לא בשימוש אצל {transfer.to.name}. כדאי לבקש ממנו לשתף תרגילים לספריית המועדון.</p>
            ) : (
              <>
                <span className="os-muted os-small">התרגילים ש{transfer.from.name} משתמש בהם הכי הרבה, ו{transfer.to.name} עוד לא</span>
                {transfer.drills.map((d) => (
                  <a key={d.exercise_id} className="os-xfer__drill" href={`#os/library/${d.exercise_id}`}>
                    <span>
                      <strong>{d.title}</strong>
                      <span className="os-muted os-small">{[d.topics.slice(0, 2).join(' · '), `${d.sessions} אימונים`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span aria-hidden="true">‹</span>
                  </a>
                ))}
              </>
            )}
          </div>
          <div className="os-xfer__side is-to">
            <span className="os-muted os-small">צריך תמיכה</span>
            <strong>{transfer.to.name}</strong>
            <span className="os-small">{transfer.to.teams.join(', ')}</span>
            <CoachLine c={transfer.to} />
          </div>
        </div>
      )}
      <p className="os-muted os-small">
        מבוסס על המערכים ששויכו לאימונים שהתקיימו. מוצגים רק תרגילים מספריית המועדון ומהספרייה של iPlays; תרגילים אישיים של מאמן נשארים שלו ולא מוצגים.
      </p>
    </section>
  );
}

function CoachLine({ c }: { c: CoachRow }) {
  const parts = [c.ppg !== null ? `${c.ppg.toFixed(1)} נק׳ למשחק` : null, c.attendance !== null ? `נוכחות ${c.attendance}%` : null, c.plan !== null ? `${c.plan}% עם מערך` : null].filter(Boolean);
  return <span className="os-muted os-small">{parts.join(' · ') || 'אין עדיין נתונים'}</span>;
}

/* ---------- north vs south (user 2026-11-09: "השוואה בין קבוצות דרום לצפון, לייצר תחרות") ---------- */

interface AreaRow {
  area: string;
  teams: number;
  ppg: number | null;
  /** last-5 points per game minus the season's, averaged over the area's teams */
  formGain: number | null;
  wins: number;
  played: number;
  attendance: number | null;
  plan: number | null;
  report: number | null;
  attDelta: number | null;
}

function areaRows(results: TeamResult[], work: TeamRow[], trends: Trends | null): AreaRow[] {
  const res = new Map(results.map((r) => [r.team_id, r]));
  const tw = new Map((trends?.teams ?? []).map((t) => [t.team_id, t.weeks]));
  const groups = new Map<string, TeamRow[]>();
  for (const w of work) {
    const a = areaOf(w.name);
    if (a) groups.set(a, [...(groups.get(a) ?? []), w]);
  }
  return [...groups.entries()].sort((a, b) => AREAS.indexOf(a[0]) - AREAS.indexOf(b[0])).map(([area, ws]) => {
    const rs = ws.map((w) => res.get(w.team_id)).filter((r): r is TeamResult => !!r);
    const played = rs.reduce((s, r) => s + (r.played ?? 0), 0);
    const held = ws.reduce((s, w) => s + w.held, 0);
    const missing = ws.reduce((s, w) => s + w.missing_reports, 0);
    return {
      area,
      teams: ws.length,
      played,
      wins: rs.reduce((s, r) => s + (r.won ?? 0), 0),
      ppg: played ? rs.reduce((s, r) => s + (r.points ?? 0), 0) / played : null,
      formGain: avg(rs.map((r) => (r.played && r.played >= 4 && r.form ? formPpg(r.form)! - r.points! / r.played : null))),
      attendance: pctOf(ws.reduce((s, w) => s + w.came, 0), ws.reduce((s, w) => s + w.marked_cells, 0)),
      plan: pctOf(ws.reduce((s, w) => s + w.held - w.held_no_plan, 0), held),
      report: pctOf(held - missing, held),
      attDelta: avg(ws.map((w) => delta(tw.get(w.team_id) ?? [], 'attendance_pct'))),
    };
  });
}

/**
 * Head-to-head of the club's areas (team names with צפון / דרום ...).
 * Each metric gives a point to the better area; work metrics count, not only results.
 */
function AreaDuel({ results, work, trends, days }: { results: TeamResult[]; work: TeamRow[]; trends: Trends | null; days: number }) {
  const rows = areaRows(results, work, trends);
  if (rows.length < 2) return null;
  const metrics: { key: keyof AreaRow; label: string; fmt: (v: number) => string; max: number }[] = [
    { key: 'attendance', label: `נוכחות (${days} ימים)`, fmt: (v) => `${v}%`, max: 100 },
    { key: 'plan', label: 'אימונים עם מערך', fmt: (v) => `${v}%`, max: 100 },
    { key: 'report', label: 'אימונים עם דוח', fmt: (v) => `${v}%`, max: 100 },
    { key: 'attDelta', label: 'שיפור בנוכחות', fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`, max: 20 },
    { key: 'formGain', label: 'שיפור בתוצאות (5 אחרונים מול העונה)', fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`, max: 1.5 },
  ];
  const points = new Map(rows.map((r) => [r.area, 0]));
  const leaders = metrics.map((m) => {
    const vals = rows.map((r) => ({ a: r.area, v: r[m.key] as number | null })).filter((x): x is { a: string; v: number } => x.v !== null);
    if (vals.length < 2) return null;
    const best = Math.max(...vals.map((x) => x.v));
    const winners = vals.filter((x) => x.v === best);
    if (winners.length !== 1) return null;
    points.set(winners[0].a, (points.get(winners[0].a) ?? 0) + 1);
    return winners[0].a;
  });
  const order = [...rows].sort((a, b) => (points.get(b.area) ?? 0) - (points.get(a.area) ?? 0));
  const top = order[0];
  const tie = order.length > 1 && points.get(order[0].area) === points.get(order[1].area);
  return (
    <section className="os-card os-duel">
      <div className="os-card__head">
        <h2>{rows.map((r) => r.area).join(' מול ')}</h2>
        <SourceTag source="db" />
      </div>
      <div className="os-duel__score" aria-live="polite">
        {order.map((r, i) => (
          <div key={r.area} className={`os-duel__side${!tie && i === 0 ? ' is-lead' : ''}`}>
            <span className="os-duel__area">{r.area}</span>
            <strong>{points.get(r.area) ?? 0}</strong>
            <span className="os-muted os-small">{r.teams} קבוצות</span>
          </div>
        ))}
      </div>
      <p className="os-duel__verdict">{tie ? 'תיקו כרגע. כל מדד שישתפר השבוע יכריע.' : `${top.area} מוביל השבוע`}</p>
      <div className="os-duel__metrics">
        {metrics.map((m, mi) => (
          <div key={m.key} className="os-duel__metric">
            <span className="os-duel__label">{m.label}</span>
            {rows.map((r) => {
              const v = r[m.key] as number | null;
              const win = leaders[mi] === r.area;
              return (
                <div key={r.area} className={`os-duel__line${win ? ' is-win' : ''}`}>
                  <span>{r.area}</span>
                  <Bar value={v === null ? null : m.key === 'attDelta' || m.key === 'formGain' ? Math.max(0, v) : v} max={m.max} tone={win ? 'good' : 'ok'} />
                  <b>{v === null ? '—' : m.fmt(v)}</b>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="os-muted os-small">
        כל מדד שמועדון מוביל בו שווה נקודה. התחרות מודדת עבודה מקצועית ושיפור, לא מאזן מוחלט, כך שגם המועדון החלש יותר יכול לנצח בכל שבוע. המאזן עצמו מוצג בכרטיסי הקבוצות. האזור נקבע לפי שם הקבוצה (צפון, דרום, מרכז).
      </p>
    </section>
  );
}
