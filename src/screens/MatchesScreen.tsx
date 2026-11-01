/**
 * #matches/<teamId>: a team's matches, lineups and attendance.
 * Staff add matches, build lineups (any number per match, size from the sport
 * profile), publish them and mark attendance. Parents see the schedule, the
 * published lineups (their child highlighted) and the score.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, MetaRow, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError, getRoster, isStaffRole, type Player } from '../lib/api';
import { addDays, localIso, todayYmd, ymd } from '../lib/coachApi';
import {
  addLineup,
  addMatch,
  attendanceSummary,
  competitionLabel,
  eventAttendance,
  getLineups,
  getMatches,
  getVenueLocations,
  matchEndsAt,
  matchError,
  matchTimeLabel,
  matchVenueLabel,
  matchVenueName,
  publishLineup,
  removeLineup,
  saveLineup,
  setVenueLocation,
  updateMatch,
  wazeUrl,
  type AttendanceRow,
  type Competition,
  type Lineup,
  type LineupPlayer,
  type Match,
  type SummaryRow,
  type VenueLocation,
} from '../lib/matchApi';
import { slotLabel, sportProfile, type SportProfile } from '../lib/sports';
import { AttendanceSheet } from './AttendanceSheet';
import '../theme/club.css';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
const errText = (e: unknown) => matchError(e) ?? friendlyError(e);

export function MatchesScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { session, teams } = useAuth();
  const team = teams.find((t) => t.id === teamId);
  const staff = isStaffRole(team?.role);
  const profile = sportProfile(team?.sport);
  const me = session!.user.id;

  const [tab, setTab] = useState<'matches' | 'attendance'>(profile.hasMatches ? 'matches' : 'attendance');
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [roster, setRoster] = useState<Player[]>([]);
  const [open, setOpen] = useState<Match | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([getMatches(teamId), getRoster(teamId)]);
      setMatches(m);
      setRoster(r);
      setOpen((cur) => (cur ? m.find((x) => x.id === cur.id) ?? null : null));
    } catch (e) {
      setMatches([]);
      setError(errText(e));
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!team) {
    return (
      <div className="ip-stack">
        <Back onBack={onBack} title="משחקים" />
        <EmptyState icon="team" title="הקבוצה לא נמצאה" text="ייתכן שהקישור שגוי." />
      </div>
    );
  }

  if (open) {
    return (
      <MatchDetail
        match={open}
        profile={profile}
        staff={staff}
        roster={roster}
        me={me}
        onBack={() => setOpen(null)}
        onChanged={load}
      />
    );
  }

  const now = Date.now();
  const upcoming = (matches ?? []).filter((m) => matchEndsAt(m) >= now);
  const past = (matches ?? []).filter((m) => matchEndsAt(m) < now).reverse();

  return (
    <div className="ip-stack">
      <Back onBack={onBack} title={`${profile.hasMatches ? 'משחקים' : 'נוכחות'} · ${team.name}`} />
      {staff && profile.hasMatches && (
        <Segmented
          items={[
            { id: 'matches', label: 'משחקים' },
            { id: 'attendance', label: 'נוכחות' },
          ]}
          value={tab}
          onChange={setTab}
          label="משחקים ונוכחות"
        />
      )}
      {error && <p className="ip-error" role="alert">{error}</p>}

      {tab === 'attendance' ? (
        <AttendanceSummary teamId={teamId} />
      ) : matches === null ? (
        <p className="ip-muted ip-pad">טוען…</p>
      ) : (
        <>
          {staff && (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              הוספת משחק
            </Button>
          )}
          <section>
            <SectionHeader title="משחקים קרובים" icon="calendar" />
            {upcoming.length === 0 ? (
              <Card>
                <EmptyState icon="ball" title="אין משחקים קרובים" text={staff ? 'הוסיפו משחק כדי לבנות הרכבים ולסמן נוכחות.' : 'המאמן עוד לא פרסם משחקים.'} />
              </Card>
            ) : (
              <div className="ip-stack ip-stack--tight">
                {upcoming.map((m) => (
                  <MatchCard key={m.id} m={m} profile={profile} onOpen={() => setOpen(m)} />
                ))}
              </div>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <SectionHeader title="תוצאות" icon="trophy" />
              <div className="ip-stack ip-stack--tight">
                {past.map((m) => (
                  <MatchCard key={m.id} m={m} profile={profile} onOpen={() => setOpen(m)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <MatchSheet
        open={adding}
        profile={profile}
        onClose={() => setAdding(false)}
        onSave={async (input) => {
          await addMatch({ teamId, ...input });
          setAdding(false);
          await load();
        }}
      />
    </div>
  );
}

function Back({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="ip-backbar">
      <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
        <Icon name="back" size={20} />
      </button>
      <h1>{title}</h1>
      <span />
    </div>
  );
}

function Score({ m }: { m: Match }) {
  if (m.score_for == null || m.score_against == null) return null;
  const tone = m.score_for > m.score_against ? 'lime' : m.score_for < m.score_against ? 'live' : 'neutral';
  return (
    <Tag tone={tone}>
      <bdi dir="ltr">
        {m.score_for} : {m.score_against}
      </bdi>
    </Tag>
  );
}

function MatchCard({ m, profile, onOpen }: { m: Match; profile: SportProfile; onOpen: () => void }) {
  return (
    <button type="button" className={`ip-card ip-card--padded ip-match-card ${m.status === 'canceled' ? 'is-canceled' : ''}`} onClick={onOpen}>
      <div className="ip-carpool-head">
        <strong>
          {m.home ? 'בית' : 'חוץ'} · נגד {m.opponent}
        </strong>
        {m.status === 'canceled' ? (
          <Tag tone="warning">בוטל</Tag>
        ) : m.score_for != null ? (
          <Score m={m} />
        ) : (
          <Tag tone="blue">{m.source === 'ifa' ? 'ליגה · התאחדות' : competitionLabel[m.competition]}</Tag>
        )}
      </div>
      <MetaRow icon="clock">
        {fmtDate(m.starts_at)} · {matchTimeLabel(m)}
      </MetaRow>
      {matchVenueLabel(m) && <MetaRow icon="pin">{matchVenueLabel(m)}</MetaRow>}
      {profile.lineup && m.lineup_size && <span className="ip-list-row-sub">הרכב של {m.lineup_size}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ venue */

