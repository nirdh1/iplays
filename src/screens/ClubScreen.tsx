/**
 * Club panel: one club with two programs (league and academy), its teams,
 * every player in the club, and transfers between programs. Club owners and
 * admins manage; the database enforces who may do what (RLS + functions).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, ListRow, SectionHeader, Segmented, StatTile, Tag, TeamCrest } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import { findTeams, teamYearLabel, type FoundTeam } from '../lib/joinApi';
import {
  adoptTeam,
  adoptCandidatesInfo,
  type AdoptInfo,
  clubError,
  clubRoleLabel,
  clubStatusLabel,
  getClubData,
  getMyClubs,
  myClubAccess,
  pendingClubAccessRequests,
  programKindLabel,
  requestVerification,
  setTeamProgram,
  transferKindLabel,
  transferPlayer,
  endAssignment,
  type Assignment,
  type Club,
  type ClubAccess,
  type ClubData,
  type ClubTeam,
  type Program,
} from '../lib/clubApi';
import { ClubDashboard } from './ClubDashboard';
import { ClubStaffSection } from './ClubStaffSection';
import { ClubRolesSection } from './ClubRolesSection';
import { ClubSignup } from './ClubSignup';
import { ProNotesSheet } from './ProNotesSheet';
import { ClubFinanceSection } from './ClubFinanceSection';
import { ClubActivitiesSection } from './ClubActivitiesSection';
import '../theme/club.css';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);

type Tab = 'overview' | 'search' | 'teams' | 'players' | 'transfers' | 'staff' | 'roles' | 'finance' | 'activities';

interface ClubPlayer {
  id: string;
  name: string;
  birthYear: number | null;
  assignments: Assignment[];
}

export function ClubScreen({ clubId, initialTab, onBack }: { clubId?: string; initialTab?: 'search'; onBack: () => void }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadClubs = useCallback(async () => {
    try {
      setClubs(await getMyClubs(me));
    } catch (e) {
      setError(errText(e));
    }
  }, [me]);

  useEffect(() => {
    void loadClubs();
  }, [loadClubs]);

  const [joining, setJoining] = useState(false);
  const club = clubs?.find((c) => c.id === clubId) ?? clubs?.[0];
  const opened = (id: string) => loadClubs().then(() => {
    setJoining(false);
    window.location.hash = `club/${id}`;
  });

  return (
    <div className="ip-stack ip-club">
      <BackBar onBack={onBack} title="ניהול מועדון" />
      <Err error={error} />
      {clubs === null ? (
        <p className="ip-muted">טוען…</p>
      ) : club ? (
        <>
          {clubs.length > 1 && (
            <div className="ip-club-switch" role="tablist" aria-label="בחירת מועדון">
              {clubs.map((c) => (
                <button key={c.id} type="button" className={c.id === club.id ? 'is-active' : ''} onClick={() => (window.location.hash = `club/${c.id}`)}>
                  {c.name}
                  {c.roles && c.roles.length > 0 ? ` · ${c.roles.join(', ')}` : ''}
                </button>
              ))}
            </div>
          )}
          <ClubPanel key={club.id} club={club} initialTab={initialTab} onChanged={loadClubs} />
          {joining ? (
            <ClubSignup onCreated={opened} />
          ) : (
            <Button variant="ghost" icon="plus" onClick={() => setJoining(true)}>
              הצטרפות למועדון נוסף או פתיחת מועדון
            </Button>
          )}
        </>
      ) : (
        <ClubSignup onCreated={opened} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

function ClubPanel({ club, initialTab, onChanged }: { club: Club; initialTab?: 'search'; onChanged: () => void }) {
  const auth = useAuth();
  const [data, setData] = useState<ClubData | null>(null);
  const manage = club.role === 'owner' || club.role === 'admin';
  const [tab, setTab] = useState<Tab>(initialTab === 'search' && manage ? 'search' : 'overview');
  const [error, setError] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<ClubPlayer | null>(null);
  const [notesFor, setNotesFor] = useState<ClubPlayer | null>(null);
  const [access, setAccess] = useState<ClubAccess | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    myClubAccess(club.id).then(setAccess).catch(() => setAccess(null));
    if (manage) {
      pendingClubAccessRequests()
        .then((r) => setPendingCount(r.filter((x) => x.club_id === club.id).length))
        .catch(() => undefined);
    }
  }, [club.id, manage]);

  const load = useCallback(async () => {
    try {
      setData(await getClubData(club.id));
    } catch (e) {
      setError(errText(e));
    }
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamById = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t])), [data]);
  const programById = useMemo(() => new Map((data?.programs ?? []).map((p) => [p.id, p])), [data]);
  const kindOfTeam = useCallback((teamId: string) => programById.get(teamById.get(teamId)?.program_id ?? '')?.kind, [programById, teamById]);

  const players = useMemo<ClubPlayer[]>(() => {
    const map = new Map<string, ClubPlayer>();
    for (const a of data?.assignments ?? []) {
      const p = map.get(a.player_id) ?? {
        id: a.player_id,
        name: `${a.player.first_name} ${a.player.last_name}`.trim(),
        birthYear: a.player.birth_year,
        assignments: [],
      };
      p.assignments.push(a);
      map.set(a.player_id, p);
    }
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, 'he'));
  }, [data]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const myAdminTeams = auth.teams.filter((t) => t.role === 'admin' && !teamById.has(t.id));
  const leaguePlayers = players.filter((p) => p.assignments.some((a) => kindOfTeam(a.team_id) === 'league'));
  const academyPlayers = players.filter((p) => p.assignments.some((a) => kindOfTeam(a.team_id) === 'academy'));
  const both = players.filter((p) => leaguePlayers.includes(p) && academyPlayers.includes(p));

  return (
    <>
      <Card tone="navy" className="ip-team-hero">
        <div className="ip-team-hero-id">
          <TeamCrest name={club.name} tone="lime" size={56} />
          <div>
            <h1>{club.name}</h1>
            <p className="ip-on-navy-muted">{[club.city, clubRoleLabel[club.role]].filter(Boolean).join(' · ')}</p>
            <div className="ip-club-status">
              <Tag tone={club.status === 'verified' ? 'lime' : 'warning'}>{clubStatusLabel[club.status]}</Tag>
            </div>
          </div>
        </div>
        {manage && club.status === 'draft' && (
          <Button
            variant="secondary"
            size="sm"
            icon="shield"
            onClick={() => run(() => requestVerification(club.id, '').then(onChanged))}
          >
            בקשת אימות מועדון
          </Button>
        )}
      </Card>

      <Err error={error} />

      {pendingCount > 0 && (
        <button type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = 'clubrequests')}>
          <span className="ip-icon-tile ip-icon-tile--lime">
            <Icon name="bell" size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">{pendingCount === 1 ? 'בקשה אחת ממתינה לאישורך' : `${pendingCount} בקשות ממתינות לאישורך`}</span>
            <span className="ip-list-row-sub">מאמנים ואנשי צוות שביקשו להצטרף למועדון</span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
      )}

      <Segmented
        label="תצוגה"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'סקירה' },
          ...(manage ? [{ id: 'search' as const, label: 'חיפוש' }] : []),
          { id: 'teams', label: 'קבוצות' },
          { id: 'players', label: 'שחקנים' },
          { id: 'transfers', label: 'מעברים' },
          ...(manage ? [{ id: 'staff' as const, label: 'צוות' }] : []),
          ...(access?.manage_roles ? [{ id: 'roles' as const, label: 'תפקידים' }] : []),
          { id: 'finance', label: 'כספים' },
          { id: 'activities', label: 'מחנות' },
        ]}
      />

      {data === null ? (
        <p className="ip-muted">טוען…</p>
      ) : tab === 'overview' ? (
        <section className="ip-stack">
          <div className="ip-stats ip-club-stats">
            <StatTile value={players.length} label="שחקנים" accent />
            <StatTile value={data.teams.filter((t) => kindOfTeam(t.id) === 'league').length} label="קבוצות ליגה" />
            <StatTile value={data.teams.filter((t) => kindOfTeam(t.id) === 'academy').length} label="קבוצות אקדמיה" />
          </div>
          <div className="ip-stats ip-club-stats">
            <StatTile value={leaguePlayers.length} label="בליגה" />
            <StatTile value={academyPlayers.length} label="באקדמיה" />
            <StatTile value={both.length} label="בשתי המסגרות" />
          </div>
          <ClubDashboard clubId={club.id} programs={data.programs} teams={data.teams} />
          <SectionHeader title="מעברים אחרונים" icon="arrow" action={data.transfers.length ? 'הכול' : undefined} onAction={() => setTab('transfers')} />
          <TransferList transfers={data.transfers.slice(0, 5)} teamName={(id) => teamById.get(id ?? '')?.name} />
        </section>
      ) : tab === 'search' && manage ? (
        <section className="ip-stack">
          <AdoptSection clubId={club.id} programs={data.programs} onAdopted={load} />
        </section>
      ) : tab === 'teams' ? (
        <section className="ip-stack">
          {data.programs.map((p) => {
            const list = data.teams.filter((t) => t.program_id === p.id);
            return (
              <div key={p.id}>
                <SectionHeader title={`${p.name} · ${list.length} קבוצות`} icon={p.kind === 'league' ? 'trophy' : 'whistle'} />
                <Card padded={false}>
                  {list.length === 0 ? (
                    <p className="ip-muted ip-pad">עוד אין קבוצות ב{programKindLabel[p.kind]}.</p>
                  ) : (
                    list.map((t) => (
                      <TeamRow
                        key={t.id}
                        team={t}
                        count={data.assignments.filter((a) => a.team_id === t.id).length}
                        programs={data.programs}
                        manage={manage}
                        onProgram={(pid) => run(() => setTeamProgram(t.id, pid))}
                      />
                    ))
                  )}
                </Card>
              </div>
            );
          })}
          {manage && (
            <Button variant="secondary" icon="plus" onClick={() => setTab('search')}>
              חיפוש ושיוך קבוצות למועדון
            </Button>
          )}
          {manage && myAdminTeams.length > 0 && (
            <div>
              <SectionHeader title="הקבוצות שלי מחוץ למועדון" icon="plus" />
              <Card padded={false}>
                {myAdminTeams.map((t) => (
                  <div key={t.id} className="ip-club-row">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{t.name}</span>
                      <span className="ip-list-row-sub">{t.club || 'ללא מועדון'}</span>
                    </span>
                    {data.programs.map((p) => (
                      <Button key={p.id} variant="secondary" size="sm" onClick={() => run(() => setTeamProgram(t.id, p.id).then(auth.refresh))}>
                        ל{p.name}
                      </Button>
                    ))}
                  </div>
                ))}
              </Card>
            </div>
          )}
        </section>
      ) : tab === 'players' ? (
        <section className="ip-stack">
          <SectionHeader title={`כל השחקנים · ${players.length}`} icon="team" />
          <Card padded={false}>
            {players.length === 0 ? (
              <EmptyState icon="team" title="עוד אין שחקנים" text="שחקנים מופיעים כאן כשהם נוספים לקבוצות של המועדון." />
            ) : (
              <ul className="ip-roster">
                {players.map((p) => (
                  <li key={p.id}>
                    <InitialsAvatar name={p.name} size={40} tone={p.assignments.length > 1 ? 'lime' : 'blue'} />
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{p.name}</span>
                      <span className="ip-club-tags">
                        {p.birthYear && <span className="ip-list-row-sub">שנתון {p.birthYear}</span>}
                        {p.assignments.map((a) => (
                          <Tag key={a.id} tone={kindOfTeam(a.team_id) === 'academy' ? 'blue' : 'navy'}>
                            {teamById.get(a.team_id)?.name}
                            {a.shirt_number != null ? ` · ${a.shirt_number}` : ''}
                          </Tag>
                        ))}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" icon="shield" onClick={() => setNotesFor(p)}>
                      תיק
                    </Button>
                    {manage && (
                      <Button variant="secondary" size="sm" onClick={() => setTransferFor(p)}>
                        העברה
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      ) : tab === 'staff' ? (
        <ClubStaffSection club={club} data={data} />
      ) : tab === 'roles' && access ? (
        <ClubRolesSection club={club} data={data} access={access} />
      ) : tab === 'finance' ? (
        <ClubFinanceSection clubId={club.id} clubName={club.name} data={data} />
      ) : tab === 'activities' ? (
        <ClubActivitiesSection clubId={club.id} />
      ) : (
        <section className="ip-stack">
          <SectionHeader title="היסטוריית מעברים" icon="arrow" />
          <TransferList transfers={data.transfers} teamName={(id) => teamById.get(id ?? '')?.name} />
        </section>
      )}

      {notesFor && (
        <ProNotesSheet
          clubId={club.id}
          clubName={club.name}
          player={{ id: notesFor.id, name: notesFor.name }}
          teamId={notesFor.assignments[0]?.team_id ?? null}
          onClose={() => setNotesFor(null)}
        />
      )}

      {transferFor && data && (
        <TransferSheet
          player={transferFor}
          teams={data.teams.filter((t) => !t.archived_at)}
          programName={(t) => programById.get(t.program_id ?? '')?.name ?? 'ללא מסגרת'}
          onClose={() => setTransferFor(null)}
          onDone={async () => {
            setTransferFor(null);
            await load();
          }}
        />
      )}
    </>
  );
}

/** Teams with no coach and no club yet (parent-opened or IFA catalog): the club can take them in. */
function AdoptSection({ clubId, programs, onAdopted }: { clubId: string; programs: Program[]; onAdopted: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [hits, setHits] = useState<FoundTeam[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [info, setInfo] = useState<Map<string, AdoptInfo>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const by = year.length === 4 ? Number(year) : null;

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const all = await findTeams(q.trim().length >= 2 ? q : '', by);
      const free = all.filter((t) => !t.club_id && !t.has_staff);
      setHidden(all.length - free.length);
      setHits(free);
      setInfo(new Map());
      // Extra detail to tell look-alike teams apart; optional (older databases lack it).
      adoptCandidatesInfo(free.map((t) => t.team_id))
        .then((rows) => setInfo(new Map(rows.map((r) => [r.team_id, r]))))
        .catch(() => undefined);
    } catch (err) {
      setError(errText(err));
    }
  }

  async function adopt(t: FoundTeam, programId: string, programName: string) {
    if (!window.confirm(`לשייך את "${t.name}" ל${programName} של המועדון? אחרי השיוך המועדון מנהל את הקבוצה.`)) return;
    setError(null);
    try {
      await adoptTeam(t.team_id, clubId, programId);
      setHits((h) => h?.filter((x) => x.team_id !== t.team_id) ?? null);
      await onAdopted();
    } catch (err) {
      setError(errText(err));
    }
  }

  return (
    <div>
      <SectionHeader title="חיפוש ושיוך קבוצות למועדון" icon="plus" />
      <Card>
        <form className="ip-form" onSubmit={search}>
          <p className="ip-muted">חפשו קבוצה לפי שם או שנתון ולחצו "לליגה" או "לאקדמיה". מופיעות רק קבוצות שעדיין אין להן מאמן או מועדון באפליקציה. אחרי השיוך המועדון מנהל אותן, מאשר הצטרפות, והן נספרות בדשבורד.</p>
          <div className="ip-field-row">
            <Field label="שם קבוצה או מועדון">
              <input id="adopt-q" className="ip-input" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="שנתון">
              <input id="adopt-year" className="ip-input" inputMode="numeric" dir="ltr" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2016" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" icon="eye" disabled={q.trim().length < 2 && by === null}>
            חיפוש
          </Button>
          <Err error={error} />
        </form>
        {hits && (hits.length === 0 ? (
          <p className="ip-muted">
            {hidden > 0
              ? `נמצאו ${hidden} קבוצות, אבל לכולן כבר יש מאמן או מועדון באפליקציה, ולכן אי אפשר לשייך אותן מכאן.`
              : 'לא נמצאו קבוצות. נסו מילה אחת מהשם (למשל "רמת גן") או בלי שנתון.'}
          </p>
        ) : (
          hits.map((t) => (
            <div key={t.team_id} className="ip-club-row">
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">{t.name}</span>
                <span className="ip-list-row-sub">{[t.club_name, teamYearLabel(t), `${t.players} שחקנים`].filter(Boolean).join(' · ')}</span>
                {info.get(t.team_id) && (
                  <span className="ip-list-row-sub">
                    {[
                      info.get(t.team_id)!.league,
                      info.get(t.team_id)!.season && `עונה ${info.get(t.team_id)!.season}`,
                      info.get(t.team_id)!.roster_year && `רוב הסגל: ${info.get(t.team_id)!.roster_year}`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {programs.map((p) => (
                <Button key={p.id} variant="secondary" size="sm" onClick={() => void adopt(t, p.id, p.name)}>
                  ל{p.name}
                </Button>
              ))}
            </div>
          ))
        ))}
      </Card>
    </div>
  );
}

function TeamRow({
  team,
  count,
  programs,
  manage,
  onProgram,
}: {
  team: ClubTeam;
  count: number;
  programs: ClubData['programs'];
  manage: boolean;
  onProgram: (programId: string) => void;
}) {
  return (
    <div className="ip-club-row">
      <button type="button" className="ip-club-row-main" onClick={() => (window.location.hash = `myteam/${team.id}`)}>
        <span className="ip-list-row-title">{team.name}</span>
        <span className="ip-list-row-sub">
          {count} שחקנים · עונת {team.season}
          {team.archived_at ? ' · בארכיון' : ''}
        </span>
      </button>
      {manage && programs.length > 1 && (
        <select className="ip-input ip-club-select" aria-label="מסגרת" value={team.program_id ?? ''} onChange={(e) => onProgram(e.target.value)}>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function TransferList({ transfers, teamName }: { transfers: ClubData['transfers']; teamName: (id: string | null) => string | undefined }) {
  if (transfers.length === 0) {
    return (
      <Card>
        <p className="ip-muted">עוד לא היו מעברים בין מסגרות.</p>
      </Card>
    );
  }
  return (
    <Card padded={false}>
      {transfers.map((t) => (
        <ListRow
          key={t.id}
          icon={t.kind === 'add' ? 'plus' : t.kind === 'end' ? 'close' : 'arrow'}
          iconTone={t.kind === 'add' ? 'lime' : 'blue'}
          title={`${t.player_name} · ${transferKindLabel[t.kind]}`}
          subtitle={[
            [teamName(t.from_team_id), teamName(t.to_team_id)].filter(Boolean).join(' ← '),
            new Date(t.effective_on).toLocaleDateString('he-IL'),
            t.reason,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------- transfer */

function TransferSheet({
  player,
  teams,
  programName,
  onClose,
  onDone,
}: {
  player: ClubPlayer;
  teams: ClubTeam[];
  programName: (t: ClubTeam) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const current = player.assignments.map((a) => a.team_id);
  const targets = teams.filter((t) => !current.includes(t.id));
  const primary = player.assignments.find((a) => a.is_primary) ?? player.assignments[0];
  const [mode, setMode] = useState<'move' | 'add' | 'end'>('move');
  const [from, setFrom] = useState(primary?.team_id ?? '');
  const [to, setTo] = useState(targets[0]?.id ?? '');
  const [shirt, setShirt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'end') {
        await endAssignment(player.id, from, reason);
      } else {
        await transferPlayer({
          playerId: player.id,
          toTeamId: to,
          mode,
          fromTeamId: mode === 'move' ? from : null,
          reason,
          shirt: shirt ? Number(shirt) : null,
        });
      }
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const teamLabel = (t: ClubTeam) => `${t.name} (${programName(t)})`;

  return (
    <BottomSheet open onClose={onClose} title={`העברת ${player.name}`}>
      <form className="ip-stack ip-stack--tight" onSubmit={submit}>
        <Segmented
          label="סוג הפעולה"
          value={mode}
          onChange={setMode}
          items={[
            { id: 'move', label: 'מעבר' },
            { id: 'add', label: 'גם וגם' },
            { id: 'end', label: 'סיום' },
          ]}
        />
        <p className="ip-muted ip-club-hint">
          <Icon name="shield" size={14} />{' '}
          {mode === 'move'
            ? 'השחקן עוזב קבוצה אחת ומצטרף לאחרת. ההיסטוריה, הנוכחות והמדדים נשמרים בפרופיל שלו.'
            : mode === 'add'
              ? 'השחקן נשאר בקבוצה הנוכחית ומצטרף גם לקבוצה נוספת, למשל אקדמיה וליגה במקביל.'
              : 'השחקן יוצא מהקבוצה בלי להצטרף לאחרת. הפרופיל וההיסטוריה נשמרים.'}
        </p>
        {mode !== 'add' && (
          <Field label={mode === 'end' ? 'מאיזו קבוצה' : 'מקבוצה'}>
            <select className="ip-input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {player.assignments.map((a) => {
                const t = teams.find((x) => x.id === a.team_id);
                return (
                  <option key={a.id} value={a.team_id}>
                    {t ? teamLabel(t) : a.team_id}
                  </option>
                );
              })}
            </select>
          </Field>
        )}
        {mode !== 'end' && (
          <>
            <Field label="לקבוצה">
              {targets.length === 0 ? (
                <p className="ip-muted">אין במועדון קבוצה נוספת שהשחקן לא נמצא בה.</p>
              ) : (
                <select className="ip-input" value={to} onChange={(e) => setTo(e.target.value)}>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {teamLabel(t)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="מספר חולצה בקבוצה החדשה (לא חובה)">
              <input className="ip-input" inputMode="numeric" value={shirt} onChange={(e) => setShirt(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </Field>
          </>
        )}
        <Field label="סיבה (לא חובה)">
          <input className="ip-input" value={reason} maxLength={200} placeholder="למשל: החלטה מקצועית" onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" disabled={busy || (mode !== 'end' && !to) || (mode !== 'add' && !from)}>
          {busy ? 'שומר…' : mode === 'end' ? 'סיום שיוך' : mode === 'add' ? 'הוספה לקבוצה' : 'ביצוע מעבר'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
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
