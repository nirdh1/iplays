/**
 * League table from real IFA results. Two forms:
 *  - LeagueHomeCard: on the home screen, the child's league, the team's place
 *    and the rows around it; "כל הטבלה" opens the full table in place.
 *  - LeagueTableSection: the full table on the team page.
 * Nothing shows for a team that is not linked to an IFA league, and a league
 * with no official result yet says so instead of showing a table of zeros.
 *
 * A table saved from a screenshot (ScreenshotUpdates.tsx) is shown beside the
 * computed one, always marked "מצילום מסך" with its date, and the rows where
 * it differs from the computed table are flagged. It never changes the
 * computed table. With no computed table, the screenshot table shows alone.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { friendlyError } from '../lib/api';
import { getTeamLeagueTable, ifaTeamGamesUrl, ourRow, type LeagueRow, type LeagueTable } from '../lib/leagueApi';
import { compareSnapshot, deleteLeagueSnapshot, getLeagueSnapshot, nameSimilarity, type LeagueSnapshot } from '../lib/screenshotTables';
import { LeagueSnapshotSheet } from './ScreenshotUpdates';
import { IfaUpdateIcon } from '../components/IfaSteps';

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

export function useLeagueSnapshot(teamId: string): [LeagueSnapshot | null | undefined, () => void] {
  const [s, setS] = useState<LeagueSnapshot | null | undefined>(undefined);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    getLeagueSnapshot(teamId)
      .then((x) => alive && setS(x))
      .catch(() => alive && setS(null));
    return () => {
      alive = false;
    };
  }, [teamId, n]);
  return [s, useCallback(() => setN((x) => x + 1), [])];
}

const shortDate = (d: string) => new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });

/** Snapshot rows with "is us" and "differs from the computed table". */
function snapRows(snap: LeagueSnapshot, computed: LeagueTable | null | undefined, ourName?: string) {
  const diff = compareSnapshot(snap.rows, computed?.has_results ? computed.rows : undefined);
  const usName = (computed && ourRow(computed)?.name) || ourName || '';
  let usIdx = diff.match.findIndex((m) => m?.is_us);
  if (usIdx < 0 && usName) {
    let best = 0.8;
    snap.rows.forEach((r, i) => {
      const sc = nameSimilarity(r.name, usName);
      if (sc > best) {
        best = sc;
        usIdx = i;
      }
    });
  }
  return { rows: snap.rows.map((r, i) => ({ r, us: i === usIdx, differs: diff.differs[i], c: diff.match[i] })), count: diff.count };
}

type SnapView = ReturnType<typeof snapRows>['rows'];