/** Navigate with Waze, and let a coach or parent save where the venue really is (kept for future games). */
function VenueCard({ match }: { match: Match }) {
  const name = matchVenueName(match);
  const [loc, setLoc] = useState<VenueLocation | null>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    void getVenueLocations([name]).then((m) => setLoc(m.get(name) ?? null));
  }, [name]);

  if (!name) return null;
  const guess = !match.venue;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setVenueLocation(name, address);
      setLoc((await getVenueLocations([name])).get(name) ?? null);
      setEditing(false);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="ip-venue">
        <div className="ip-venue-text">
          <strong>{guess ? `כנראה: ${name}` : name}</strong>
          <span className="ip-list-row-sub">
            {loc?.address ? loc.address : 'עוד אין כתובת שמורה למגרש הזה'}
            {guess && ' · מגרש הבית הרגיל של הקבוצה המארחת, לא אושר בהתאחדות'}
          </span>
        </div>
        <a className="ip-btn ip-btn--primary ip-btn--sm" href={wazeUrl(name, loc)} target="_blank" rel="noopener noreferrer">
          <Icon name="navigate" size={18} />
          <span>נווט ב־Waze</span>
        </a>
      </div>
      {!editing ? (
        <button type="button" className="ip-link-btn" onClick={() => { setAddress(loc?.address ?? ''); setEditing(true); }}>
          {loc?.address ? 'הכתובת לא נכונה? עדכון' : 'יודעים איפה זה? הוספת כתובת'}
        </button>
      ) : (
        <form className="ip-form" onSubmit={(e) => void save(e)}>
          <Field label={`כתובת המגרש "${name}" (תישמר לכל המשחקים הבאים בו)`}>
            <input id="venue-address" className="ip-input" value={address} onChange={(e) => setAddress(e.target.value.slice(0, 200))} placeholder="רחוב, מספר, עיר" />
          </Field>
          <Err error={error} />
          <div className="ip-btn-row">
            <Button type="submit" variant="primary" size="sm" disabled={busy || address.trim().length < 3}>
              {busy ? 'שומרים…' : 'שמירה'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              ביטול
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- detail */

function MatchDetail({
  match,
  profile,
  staff,
  roster,
  me,
  onBack,
  onChanged,
}: {
  match: Match;
  profile: SportProfile;
  staff: boolean;
  roster: Player[];
  me: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [lineups, setLineups] = useState<Lineup[] | null>(null);
  const [att, setAtt] = useState<AttendanceRow[]>([]);
  const [attOpen, setAttOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState({ f: match.score_for?.toString() ?? '', a: match.score_against?.toString() ?? '' });

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([getLineups(match.id), staff ? eventAttendance('match', match.id).catch(() => []) : Promise.resolve([])]);
      setLineups(l);
      setAtt(a);
    } catch (e) {
      setLineups([]);
      setError(errText(e));
    }
  }, [match.id, staff]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const names = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);
  const mine = new Set(roster.filter((p) => p.guardians.includes(me)).map((p) => p.id));
  const expected = new Map(att.map((r) => [r.player_id, r]));

  return (
    <div className="ip-stack">
      <Back onBack={onBack} title={`נגד ${match.opponent}`} />
      <Card tone="navy" className="ip-team-hero">
        <div className="ip-match-hero">
          <span>
            {match.home ? 'משחק בית' : 'משחק חוץ'} · {competitionLabel[match.competition]}
            {match.source === 'ifa' && ' · לפי אתר ההתאחדות'}
          </span>
          <strong>
            {fmtDate(match.starts_at)} · {matchTimeLabel(match)}
          </strong>
          {matchVenueLabel(match) && <span className="ip-on-navy-muted">{matchVenueLabel(match)}</span>}
          {match.ifa_status === 'postponed' && <Tag tone="warning">המשחק נדחה</Tag>}
          {match.score_for != null && match.score_against != null && (
            <strong className="ip-match-score" dir="ltr">
              {match.score_for} : {match.score_against}
            </strong>
          )}
          {match.status === 'canceled' && <Tag tone="warning">המשחק בוטל</Tag>}
        </div>
      </Card>
      {error && <p className="ip-error" role="alert">{error}</p>}

      <VenueCard match={match} />

      {staff && (
        <Card>
          {match.source === 'ifa' ? (
            <p className="ip-muted">מועד, מגרש ותוצאה מתעדכנים אוטומטית מאתר ההתאחדות.</p>
          ) : (
          <form
            className="ip-match-score-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await updateMatch(match.id, {
                  score_for: score.f === '' ? null : Number(score.f),
                  score_against: score.a === '' ? null : Number(score.a),
                  status: score.f !== '' && score.a !== '' ? 'played' : match.status === 'played' ? 'scheduled' : match.status,
                });
                await onChanged();
              });
            }}
          >
            <Field label={`אנחנו (${profile.scoreLabel})`}>
              <input id="sc-for" className="ip-input" inputMode="numeric" dir="ltr" value={score.f} onChange={(e) => setScore({ ...score, f: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
            </Field>
            <Field label={match.opponent}>
              <input id="sc-against" className="ip-input" inputMode="numeric" dir="ltr" value={score.a} onChange={(e) => setScore({ ...score, a: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
            </Field>
            <Button type="submit" variant="secondary" size="sm">
              שמירת תוצאה
            </Button>
          </form>
          )}
          <div className="ip-btn-row">
            <Button variant="secondary" size="sm" icon="check" onClick={() => setAttOpen(true)}>
              נוכחות במשחק
            </Button>
            {match.source !== 'ifa' && (
            <Button
              variant="ghost"
              size="sm"
              icon={match.status === 'canceled' ? 'undo' : 'close'}
              onClick={() => void run(async () => {
                await updateMatch(match.id, { status: match.status === 'canceled' ? 'scheduled' : 'canceled' });
                await onChanged();
              })}
            >
              {match.status === 'canceled' ? 'החזרת המשחק' : 'ביטול המשחק'}
            </Button>
            )}
          </div>
        </Card>
      )}

      {profile.lineup && match.lineup_size && (
        <section>
          <SectionHeader title="הרכבים" icon="team" />
          {lineups === null ? (
            <p className="ip-muted ip-pad">טוען…</p>
          ) : lineups.length === 0 ? (
            <Card>
              <EmptyState icon="team" title={staff ? 'עוד אין הרכב' : 'ההרכב עוד לא פורסם'} text={staff ? `אפשר לבנות כמה הרכבים, למשל שתי קבוצות של ${match.lineup_size}.` : 'כשהמאמן יפרסם את ההרכב הוא יופיע כאן.'} />
            </Card>
          ) : (
            <div className="ip-stack ip-stack--tight">
              {lineups.map((l) =>
                staff ? (
                  <LineupEditor
                    key={l.id}
                    lineup={l}
                    all={lineups}
                    size={match.lineup_size!}
                    profile={profile}
                    roster={roster}
                    expected={expected}
                    onSave={(players, label) => run(() => saveLineup(l.id, players, label))}
                    onPublish={(p) => run(() => publishLineup(l.id, p))}
                    onRemove={() => confirm(`להסיר את "${l.label}"?`) && run(() => removeLineup(l.id))}
                  />
                ) : (
                  <LineupView key={l.id} lineup={l} profile={profile} names={names} mine={mine} />
                ),
              )}
            </div>
          )}
          {staff && (
            <div className="ip-btn-row">
              <Button variant="secondary" icon="plus" onClick={() => void run(() => addLineup(match.id))}>
                {lineups?.length ? 'הרכב נוסף' : 'בניית הרכב'}
              </Button>
            </div>
          )}
        </section>
      )}

      {!staff && <p className="ip-footnote">לא מגיעים? מדווחים בלוח המאמן ← "דיווח איחור / אי־הגעה" לפי תאריך המשחק.</p>}

      {attOpen && <AttendanceSheet kind="match" eventId={match.id} title={`נוכחות · נגד ${match.opponent}`} onClose={() => { setAttOpen(false); void load(); }} />}
    </div>
  );
}

function LineupView({ lineup, profile, names, mine }: { lineup: Lineup; profile: SportProfile; names: Map<string, Player>; mine: Set<string> }) {
  const starters = lineup.players.filter((p) => p.slot != null).sort((a, b) => a.slot! - b.slot!);
  const bench = lineup.players.filter((p) => p.slot == null);
  const name = (id: string) => {
    const p = names.get(id);
    return p ? `${p.first_name} ${p.last_name}`.trim() : 'שחקן';
  };
  return (
    <Card>
      <div className="ip-carpool-head">
        <strong>{lineup.label}</strong>
        <Tag tone="lime" icon="check">פורסם</Tag>
      </div>
      <ol className="ip-lineup">
        {starters.map((p) => (
          <li key={p.player_id} className={mine.has(p.player_id) ? 'is-mine' : ''}>
            <span className="ip-lineup-slot">{p.position || slotLabel(profile, p.slot!)}</span>
            <strong>{name(p.player_id)}</strong>
            {mine.has(p.player_id) && <Tag tone="lime">הילד שלי</Tag>}
          </li>
        ))}
      </ol>
      {bench.length > 0 && (
        <p className="ip-muted">
          מחליפים: {bench.map((p) => name(p.player_id)).join(', ')}
        </p>
      )}
    </Card>
  );
}

function LineupEditor({
  lineup,
  all,
  size,
  profile,
  roster,
  expected,
  onSave,
  onPublish,
  onRemove,
}: {
  lineup: Lineup;
  all: Lineup[];
  size: number;
  profile: SportProfile;
  roster: Player[];
  expected: Map<string, AttendanceRow>;
  onSave: (players: LineupPlayer[], label: string) => void;
  onPublish: (publish: boolean) => void;
  onRemove: () => void;
}) {
  const initSlots = () => Array.from({ length: size }, (_, i) => lineup.players.find((p) => p.slot === i + 1)?.player_id ?? '');
  const [label, setLabel] = useState(lineup.label);
  const [slots, setSlots] = useState<string[]>(initSlots);
  const [bench, setBench] = useState<string[]>(lineup.players.filter((p) => p.slot == null).map((p) => p.player_id));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLabel(lineup.label);
    setSlots(initSlots());
    setBench(lineup.players.filter((p) => p.slot == null).map((p) => p.player_id));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup]);

  // players already in another lineup of this match
  const elsewhere = new Set(all.filter((l) => l.id !== lineup.id).flatMap((l) => l.players.map((p) => p.player_id)));
  const used = new Set([...slots.filter(Boolean), ...bench]);
  const note = (id: string) => {
    const r = expected.get(id);
    return r && r.effective !== 'coming' && r.effective !== 'present' ? ` (${r.effective === 'late' ? 'איחור' : 'לא מגיע'})` : '';
  };
  const label_ = (p: Player) => `${p.shirt_number != null ? `${p.shirt_number} · ` : ''}${p.first_name} ${p.last_name}${note(p.id)}`;
  const free = roster.filter((p) => !elsewhere.has(p.id));

  const players: LineupPlayer[] = [
    ...slots.flatMap((id, i) => (id ? [{ player_id: id, slot: i + 1, position: '' }] : [])),
    ...bench.map((id) => ({ player_id: id, slot: null, position: '' })),
  ];

  return (
    <Card className="ip-lineup-edit">
      <div className="ip-carpool-head">
        <input
          className="ip-input ip-lineup-label"
          value={label}
          aria-label="שם ההרכב"
          onChange={(e) => {
            setLabel(e.target.value.slice(0, 30));
            setDirty(true);
          }}
        />
        {lineup.published_at ? <Tag tone="lime" icon="check">פורסם</Tag> : <Tag>טיוטה</Tag>}
      </div>
      <ol className="ip-lineup">
        {slots.map((id, i) => (
          <li key={i}>
            <span className="ip-lineup-slot">
              {i + 1} · {slotLabel(profile, i + 1)}
            </span>
            <select
              className="ip-input ip-club-select"
              value={id}
              aria-label={`עמדה ${i + 1}`}
              onChange={(e) => {
                const v = e.target.value;
                setSlots((s) => s.map((x, j) => (j === i ? v : x)));
                setBench((b) => b.filter((x) => x !== v));
                setDirty(true);
              }}
            >
              <option value="">—</option>
              {free
                .filter((p) => p.id === id || !used.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {label_(p)}
                  </option>
                ))}
            </select>
          </li>
        ))}
      </ol>
      <p className="ip-list-row-sub">מחליפים</p>
      <div className="ip-lineup-bench">
        {free
          .filter((p) => !slots.includes(p.id))
          .map((p) => {
            const on = bench.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={on ? 'is-on' : ''}
                onClick={() => {
                  setBench((b) => (on ? b.filter((x) => x !== p.id) : [...b, p.id]));
                  setDirty(true);
                }}
              >
                {p.first_name}
                {note(p.id)}
              </button>
            );
          })}
      </div>
      <div className="ip-btn-row">
        <Button variant="primary" size="sm" disabled={!dirty} onClick={() => onSave(players, label)}>
          שמירה
        </Button>
        <Button variant="secondary" size="sm" disabled={dirty} onClick={() => onPublish(!lineup.published_at)}>
          {lineup.published_at ? 'ביטול פרסום' : 'פרסום להורים'}
        </Button>
        {!lineup.published_at && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            הסרה
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- new match */

function MatchSheet({
  open,
  profile,
  onClose,
  onSave,
}: {
  open: boolean;
  profile: SportProfile;
  onClose: () => void;
  onSave: (m: { startsAt: string; opponent: string; home: boolean; venue: string; competition: Competition; lineupSize: number | null }) => Promise<void>;
}) {
  const [f, setF] = useState({ date: addDays(todayYmd(), 7), time: '10:00', opponent: '', home: true, venue: '', competition: 'league' as Competition, size: profile.lineup?.defaultSize ?? 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ startsAt: localIso(f.date, f.time), opponent: f.opponent, home: f.home, venue: f.venue, competition: f.competition, lineupSize: profile.lineup ? f.size : null });
      setF({ ...f, opponent: '', venue: '' });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="משחק חדש">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="יריבה">
          <input id="m-opp" className="ip-input" value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value.slice(0, 60) })} placeholder="לדוגמה: הפועל מזרח" required />
        </Field>
        <div className="ip-field-row">
          <Field label="תאריך">
            <input id="m-date" className="ip-input" type="date" dir="ltr" value={f.date} min={ymd(new Date(Date.now() - 365 * 864e5))} onChange={(e) => setF({ ...f, date: e.target.value })} required />
          </Field>
          <Field label="שעה">
            <input id="m-time" className="ip-input" type="time" dir="ltr" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} required />
          </Field>
        </div>
        <Segmented
          items={[
            { id: 'home', label: 'בית' },
            { id: 'away', label: 'חוץ' },
          ]}
          value={f.home ? 'home' : 'away'}
          onChange={(v) => setF({ ...f, home: v === 'home' })}
          label="בית או חוץ"
        />
        <Field label="מגרש / אולם">
          <input id="m-venue" className="ip-input" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value.slice(0, 80) })} placeholder="לא חובה" />
        </Field>
        <div className="ip-field-row">
          <Field label="סוג">
            <select id="m-comp" className="ip-input" value={f.competition} onChange={(e) => setF({ ...f, competition: e.target.value as Competition })}>
              {(Object.keys(competitionLabel) as Competition[]).map((c) => (
                <option key={c} value={c}>
                  {competitionLabel[c]}
                </option>
              ))}
            </select>
          </Field>
          {profile.lineup && profile.lineup.sizes.length > 1 && (
            <Field label="שחקנים בהרכב">
              <select id="m-size" className="ip-input" value={f.size} onChange={(e) => setF({ ...f, size: Number(e.target.value) })}>
                {profile.lineup.sizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !f.opponent.trim()}>
          {busy ? 'שומרים…' : 'הוספת המשחק'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/* -------------------------------------------------------- attendance tab */

function AttendanceSummary({ teamId }: { teamId: string }) {
  const [days, setDays] = useState<'30' | '90'>('30');
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    attendanceSummary(teamId, addDays(todayYmd(), -Number(days)), todayYmd())
      .then(setRows)
      .catch((e) => {
        setRows([]);
        setError(errText(e));
      });
  }, [teamId, days]);

  return (
    <section className="ip-stack ip-stack--tight">
      <Segmented
        items={[
          { id: '30', label: '30 יום' },
          { id: '90', label: '90 יום' },
        ]}
        value={days}
        onChange={setDays}
        label="תקופה"
      />
      <p className="ip-footnote">אימונים ומשחקים שהתקיימו. בלי סימון ובלי דיווח הורה, השחקן נספר כנוכח.</p>
      {error && <p className="ip-error" role="alert">{error}</p>}
      <Card padded={false}>
        {rows === null ? (
          <p className="ip-muted ip-pad">טוען…</p>
        ) : rows.length === 0 ? (
          <p className="ip-muted ip-pad">אין נתונים לתקופה.</p>
        ) : (
          <ul className="ip-att-summary">
            {rows.map((r) => (
              <li key={r.player_id}>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {r.first_name} {r.last_name}
                  </span>
                  <span className="ip-list-row-sub">
                    {r.events} אירועים · {r.present} נוכח · {r.late} איחור · {r.absent} חסר
                  </span>
                </span>
                <strong className={`ip-att-rate ${r.rate != null && r.rate < 70 ? 'is-low' : ''}`}>{r.rate == null ? '–' : `${r.rate}%`}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
