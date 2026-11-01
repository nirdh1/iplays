/**
 * Club overview dashboard, per program (league / academy): upcoming matches,
 * recent results and this week's attendance per team. Reads the same tables
 * the teams use; RLS shows a club admin every team in the club.
 */
import { useEffect, useState } from 'react';
import { Card, EmptyState, SectionHeader, Segmented, StatTile, Tag } from '../components/ui';
import { friendlyError } from '../lib/api';
import { addDays, todayYmd } from '../lib/coachApi';
import { programKindLabel, type ClubTeam, type Program } from '../lib/clubApi';
import {
  attendanceSummary,
  changeFieldLabel,
  competitionLabel,
  getClubMatches,
  getGameHistory,
  matchEndsAt,
  matchTimeLabel,
  matchVenueLabel,
  type GameUpdate,
  type Match,
} from '../lib/matchApi';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

interface TeamWeek {
  teamId: string;
  events: number;
  rate: number | null;
}

export function ClubDashboard({ clubId, programs, teams }: { clubId: string; programs: Program[]; teams: ClubTeam[] }) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [week, setWeek] = useState<TeamWeek[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GameUpdate[] | null>(null);

  useEffect(() => {
    // older databases have no IFA history yet: just hide the section
    getGameHistory({ clubId, limit: 30 }).then(setHistory, () => setHistory([]));
  }, [clubId]);

  const active = teams.filter((t) => !t.archived_at);
  const teamName = (id: string) => active.find((t) => t.id === id)?.name ?? '';
  const inProgram = active.filter((t) => t.program_id === programId);
  const ids = inProgram.map((t) => t.id).join(',');

  useEffect(() => {
    const teamIds = ids ? ids.split(',') : [];
    setMatches(null);
    setWeek(null);
    setError(null);
    if (teamIds.length === 0) {
      setMatches([]);
      setWeek([]);
      return;
    }
    const today = todayYmd();
    getClubMatches(teamIds, addDays(today, -14), addDays(today, 15))
      .then(setMatches)
      .catch((e) => setError(friendlyError(e)));
    Promise.all(
      teamIds.map(async (teamId) => {
        const rows = await attendanceSummary(teamId, addDays(today, -7), today);
        const events = Math.max(0, ...rows.map((r) => r.events));
        const rated = rows.filter((r) => r.rate !== null);
        const rate = rated.length ? Math.round(rated.reduce((s, r) => s + (r.rate ?? 0), 0) / rated.length) : null;
        return { teamId, events, rate };
      }),
    )
      .then(setWeek)
      .catch((e) => setError(friendlyError(e)));
  }, [ids]);

  const now = Date.now();
  const upcoming = (matches ?? []).filter((m) => m.status === 'scheduled' && (m.time_confirmed === false ? matchEndsAt(m) : new Date(m.starts_at).getTime()) >= now);
  const results = (matches ?? []).filter((m) => m.status === 'played').reverse();
  const wins = results.filter((m) => (m.score_for ?? 0) > (m.score_against ?? 0)).length;
  const rated = (week ?? []).filter((w) => w.rate !== null);
  const avgRate = rated.length ? Math.round(rated.reduce((s, w) => s + (w.rate ?? 0), 0) / rated.length) : null;

  return (
    <section className="ip-stack">
      {programs.length > 1 && (
        <Segmented label="מסגרת" value={programId} onChange={setProgramId} items={programs.map((p) => ({ id: p.id, label: p.name || programKindLabel[p.kind] }))} />
      )}
      {error && <p className="ip-error" role="alert">{error}</p>}
      <div className="ip-stats ip-club-stats">
        <StatTile value={upcoming.length} label="משחקים בשבועיים הקרובים" accent />
        <StatTile value={results.length ? `${wins}/${results.length}` : '–'} label="ניצחונות בשבועיים האחרונים" />
        <StatTile value={avgRate === null ? '–' : `${avgRate}%`} label="נוכחות השבוע" />
      </div>

      <SectionHeader title="משחקים קרובים" icon="calendar" />
      {matches === null ? (
        <p className="ip-muted">טוען…</p>
      ) : upcoming.length === 0 ? (
        <EmptyState icon="calendar" title="אין משחקים קרובים" text="משחקים שהמאמנים מוסיפים יופיעו כאן." />
      ) : (
        <Card padded={false}>
          {upcoming.slice(0, 8).map((m) => (
            <a key={m.id} className="ip-club-row ip-dash-match" href={`#matches/${m.team_id}`}>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">
                  {teamName(m.team_id)} נגד {m.opponent}
                </span>
                <span className="ip-list-row-sub">
                  {[`${fmtDate(m.starts_at)} ${matchTimeLabel(m)}`, m.home ? 'בית' : 'חוץ', m.source === 'ifa' ? 'ליגה · התאחדות' : competitionLabel[m.competition], matchVenueLabel(m)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </a>
          ))}
        </Card>
      )}

      <SectionHeader title="תוצאות אחרונות" icon="trophy" />
      {matches !== null && results.length === 0 ? (
        <p className="ip-muted">אין תוצאות בשבועיים האחרונים.</p>
      ) : (
        <Card padded={false}>
          {results.slice(0, 8).map((m) => {
            const f = m.score_for ?? 0;
            const a = m.score_against ?? 0;
            return (
              <a key={m.id} className="ip-club-row ip-dash-match" href={`#matches/${m.team_id}`}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {teamName(m.team_id)} נגד {m.opponent}
                  </span>
                  <span className="ip-list-row-sub">{fmtDate(m.starts_at)}</span>
                </span>
                <Tag tone={f > a ? 'lime' : f < a ? 'live' : 'neutral'}>
                  {f}–{a}
                </Tag>
              </a>
            );
          })}
        </Card>
      )}

      {history && history.length > 0 && (
        <>
          <SectionHeader title="עדכוני משחקים מההתאחדות" icon="bell" />
          <Card padded={false}>
            {history.map((u) => (
              <div key={`${u.update_id}-${u.team_id}`} className="ip-club-row">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {u.team_name}: {u.home_name} – {u.away_name}
                  </span>
                  <ul className="ip-change-list">
                    {u.changes.map((c) => (
                      <li key={c.field}>
                        {changeFieldLabel[c.field] ?? c.field}: {c.old ? <del>{c.old}</del> : 'אין'} ← {c.new || 'אין'}
                      </li>
                    ))}
                  </ul>
                  <span className="ip-list-row-sub">
                    זוהה {fmtWhen(u.detected_at)}
                    {u.notify ? ` · נשלחה התראה ל־${u.sent}/${u.queued}` : ' · ללא התראה'}
                  </span>
                </span>
                {u.significant && <Tag tone="warning">מהותי</Tag>}
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionHeader title="נוכחות השבוע לפי קבוצה" icon="check" />
      {week === null ? (
        <p className="ip-muted">טוען…</p>
      ) : week.length === 0 ? (
        <p className="ip-muted">אין קבוצות במסגרת הזו.</p>
      ) : (
        <Card padded={false}>
          {[...week]
            .sort((x, y) => (x.rate ?? 101) - (y.rate ?? 101))
            .map((w) => (
              <div key={w.teamId} className="ip-club-row">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{teamName(w.teamId)}</span>
                  <span className="ip-list-row-sub">{w.events ? `${w.events} אירועים בשבוע האחרון` : 'לא היו אימונים או משחקים'}</span>
                </span>
                {w.rate !== null && <Tag tone={w.rate >= 85 ? 'lime' : w.rate >= 70 ? 'warning' : 'live'}>{w.rate}%</Tag>}
              </div>
            ))}
        </Card>
      )}
    </section>
  );
}
