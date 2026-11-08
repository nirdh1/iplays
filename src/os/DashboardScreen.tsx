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
