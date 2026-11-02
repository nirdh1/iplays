/**
 * League table from real IFA results. Two forms:
 *  - LeagueHomeCard: on the home screen, the child's league, the team's place
 *    and the rows around it; "כל הטבלה" opens the full table in place.
 *  - LeagueTableSection: the full table on the team page.
 * Nothing shows for a team that is not linked to an IFA league, and a league
 * with no official result yet says so instead of showing a table of zeros.
 */
import { useEffect, useState } from 'react';
import { Card, SectionHeader, Tag } from '../components/ui';
import { getTeamLeagueTable, ifaTeamGamesUrl, ourRow, type LeagueRow, type LeagueTable } from '../lib/leagueApi';

const formLabel: Record<string, string> = { W: 'נ', D: 'ת', L: 'ה' };

export function useLeagueTable(teamId: string): LeagueTable | null | undefined {
  const [t, setT] = useState<LeagueTable | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setT(undefined);
    getTeamLeagueTable(teamId)
      .then((x) => alive && setT(x))
      .catch(() => alive && setT(null));
    return () => {
      alive = false;
    };
  }, [teamId]);
  return t;
}

function updatedLabel(t: LeagueTable): string {
  const parts = [`${t.games_counted} משחקים עם תוצאה רשמית`];
  if (t.games_awaiting_result > 0) parts.push(`${t.games_awaiting_result} ממתינים לתוצאה`);
  if (t.last_result_at) parts.push(`עודכן ${new Date(t.last_result_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`);
  return parts.join(' · ');
}

function Form({ form }: { form: string }) {
  if (!form) return null;
  return (
    <span className="ip-league-form" aria-label="משחקים אחרונים">
      {form.split('').map((r, i) => (
        <span key={i} className={`ip-league-form-dot is-${r}`}>
          {formLabel[r]}
        </span>
      ))}
    </span>
  );
}

function Table({ rows, full }: { rows: LeagueRow[]; full: boolean }) {
  return (
    <table className="ip-table ip-table--league">
      <thead>
        <tr>
          <th>#</th>
          <th>קבוצה</th>
          <th>מש׳</th>
          {full && <th>נ-ת-ה</th>}
          <th>הפרש</th>
          <th>נק׳</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ifa_team_id} className={r.is_us ? 'is-us' : ''}>
            <td>{r.pos}</td>
            <td>{r.name}</td>
            <td>{r.played}</td>
            {full && <td>{`${r.won}-${r.drawn}-${r.lost}`}</td>}
            <td dir="ltr">{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
            <td>
              <strong>{r.points}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Up to five rows around our team (or the top five). */
function around(rows: LeagueRow[]): LeagueRow[] {
  const i = rows.findIndex((r) => r.is_us);
  if (rows.length <= 5 || i < 0) return rows.slice(0, 5);
  const start = Math.max(0, Math.min(i - 2, rows.length - 5));
  return rows.slice(start, start + 5);
}

export function LeagueHomeCard({ teamId, teamName }: { teamId: string; teamName?: string }) {
  const t = useLeagueTable(teamId);
  const [open, setOpen] = useState(false);
  if (!t) return null;
  const us = ourRow(t);
  const title = t.league_name || 'טבלת הליגה';
  return (
    <section>
      <SectionHeader title={title} icon="trophy" action={t.has_results && t.rows.length > 5 ? (open ? 'פחות' : 'כל הטבלה') : undefined} onAction={() => setOpen((o) => !o)} />
      <Card padded={false}>
        {!t.has_results ? (
          <p className="ip-muted ip-league-empty">אין עדיין תוצאות רשמיות בליגה{teamName ? ` של ${teamName}` : ''}, אז אין טבלה.</p>
        ) : (
          <>
            {us && (
              <div className="ip-league-us">
                <strong className="ip-league-pos">{us.pos}</strong>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    מקום {us.pos} מתוך {t.rows.length}
                    {teamName ? ` · ${teamName}` : ''}
                  </span>
                  <span className="ip-list-row-sub">
                    {us.points} נק׳ · {us.won} נ׳ {us.drawn} ת׳ {us.lost} ה׳
                  </span>
                </span>
                <Form form={us.form} />
              </div>
            )}
            <Table rows={open ? t.rows : around(t.rows)} full={false} />
            <p className="ip-muted ip-league-note">{updatedLabel(t)}</p>
          </>
        )}
      </Card>
    </section>
  );
}

export function LeagueTableSection({ teamId }: { teamId: string }) {
  const t = useLeagueTable(teamId);
  if (!t) return null;
  return (
    <section>
      <SectionHeader title={t.league_name ? `טבלה · ${t.league_name}` : 'טבלת הליגה'} icon="trophy" />
      <Card padded={false}>
        {!t.has_results ? (
          <p className="ip-muted ip-league-empty">אין עדיין תוצאות רשמיות בליגה, אז אין טבלה.</p>
        ) : (
          <>
            <Table rows={t.rows} full />
            <p className="ip-muted ip-league-note">
              {updatedLabel(t)}. ניצחון 3, תיקו 1. לפי תוצאות ההתאחדות בלבד; דיווח גולים באפליקציה לא משנה את הטבלה.
            </p>
          </>
        )}
      </Card>
      {t.has_results && ourRow(t) && (
        <div className="ip-btn-row">
          <Tag tone="lime">מקום {ourRow(t)!.pos}</Tag>
          <Form form={ourRow(t)!.form} />
        </div>
      )}
    </section>
  );
}

/**
 * A link to the team's games page on the IFA site, for teams linked to an IFA
 * team. The IFA site is the source for game times and venues; the app does not
 * copy rounds from it every week. Nothing shows for a team with no IFA link.
 */
export function IfaTeamGamesLink({ teamId, className }: { teamId: string; className?: string }) {
  const t = useLeagueTable(teamId);
  if (!t?.our_ifa_team_id) return null;
  return (
    <a className={className ?? 'ip-ifa-link'} href={ifaTeamGamesUrl(t.our_ifa_team_id, t.ifa_season_id)} target="_blank" rel="noopener noreferrer">
      לוח המשחקים באתר ההתאחדות ↗
    </a>
  );
}
