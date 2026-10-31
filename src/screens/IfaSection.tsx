/**
 * Football Association data on the team screen: link the team to its IFA
 * team (filter by season, age group, district, league), then show fixtures,
 * results, standings and import the published roster.
 * Data comes from the server sync job; iplays is not on behalf of the IFA.
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import {
  friendlyError,
  getIfaLeagues,
  getIfaMatches,
  getIfaRosterCount,
  getIfaStandings,
  getIfaTeam,
  getIfaTeams,
  importIfaRoster,
  linkIfaTeam,
  type IfaLeague,
  type IfaMatch,
  type IfaStanding,
  type IfaTeam,
  type MyTeam,
} from '../lib/api';

const AGE_ORDER = ['טרום', 'ילדים', 'נערים', 'נוער', 'בוגרים'];

export function IfaSection({ team, staff, onChanged }: { team: MyTeam; staff: boolean; onChanged: () => Promise<void> }) {
  const [sheet, setSheet] = useState(false);
  const [ifaTeam, setIfaTeam] = useState<IfaTeam | null>(null);
  const [matches, setMatches] = useState<IfaMatch[] | null>(null);
  const [table, setTable] = useState<IfaStanding[]>([]);
  const [rosterCount, setRosterCount] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setIfaTeam(null);
    setMatches(null);
    setTable([]);
    if (!team.ifa_team_id) return;
    (async () => {
      try {
        const t = await getIfaTeam(team.ifa_team_id!);
        const [m, s, c] = await Promise.all([
          getIfaMatches(team.ifa_team_id!),
          t?.league_id ? getIfaStandings(t.league_id) : Promise.resolve([]),
          getIfaRosterCount(team.ifa_team_id!),
        ]);
        if (!alive) return;
        setIfaTeam(t);
        setMatches(m);
        setTable(s);
        setRosterCount(c);
      } catch (e) {
        if (alive) setError(friendlyError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [team.ifa_team_id]);

  if (!team.ifa_team_id) {
    if (!staff) return null;
    return (
      <section>
        <SectionHeader title="נתוני ההתאחדות" icon="shield" />
        <Card>
          <div className="ip-ifa-cta">
            <p>
              חברו את הקבוצה לקבוצה שלה באתר ההתאחדות לכדורגל, ומשחקים, תוצאות, טבלה, מגרשים וסגל יתעדכנו כאן לבד.
            </p>
            <Button variant="primary" icon="shield" onClick={() => setSheet(true)}>
              חיבור להתאחדות
            </Button>
          </div>
        </Card>
        <IfaLinkSheet
          open={sheet}
          season={team.season}
          onClose={() => setSheet(false)}
          onPick={async (t) => {
            await linkIfaTeam(team.id, t.id);
            setSheet(false);
            await onChanged();
          }}
        />
      </section>
    );
  }

  const ours = team.ifa_team_id;
  const upcoming = (matches ?? []).filter((m) => m.status !== 'played').slice(0, 5);
  const played = (matches ?? []).filter((m) => m.status === 'played').slice(-5).reverse();

  return (
    <>
      <section>
        <SectionHeader title="משחקים מההתאחדות" icon="calendar" />
        <Card padded={false}>
          {matches === null ? (
            <p className="ip-muted ip-pad">טוען…</p>
          ) : upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="אין משחקים קרובים" text="ברגע שההתאחדות תפרסם מועדים, הם יופיעו כאן." />
          ) : (
            upcoming.map((m) => <IfaFixture key={m.id} m={m} ours={ours} />)
          )}
        </Card>
      </section>

      {played.length > 0 && (
        <section>
          <SectionHeader title="תוצאות אחרונות" icon="trophy" />
          <Card padded={false}>
            {played.map((m) => (
              <IfaFixture key={m.id} m={m} ours={ours} />
            ))}
          </Card>
        </section>
      )}

      {table.length > 0 && (
        <section>
          <SectionHeader title="טבלת הליגה" icon="career" />
          <Card padded={false}>
            <table className="ip-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>קבוצה</th>
                  <th>מש׳</th>
                  <th>הפרש</th>
                  <th>נק׳</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.team_id} className={r.team_id === ours ? 'is-us' : ''}>
                    <td>{r.position}</td>
                    <td>{r.team_name}</td>
                    <td>{r.played}</td>
                    <td>
                      <bdi dir="ltr">{signed(r.goals_for - r.goals_against)}</bdi>
                    </td>
                    <td>
                      <strong>{r.points}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      <Card className="ip-ifa-source">
        <div className="ip-ifa-source-row">
          <Icon name="shield" size={18} />
          <span>
            מחובר ל<strong>{ifaTeam?.name ?? 'קבוצה בהתאחדות'}</strong>
          </span>
          {staff && (
            <button
              type="button"
              className="ip-link"
              onClick={async () => {
                await linkIfaTeam(team.id, null);
                await onChanged();
              }}
            >
              ניתוק
            </button>
          )}
        </div>
        {staff && rosterCount > 0 && (
          <Button
            variant="secondary"
            icon="team"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const n = await importIfaRoster(team.id);
                setNote(n ? `נוספו ${n} שחקנים לסגל מההתאחדות.` : 'הסגל כבר מעודכן.');
                await onChanged();
              } catch (e) {
                setError(friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            ייבוא הסגל מההתאחדות ({rosterCount})
          </Button>
        )}
        {note && <p className="ip-footnote">{note}</p>}
        {error && (
          <p className="ip-error" role="alert">
            {error}
          </p>
        )}
        <p className="ip-footnote">
          המידע מתעדכן לפי הפרסום באתר ההתאחדות לכדורגל. בכל סתירה, הקובע הוא פרסום ההתאחדות והודעת המאמן. iplays עצמאית ואינה מטעם ההתאחדות.
        </p>
      </Card>
    </>
  );
}

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

export function IfaFixture({ m, ours }: { m: IfaMatch; ours: string }) {
  const k = m.kickoff ? new Date(m.kickoff) : null;
  const usHome = m.home_team_id === ours;
  const played = m.status === 'played' && m.home_score !== null && m.away_score !== null;
  const us = played ? (usHome ? m.home_score! : m.away_score!) : 0;
  const them = played ? (usHome ? m.away_score! : m.home_score!) : 0;
  const outcome = played ? (us > them ? 'win' : us < them ? 'loss' : 'draw') : null;
  const place = m.venue_address || m.venue;
  return (
    <div className="ip-fixture">
      <span className="ip-fixture-date">
        <span>{k ? dateFmt.format(k) : 'טרם נקבע'}</span>
        <span className="ip-muted ip-fixture-time">{k ? timeFmt.format(k) : ''}</span>
      </span>
      <span className="ip-fixture-teams">
        <span className={usHome ? 'is-us' : ''}>{m.home_name}</span>
        <span className={!usHome ? 'is-us' : ''}>{m.away_name}</span>
        {!played && place && (
          <a className="ip-ifa-venue" href={`https://waze.com/ul?q=${encodeURIComponent(place)}&navigate=yes`} target="_blank" rel="noopener">
            <Icon name="pin" size={14} /> {m.venue || place}
          </a>
        )}
      </span>
      {played ? (
        <span className="ip-fixture-result">
          <span className="ip-fixture-score">
            <span>{m.home_score}</span>
            <span>{m.away_score}</span>
          </span>
          <span className={`ip-outcome ip-outcome--${outcome}`}>{{ win: 'נ', draw: 'ת', loss: 'ה' }[outcome!]}</span>
        </span>
      ) : m.status === 'postponed' ? (
        <Tag tone="warning">נדחה</Tag>
      ) : m.status === 'cancelled' ? (
        <Tag tone="warning">בוטל</Tag>
      ) : m.round ? (
        <Tag>מחזור {m.round}</Tag>
      ) : null}
    </div>
  );
}

/** Pick the IFA team: season → age group → district → league → team, with free-text search. */
function IfaLinkSheet({ open, season, onClose, onPick }: { open: boolean; season: string; onClose: () => void; onPick: (t: IfaTeam) => Promise<void> }) {
  const [leagues, setLeagues] = useState<IfaLeague[] | null>(null);
  const [age, setAge] = useState('');
  const [district, setDistrict] = useState('');
  const [query, setQuery] = useState('');
  const [league, setLeague] = useState<IfaLeague | null>(null);
  const [teams, setTeams] = useState<IfaTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || leagues) return;
    getIfaLeagues(season)
      .then(setLeagues)
      .catch((e) => setError(friendlyError(e)));
  }, [open, season, leagues]);

  useEffect(() => {
    if (!league) return setTeams(null);
    getIfaTeams(league.id)
      .then(setTeams)
      .catch((e) => setError(friendlyError(e)));
  }, [league]);

  const ages = useMemo(() => {
    const set = new Set((leagues ?? []).map((l) => l.age_group).filter(Boolean));
    return [...set].sort((a, b) => rank(a) - rank(b));
  }, [leagues]);
  const districts = useMemo(
    () => [...new Set((leagues ?? []).filter((l) => !age || l.age_group === age).map((l) => l.district).filter(Boolean))].sort(),
    [leagues, age],
  );
  const shown = (leagues ?? []).filter(
    (l) => (!age || l.age_group === age) && (!district || l.district === district) && (!query || l.name.includes(query.trim())),
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={league ? league.name : 'חיבור לקבוצה בהתאחדות'}>
      <div className="ip-form ip-form--sheet">
        {error && (
          <p className="ip-error" role="alert">
            {error}
          </p>
        )}
        {league ? (
          <>
            <button type="button" className="ip-link" onClick={() => setLeague(null)}>
              חזרה לרשימת הליגות
            </button>
            {teams === null ? (
              <p className="ip-muted">טוען…</p>
            ) : (
              <ul className="ip-pick-list">
                {teams.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => void onPick(t).catch((e) => setError(friendlyError(e)))}>
                      <span>
                        <strong>{t.name}</strong>
                        {t.club && <span className="ip-muted">{t.club}</span>}
                      </span>
                      <Icon name="chevron" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : leagues === null ? (
          <p className="ip-muted">טוען…</p>
        ) : leagues.length === 0 ? (
          <EmptyState icon="shield" title="נתוני ההתאחדות עוד לא נטענו" text={`עדיין אין ליגות לעונת ${season}. נסו שוב מאוחר יותר.`} />
        ) : (
          <>
            <div className="ip-chip-row" role="group" aria-label="שנתון">
              <button type="button" className={`ip-chip ${age === '' ? 'is-on' : ''}`} onClick={() => setAge('')}>
                הכול
              </button>
              {ages.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`ip-chip ${age === a ? 'is-on' : ''}`}
                  onClick={() => {
                    setAge(a);
                    setDistrict('');
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="ip-field-row">
              <label className="ip-field">
                <span>מחוז</span>
                <select className="ip-input" value={district} onChange={(e) => setDistrict(e.target.value)}>
                  <option value="">כל המחוזות</option>
                  {districts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ip-field">
                <span>חיפוש ליגה</span>
                <input className="ip-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="לדוגמה: ילדים א" />
              </label>
            </div>
            <ul className="ip-pick-list">
              {shown.slice(0, 60).map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => setLeague(l)}>
                    <span>
                      <strong>{l.name}</strong>
                      <span className="ip-muted">{[l.age_group, l.tier, l.district].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="ip-muted ip-pad">לא נמצאו ליגות. נסו סינון אחר.</li>}
            </ul>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function rank(age: string) {
  const i = AGE_ORDER.findIndex((a) => age.startsWith(a));
  return i === -1 ? 99 : i;
}
