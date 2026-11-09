import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/api';
import { supabase } from '../lib/supabase';
import { ErrorNote, Loading, NoData, SourceTag } from './StateView';

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

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/**
 * Club director dashboard: up to 5 KPIs and up to 3 priority actions, real
 * numbers only (decision 2026-11-06). Alerts can't be hidden.
 */
export function DashboardScreen() {
  const [clubs, setClubs] = useState<{ club_id: string; name: string }[] | null>(null);
  const [club, setClub] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [dash, setDash] = useState<Dash | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // undefined = loading, null = not available (no permission or the database part is not installed yet)
  const [results, setResults] = useState<TeamResult[] | null | undefined>(undefined);

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
  useEffect(() => {
    if (!club) return;
    setResults(undefined);
    db()
      .rpc('club_team_results', { p_club: club })
      .then(({ data, error }) => setResults(error || !data ? null : ((data as { teams: TeamResult[] }).teams ?? [])));
  }, [club]);

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
  const t = dash.totals;

  const actions: { level: 'critical' | 'warn'; text: string; href: string }[] = [];
  const byMissing = [...dash.teams].filter((x) => x.missing_reports > 0).sort((a, b) => b.missing_reports - a.missing_reports);
  if (byMissing.length) actions.push({ level: 'warn', text: `${t.missing_reports} אימונים שהתקיימו בלי דוח. הכי הרבה: ${byMissing[0].name} (${byMissing[0].missing_reports})`, href: '#os/day' });
  const noMarks = dash.teams.filter((x) => x.held > x.held_marked);
  if (noMarks.length) actions.push({ level: 'critical', text: `נוכחות לא סומנה ב-${noMarks.reduce((s, x) => s + x.held - x.held_marked, 0)} אימונים (${noMarks.map((x) => x.name).join(', ')})`, href: '#os/calendar' });
  const noPlan = dash.teams.filter((x) => x.upcoming_no_plan > 0).sort((a, b) => b.upcoming_no_plan - a.upcoming_no_plan);
  if (noPlan.length) actions.push({ level: 'warn', text: `${t.upcoming_no_plan} אימונים בשבוע הקרוב בלי מערך. הכי הרבה: ${noPlan[0].name} (${noPlan[0].upcoming_no_plan})`, href: '#os/plans' });
  actions.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));

  return (
    <div className="os-stack">
      <section className="os-card">
        <div className="os-row">
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
            <h2>{clubs[0].name}</h2>
          )}
          <div className="os-seg" role="group" aria-label="תקופה">
            {[7, 30].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} className={days === d ? 'is-on is-present' : ''} onClick={() => setDays(d)}>
                {d} ימים
              </button>
            ))}
          </div>
        </div>
        <div className="os-kpis">
          <Kpi value={t.held} label={`אימונים שהתקיימו (${dash.days} ימים)`} />
          <Kpi value={t.attendance_pct === null ? null : `${t.attendance_pct}%`} label={t.attendance_pct === null ? 'נוכחות: אין סימונים' : `נוכחות (${t.marked_cells} סימוני צוות)`} />
          <Kpi value={t.missing_reports} label="דוחות חסרים" warn={t.missing_reports > 0} />
          <Kpi value={t.upcoming_no_plan} label={`אימונים קרובים בלי מערך (מתוך ${t.upcoming})`} warn={t.upcoming_no_plan > 0} />
          <Kpi value={t.new_club_exercises} label="תרגילים חדשים בספריית המועדון" />
        </div>
        <p className="os-muted os-small">
          <SourceTag source="db" /> נוכחות מחושבת רק מסימוני צוות; אימון בלי סימון לא נספר כ-100%. אימונים אישיים לא נכללים.
        </p>
      </section>

      <section className="os-card">
        <h2>פעולות בעדיפות</h2>
        {actions.length === 0 ? (
          <p className="os-muted">אין פעולות פתוחות לתקופה הזאת.</p>
        ) : (
          <ul className="os-actions">
            {actions.slice(0, 3).map((x, i) => (
              <li key={i} className={`is-${x.level}`}>
                <span>{x.text}</span>
                <a className="os-back" href={x.href}>
                  לטיפול
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ResultsCards results={results} work={dash.teams} days={dash.days} />

      <section className="os-card">
        <div className="os-card__head">
          <h2>לפי קבוצה</h2>
          <SourceTag source="db" />
        </div>
        <table className="os-table">
          <thead>
            <tr>
              <th>קבוצה</th>
              <th>התקיימו</th>
              <th>נוכחות</th>
              <th>דוחות חסרים · בלי מערך (קרובים)</th>
            </tr>
          </thead>
          <tbody>
            {dash.teams.map((x) => (
              <tr key={x.team_id}>
                <td>{x.name}</td>
                <td>{x.held}</td>
                <td>{x.attendance_pct === null ? 'אין סימונים' : `${x.attendance_pct}%`}</td>
                <td>
                  {x.missing_reports} · {x.upcoming_no_plan}/{x.upcoming}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dash.teams.length === 0 && (
          <p className="os-muted">
            עדיין אין קבוצות משויכות למועדון.{' '}
            <a className="os-back" href="#club/search">
              חיפוש ושיוך קבוצות
            </a>
          </p>
        )}
        <p className="os-muted os-small">עודכן {new Date(dash.generated_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</p>
      </section>
    </div>
  );
}

function Kpi({ value, label, warn }: { value: number | string | null; label: string; warn?: boolean }) {
  return (
    <div className={`os-kpi${warn ? ' os-kpi--warn' : ''}`}>
      <strong>{value === null ? '—' : value}</strong>
      <span>{label}</span>
    </div>
  );
}

const FORM_HE: Record<string, string> = { W: 'נ', D: 'ת', L: 'ה' };
const FORM_PTS: Record<string, number> = { W: 3, D: 1, L: 0 };

function ppg(points: number | null, played: number | null): number | null {
  return played ? points! / played : null;
}
function formPpg(form: string): number | null {
  return form ? [...form].reduce((s, c) => s + (FORM_PTS[c] ?? 0), 0) / form.length : null;
}
/** Last-5 points per game against the season's: up / down / steady. */
function trend(r: TeamResult): { mark: string; label: string } | null {
  const season = ppg(r.points, r.played);
  const recent = formPpg(r.form);
  if (season === null || recent === null || (r.played ?? 0) < 4) return null;
  if (recent - season >= 0.4) return { mark: '↑', label: 'במגמת עלייה' };
  if (season - recent >= 0.4) return { mark: '↓', label: 'במגמת ירידה' };
  return { mark: '→', label: 'יציב' };
}
const fmt = (n: number | null, digits = 1) => (n === null ? '—' : n.toFixed(digits));
function coachOf(r: TeamResult): string {
  return r.app_coaches[0] || r.ifa_coach || 'ללא מאמן';
}

function Form({ form }: { form: string }) {
  if (!form) return <span className="os-muted">—</span>;
  return (
    <span className="os-wdl" aria-label="5 משחקים אחרונים, מהאחרון">
      {[...form].map((c, i) => (
        <span key={i} className={`os-wdl__${c}`}>
          {FORM_HE[c] ?? c}
        </span>
      ))}
    </span>
  );
}

/** Results per team (IFA) next to the coach's work numbers, and a coach comparison. */
function ResultsCards({ results, work, days }: { results: TeamResult[] | null | undefined; work: TeamRow[]; days: number }) {
  if (results === undefined) return <Loading />;
  if (results === null)
    return (
      <section className="os-card">
        <h2>מאזנים והשוואת מאמנים</h2>
        <p className="os-muted">החלק הזה עוד לא הופעל במסד הנתונים.</p>
      </section>
    );
  const byTeam = new Map(work.map((w) => [w.team_id, w]));
  const planPct = (w: TeamRow | undefined) => (w && w.held > 0 ? Math.round((100 * (w.held - w.held_no_plan)) / w.held) : null);
  const lastResult = results.map((r) => r.last_result_at).filter(Boolean).sort().pop();

  const coaches = new Map<string, TeamResult[]>();
  for (const r of results) coaches.set(coachOf(r), [...(coaches.get(coachOf(r)) ?? []), r]);
  const coachRows = [...coaches.entries()].map(([name, teams]) => {
    const played = teams.reduce((s, r) => s + (r.played ?? 0), 0);
    const points = teams.reduce((s, r) => s + (r.points ?? 0), 0);
    const forms = teams.map((r) => r.form).join('');
    const ws = teams.map((r) => byTeam.get(r.team_id)).filter((w): w is TeamRow => !!w);
    const cells = ws.reduce((s, w) => s + w.marked_cells, 0);
    const held = ws.reduce((s, w) => s + w.held, 0);
    return {
      name,
      teams: teams.length,
      ppg: played ? points / played : null,
      recent: formPpg(forms),
      attendance: cells ? Math.round((100 * ws.reduce((s, w) => s + w.came, 0)) / cells) : null,
      plan: held ? Math.round((100 * ws.reduce((s, w) => s + w.held - w.held_no_plan, 0)) / held) : null,
      missing: ws.reduce((s, w) => s + w.missing_reports, 0),
    };
  });
  coachRows.sort((a, b) => (b.ppg ?? -1) - (a.ppg ?? -1));

  return (
    <>
      <section className="os-card">
        <div className="os-card__head">
          <h2>מאזנים לפי קבוצה</h2>
          <SourceTag source="db" />
        </div>
        {results.length === 0 ? (
          <p className="os-muted">אין קבוצות משויכות למועדון.</p>
        ) : (
          <div className="os-scroll">
            <table className="os-wtable">
              <thead>
                <tr>
                  <th>קבוצה</th>
                  <th>מקום</th>
                  <th>נ-ת-ה</th>
                  <th>שערים</th>
                  <th>5 אחרונים</th>
                  <th>מגמה</th>
                  <th>נוכחות ({days} ימים)</th>
                  <th>אימונים עם מערך</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const w = byTeam.get(r.team_id);
                  const tr = trend(r);
                  const p = planPct(w);
                  return (
                    <tr key={r.team_id}>
                      <td>
                        <strong>{r.name}</strong>
                        <div className="os-muted os-small">{[r.league_name, coachOf(r)].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{r.pos ? `${r.pos} מתוך ${r.league_teams}` : r.linked ? 'אין תוצאות' : 'לא מקושרת לליגה'}</td>
                      <td>{r.played ? `${r.won}-${r.drawn}-${r.lost}` : '—'}</td>
                      <td>{r.played ? `${r.goals_for}:${r.goals_against}` : '—'}</td>
                      <td>
                        <Form form={r.form} />
                      </td>
                      <td title={tr?.label}>{tr ? `${tr.mark} ${tr.label}` : '—'}</td>
                      <td>{w?.attendance_pct == null ? 'אין סימונים' : `${w.attendance_pct}%`}</td>
                      <td>{p === null ? '—' : `${p}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="os-muted os-small">
          <SourceTag source="db" /> תוצאות רק ממה שההתאחדות פרסמה ונטען לאפליקציה{lastResult ? ` (עדכון אחרון ${new Date(lastResult).toLocaleDateString('he-IL')})` : ''}. ניצחון 3, תיקו 1. מגמה: 5 המשחקים האחרונים מול כל העונה.
        </p>
      </section>

      <section className="os-card">
        <div className="os-card__head">
          <h2>השוואת מאמנים</h2>
          <SourceTag source="db" />
        </div>
        <div className="os-scroll">
          <table className="os-wtable">
            <thead>
              <tr>
                <th>מאמן</th>
                <th>קבוצות</th>
                <th>נק׳ למשחק (עונה)</th>
                <th>נק׳ למשחק (5 אחרונים)</th>
                <th>נוכחות</th>
                <th>אימונים עם מערך</th>
                <th>דוחות חסרים</th>
              </tr>
            </thead>
            <tbody>
              {coachRows.map((c) => (
                <tr key={c.name}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>{c.teams}</td>
                  <td>{fmt(c.ppg)}</td>
                  <td>{fmt(c.recent)}</td>
                  <td>{c.attendance === null ? '—' : `${c.attendance}%`}</td>
                  <td>{c.plan === null ? '—' : `${c.plan}%`}</td>
                  <td>{c.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="os-muted os-small">
          בגילאים צעירים התוצאה היא רק חלק מהתמונה. כדאי להסתכל עליה יחד עם מדדי העבודה: נוכחות, אימונים עם מערך ודוחות. מאמן: הרשום באפליקציה, ואם אין, זה שמופיע באתר ההתאחדות.
        </p>
      </section>
    </>
  );
}
