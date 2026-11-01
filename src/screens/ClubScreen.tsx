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
import { birthYearsLabel, searchTeams, type TeamHit } from '../lib/joinApi';
import {
  adoptTeam,
  clubError,
  clubRoleLabel,
  clubStatusLabel,
  createClub,
  getClubData,
  getMyClubs,
  programKindLabel,
  requestVerification,
  setTeamProgram,
  transferKindLabel,
  transferPlayer,
  endAssignment,
  type Assignment,
  type Club,
  type ClubData,
  type ClubTeam,
  type Program,
} from '../lib/clubApi';
import { ClubDashboard } from './ClubDashboard';
import { ClubStaffSection } from './ClubStaffSection';
import '../theme/club.css';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);

type Tab = 'overview' | 'teams' | 'players' | 'transfers' | 'staff';

interface ClubPlayer {
  id: string;
  name: string;
  birthYear: number | null;
  assignments: Assignment[];
}

export function ClubScreen({ clubId, onBack }: { clubId?: string; onBack: () => void }) {
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

  const club = clubs?.find((c) => c.id === clubId) ?? clubs?.[0];

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
                </button>
              ))}
            </div>
          )}
          <ClubPanel key={club.id} club={club} onChanged={loadClubs} />
          <NewClubCard compact onCreated={(id) => loadClubs().then(() => (window.location.hash = `club/${id}`))} />
        </>
      ) : (
        <NewClubCard onCreated={(id) => loadClubs().then(() => (window.location.hash = `club/${id}`))} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- new club */

function NewClubCard({ onCreated, compact }: { onCreated: (id: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createClub(name, city));
      setName('');
      setCity('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="ghost" icon="plus" onClick={() => setOpen(true)}>
        פתיחת מועדון נוסף
      </Button>
    );
  }
  return (
    <Card>
      <form className="ip-stack ip-stack--tight" onSubmit={submit}>
        <h2 className="ip-club-h2">פתיחת מועדון</h2>
        <p className="ip-muted">
          המועדון נפתח כטיוטה, עם שתי מסגרות: ליגה ואקדמיה. כדי לקבל גישה מלאה כמועדון רשמי, שולחים בקשת אימות לצוות iplays.
        </p>
        <Field label="שם המועדון">
          <input className="ip-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="עיר">
          <input className="ip-input" value={city} maxLength={60} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? 'פותח…' : 'פתיחת מועדון'}
        </Button>
      </form>
    </Card>
  );
}

/* ---------------------------------------------------------------- panel */

function ClubPanel({ club, onChanged }: { club: Club; onChanged: () => void }) {
  const auth = useAuth();
  const [data, setData] = useState<ClubData | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<ClubPlayer | null>(null);
  const manage = club.role === 'owner' || club.role === 'admin';

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

      <Segmented
        label="תצוגה"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'סקירה' },
          { id: 'teams', label: 'קבוצות' },
          { id: 'players', label: 'שחקנים' },
          { id: 'transfers', label: 'מעברים' },
          ...(manage ? [{ id: 'staff' as const, label: 'צוות' }] : []),
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
          <ClubDashboard programs={data.programs} teams={data.teams} />
          <SectionHeader title="מעברים אחרונים" icon="arrow" action={data.transfers.length ? 'הכול' : undefined} onAction={() => setTab('transfers')} />
          <TransferList transfers={data.transfers.slice(0, 5)} teamName={(id) => teamById.get(id ?? '')?.name} />
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
          {manage && <AdoptSection clubId={club.id} programs={data.programs} onAdopted={load} />}
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
      ) : (
        <section className="ip-stack">
          <SectionHeader title="היסטוריית מעברים" icon="arrow" />
          <TransferList transfers={data.transfers} teamName={(id) => teamById.get(id ?? '')?.name} />
        </section>
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

/** Teams that parents opened with no coach or club yet: the club can take them in. */
function AdoptSection({ clubId, programs, onAdopted }: { clubId: string; programs: Program[]; onAdopted: () => Promise<void> }) {
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [hits, setHits] = useState<TeamHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const by = year.length === 4 ? Number(year) : null;

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const all = await searchTeams(q.trim().length >= 2 ? q : '', by);
      setHits(all.filter((t) => !t.club_id && !t.has_staff));
    } catch (err) {
      setError(errText(err));
    }
  }

  async function adopt(t: TeamHit, programId: string) {
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
      <SectionHeader title="קבוצות שהורים פתחו" icon="plus" />
      <Card>
        <form className="ip-form" onSubmit={search}>
          <p className="ip-muted">קבוצות שנפתחו על ידי הורים, בלי מאמן ובלי מועדון. אחרי הצירוף המועדון מנהל אותן ומאשר הצטרפות.</p>
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
          <p className="ip-muted">לא נמצאו קבוצות פתוחות בלי מאמן.</p>
        ) : (
          hits.map((t) => (
            <div key={t.team_id} className="ip-club-row">
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">{t.name}</span>
                <span className="ip-list-row-sub">{[t.club_name, birthYearsLabel(t.birth_year_from, t.birth_year_to), `${t.players} שחקנים`].filter(Boolean).join(' · ')}</span>
              </span>
              {programs.map((p) => (
                <Button key={p.id} variant="secondary" size="sm" onClick={() => void adopt(t, p.id)}>
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