function SnapTable({ rows, full }: { rows: SnapView; full: boolean }) {
  const dash = (v: number | null) => (v == null ? '–' : v);
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
        {rows.map(({ r, us, differs, c }, i) => {
          const gd = r.goals_for != null && r.goals_against != null ? r.goals_for - r.goals_against : null;
          return (
            <tr key={`${i}-${r.name}`} className={[us ? 'is-us' : '', differs ? 'is-differs' : ''].filter(Boolean).join(' ')}>
              <td>{r.pos}</td>
              <td>
                {r.name}
                {differs && c && (
                  <span className="ip-snap-diff" title="שונה מהטבלה שמחושבת מתוצאות ההתאחדות">
                    {' '}⚠ בתוצאות: {c.played} מש׳, {c.points} נק׳
                  </span>
                )}
              </td>
              <td>{dash(r.played)}</td>
              {full && <td>{r.won != null && r.drawn != null && r.lost != null ? `${r.won}-${r.drawn}-${r.lost}` : '–'}</td>}
              <td dir="ltr">{gd == null ? '–' : gd > 0 ? `+${gd}` : gd}</td>
              <td>
                <strong>{dash(r.points)}</strong>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function snapLabel(s: LeagueSnapshot): string {
  const who = s.same_team ? (s.uploaded_by_name ? `העלה/תה ${s.uploaded_by_name}` : '') : s.from_team_name ? `הועלה בקבוצה ${s.from_team_name}` : '';
  return ['מצילום מסך', `צולם ${shortDate(s.taken_on)}`, who].filter(Boolean).join(' · ');
}

function aroundSnap(rows: SnapView): SnapView {
  const i = rows.findIndex((x) => x.us);
  if (rows.length <= 5 || i < 0) return rows.slice(0, 5);
  const start = Math.max(0, Math.min(i - 2, rows.length - 5));
  return rows.slice(start, start + 5);
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

export function LeagueHomeCard({ teamId, teamName, ourName }: { teamId: string; teamName?: string; ourName?: string }) {
  const t = useLeagueTable(teamId);
  const [snap] = useLeagueSnapshot(teamId);
  const [open, setOpen] = useState(false);
  if (t === undefined || snap === undefined) return null;
  // no table from results: a screenshot table, when there is one, marked as such
  if (!t?.has_results && snap) {
    const v = snapRows(snap, t, ourName);
    const us = v.rows.find((x) => x.us);
    return (
      <section>
        <SectionHeader
          title={snap.league_name || t?.league_name || 'טבלת הליגה'}
          icon="trophy"
          action={v.rows.length > 5 ? (open ? 'פחות' : 'כל הטבלה') : undefined}
          onAction={() => setOpen((o) => !o)}
        />
        <Card padded={false}>
          {us && (
            <div className="ip-league-us">
              <strong className="ip-league-pos">{us.r.pos}</strong>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">
                  מקום {us.r.pos} מתוך {v.rows.length}
                  {teamName ? ` · ${teamName}` : ''}
                </span>
                <span className="ip-list-row-sub">{us.r.points ?? '–'} נק׳ · לפי צילום מסך</span>
              </span>
            </div>
          )}
          <SnapTable rows={open ? v.rows : aroundSnap(v.rows)} full={false} />
          <p className="ip-muted ip-league-note">
            <Tag tone="warning">מצילום מסך</Tag> {snapLabel(snap).replace(/^מצילום מסך · /, '')}. לא מחושב מתוצאות ההתאחדות.
          </p>
        </Card>
      </section>
    );
  }
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

export function LeagueTableSection({ teamId, ourName, allowUpload = false }: { teamId: string; ourName?: string; allowUpload?: boolean }) {
  const t = useLeagueTable(teamId);
  const [snap, reloadSnap] = useLeagueSnapshot(teamId);
  const [view, setView] = useState<'results' | 'snap'>('results');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (t === undefined || snap === undefined) return null;
  if (!t && !snap && !allowUpload) return null;

  const hasComputed = !!t?.has_results;
  const showSnap = !!snap && (!hasComputed || view === 'snap');
  const v = snap ? snapRows(snap, t, ourName) : null;
  const title = snap?.league_name || t?.league_name;

  async function removeSnap() {
    if (!snap || !window.confirm('להסיר את הטבלה מצילום המסך? הטבלה מהתוצאות לא משתנה.')) return;
    try {
      await deleteLeagueSnapshot(snap.id);
      setView('results');
      reloadSnap();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  return (
    <section>
      <SectionHeader
        title={title ? `טבלה · ${title}` : 'טבלת הליגה'}
        icon="trophy"
        extra={allowUpload ? <IfaUpdateIcon label="עדכון הטבלה מההתאחדות" onClick={() => setUploading(true)} /> : undefined}
      />
      {hasComputed && snap && (
        <Segmented<'results' | 'snap'>
          label="מקור הטבלה"
          items={[
            { id: 'results', label: 'מתוצאות ההתאחדות' },
            { id: 'snap', label: `מצילום מסך ${shortDate(snap.taken_on)}` },
          ]}
          value={view}
          onChange={setView}
        />
      )}
      <Card padded={false}>
        {showSnap && snap && v ? (
          <>
            <SnapTable rows={v.rows} full />
            <p className="ip-muted ip-league-note">
              <Tag tone="warning">מצילום מסך</Tag> {snapLabel(snap).replace(/^מצילום מסך · /, '')}. נקרא מתמונה וייתכנו טעויות; לא משנה את הטבלה שמחושבת מתוצאות ההתאחדות.
              {hasComputed &&
                (v.count > 0
                  ? ` ${v.count} קבוצות שונות מהטבלה המחושבת (מסומנות ⚠): אולי חסרות אצלנו תוצאות, או שההתאחדות הורידה נקודות.`
                  : ' תואמת לטבלה המחושבת.')}
            </p>
          </>
        ) : !t ? (
          <p className="ip-muted ip-league-empty">הקבוצה לא מקושרת לליגה של ההתאחדות, אז אין טבלה מחושבת. אפשר להעלות צילום מסך של טבלת הליגה.</p>
        ) : !t.has_results ? (
          <p className="ip-muted ip-league-empty">אין עדיין תוצאות רשמיות בליגה, אז אין טבלה.{allowUpload ? ' אפשר להעלות צילום מסך של הטבלה.' : ''}</p>
        ) : (
          <>
            <Table rows={t.rows} full />
            <p className="ip-muted ip-league-note">
              {updatedLabel(t)}. ניצחון 3, תיקו 1. לפי תוצאות ההתאחדות בלבד; דיווח גולים באפליקציה לא משנה את הטבלה.
            </p>
          </>
        )}
      </Card>
      {error && <p className="ip-error" role="alert">{error}</p>}
      {showSnap && snap?.can_delete && (
        <div className="ip-btn-row">
          <Button variant="ghost" size="sm" icon="close" onClick={() => void removeSnap()}>
            הסרת הטבלה מצילום
          </Button>
        </div>
      )}
      {!showSnap && t?.has_results && ourRow(t) && (
        <div className="ip-btn-row">
          <Tag tone="lime">מקום {ourRow(t)!.pos}</Tag>
          <Form form={ourRow(t)!.form} />
        </div>
      )}
      {allowUpload && (
        <LeagueSnapshotSheet
          open={uploading}
          teamId={teamId}
          computed={t?.has_results ? t.rows : undefined}
          onClose={() => setUploading(false)}
          onSaved={() => {
            reloadSnap();
            setView('snap');
          }}
        />
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
