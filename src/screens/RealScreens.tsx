/**
 * Main tabs for a signed-in user who is NOT viewing the sample data.
 * They show only the user's own data: their teams and the children linked to
 * them. A user without a team sees an empty state with a search button and,
 * until they belong to a real team, a link to the sample view.
 */
import { useCallback, useEffect, useState } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, ListRow, SectionHeader, Tag, TeamCrest } from '../components/ui';
import { ScreenTitle } from '../components/shell';
import { useAuth } from '../auth/AuthContext';
import { getRoster, isStaffRole, roleLabel, sportLabel, type MyTeam, type Player } from '../lib/api';
import { competitionLabel, getMatches, matchEndsAt, matchIsLive, matchTimeLabel, matchVenueLabel, matchVenueName, wazeUrl, type Match } from '../lib/matchApi';
import { absenceCoversEvent, supabaseCoach, ymd, type Absence, type TrainingSession } from '../lib/coachApi';
import { isGoalkeeperPosition, overlapping, trainingTypeLabel } from '../lib/calendarApi';
import { AddTrainingButton, KidsAttendance } from './CalendarExtras';
import { AccountSection, RequestsSection } from './AccountSection';
import { MyTeamScreen } from './MyTeamScreen';
import { FamilyInviteCard, FamilyMembersSection } from './FamilySection';
import { isPlatformAdmin } from '../lib/ifaApi';
import { sportProfile } from '../lib/sports';
import { getRidesSummary, summaryLabel, type RideSummary } from '../lib/rideApi';
import { RidesSheet, type RideEvent } from './RidesSheet';
import { RosterReviewHomeCard } from './RosterReview';
import { MatchConflictsHomeCard } from './MatchOverrides';
import { LeagueHomeCard } from './LeagueTable';

const goFind = () => (window.location.hash = 'find');
const goTeam = (id: string) => (window.location.hash = `myteam/${id}`);

/** The children linked to me, across all my teams. */
export function useMyKids(): (Player & { team: MyTeam })[] | null {
  const { session, teams } = useAuth();
  const me = session?.user.id;
  const [kids, setKids] = useState<(Player & { team: MyTeam })[] | null>(null);
  const key = teams.map((t) => t.id).join(',');
  useEffect(() => {
    let alive = true;
    if (!me || !teams.length) {
      setKids([]);
      return;
    }
    Promise.all(teams.map((t) => getRoster(t.id).then((r) => r.filter((p) => p.guardians.includes(me)).map((p) => ({ ...p, team: t }))).catch(() => [])))
      .then((all) => alive && setKids(all.flat()))
      .catch(() => alive && setKids([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, key]);
  return kids;
}

/**
 * Top-bar pill for a signed-in user: their own child (tap: the child's team),
 * or "הוספת ילד" when no child is linked yet.
 */
export function RealChildPill() {
  const kids = useMyKids();
  if (kids === null) return null;
  if (!kids.length) {
    return (
      <button type="button" className="ip-child-pill ip-child-pill--compact" onClick={goFind} aria-label="הוספת הילד שלי">
        <Icon name="plus" size={18} />
        <span className="ip-child-pill-name">הוספת ילד</span>
      </button>
    );
  }
  const k = kids[0];
  const more = kids.length > 1;
  return (
    <button
      type="button"
      className="ip-child-pill ip-child-pill--compact"
      onClick={() => (more ? (window.location.hash = 'family') : goTeam(k.team.id))}
      aria-label={more ? 'הילדים שלי' : `${k.first_name}: דף הקבוצה`}
    >
      <InitialsAvatar name={`${k.first_name} ${k.last_name}`} size={32} tone="lime" />
      <span className="ip-child-pill-name">
        {k.first_name.split(' ')[0]}
        {more ? ` +${kids.length - 1}` : ''}
      </span>
    </button>
  );
}

/** Top-bar button for a signed-out visitor browsing the sample data. */
export function SignInPill({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ip-child-pill ip-child-pill--compact" onClick={onClick}>
      <Icon name="user" size={18} />
      <span className="ip-child-pill-name">כניסה</span>
    </button>
  );
}

function teamSub(t: MyTeam) {
  return [t.league, t.club, sportLabel[t.sport], roleLabel[t.role]].filter(Boolean).join(' · ');
}

/** No team yet: search first; the sample view is offered only here. */
export function NoTeam({ onShowSample }: { onShowSample: () => void }) {
  return (
    <Card>
      <EmptyState icon="team" title="עוד לא הצטרפת לקבוצה" text="חפשו את הקבוצה של הילד (לפי שם או שנתון) והצהירו שזה הילד שלכם. כאן יופיעו האימונים, המשחקים וההודעות של הקבוצה." />
      <div className="ip-btn-row">
        <Button variant="primary" icon="eye" onClick={goFind}>
          חיפוש הקבוצה או הילד
        </Button>
      </div>
      <p className="ip-footnote ip-center">
        <button type="button" className="ip-link" onClick={onShowSample}>
          הצגה לדוגמה: איך האפליקציה נראית עם נתונים
        </button>
      </p>
    </Card>
  );
}

function TeamsList({ teams }: { teams: MyTeam[] }) {
  return (
    <Card padded={false}>
      {teams.map((t) => (
        <ListRow key={t.id} icon="team" iconTone={isStaffRole(t.role) ? 'navy' : 'blue'} title={t.name} subtitle={teamSub(t)} trailing={<TeamCrest name={t.club || t.name} size={36} />} onClick={() => goTeam(t.id)} />
      ))}
    </Card>
  );
}

/** The team's working screens, one tap from Home. */
function TeamShortcuts({ team, showName }: { team: MyTeam; showName?: boolean }) {
  const matches = sportProfile(team.sport).hasMatches;
  const items: { icon: 'whistle' | 'ball' | 'check' | 'team'; tone: string; title: string; sub: string; href: string }[] = [
    { icon: 'whistle', tone: 'lime', title: 'לוח הקבוצה', sub: 'אימונים, הודעות מהמאמן, דיווח איחור / אי־הגעה', href: `coach/${team.id}` },
    { icon: matches ? 'ball' : 'check', tone: 'blue', title: matches ? 'משחקים והרכבים' : 'נוכחות', sub: matches ? 'לוח משחקים, הרכבים ותוצאות' : 'נוכחות באימונים', href: `matches/${team.id}` },
    { icon: 'team', tone: 'blue', title: 'דף הקבוצה', sub: 'הילד שלי, חולצה וציוד, הסגל וההורים', href: `myteam/${team.id}` },
  ];
  return (
    <section className="ip-stack ip-stack--tight">
      {showName && <SectionHeader title={team.name} icon="team" />}
      {items.map((it) => (
        <button key={it.href} type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = it.href)}>
          <span className={`ip-icon-tile ip-icon-tile--${it.tone}`}>
            <Icon name={it.icon} size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">{it.title}</span>
            <span className="ip-list-row-sub">{it.sub}</span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
      ))}
    </section>
  );
}

/** Home with one child: the child and their team, no lists. */
function ChildHero({ k }: { k: Player & { team: MyTeam } }) {
  const name = `${k.first_name} ${k.last_name}`.trim();
  const superAdmin = useSuperAdmin();
  return (
    <Card tone="navy" className="ip-team-hero">
      <button type="button" className="ip-team-hero-id ip-child-hero" onClick={() => goTeam(k.team.id)}>
        <InitialsAvatar name={name} size={56} tone="lime" />
        <div>
          <h1>{name}</h1>
          <p>{k.team.name}</p>
          <p className="ip-on-navy-muted">{[k.team.league, k.birth_year && `שנתון ${k.birth_year}`, k.shirt_number != null && `חולצה ${k.shirt_number}`].filter(Boolean).join(' · ')}</p>
        </div>
      </button>
      {superAdmin && (
        <button type="button" className="ip-link ip-hero-admin" onClick={() => (window.location.hash = 'admin')}>
          <Icon name="shield" size={16} /> פאנל ניהול על
        </button>
      )}
    </Card>
  );
}

/** Platform admin (Super Admin); false for everyone else and while loading. */
function useSuperAdmin() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void isPlatformAdmin().then(setOn);
  }, []);
  return on;
}

export function RealHomeScreen({ onShowSample }: { onShowSample: () => void }) {
  const { profile, teams } = useAuth();
  const kids = useMyKids();
  const first = profile?.full_name?.split(' ')[0];
  const isClub = !!profile?.account_types?.includes('club');
  const isParent = !profile?.account_types?.length || profile.account_types.includes('parent');
  return (
    <div className="ip-stack">
      <ScreenTitle title={first ? `שלום ${first}` : 'שלום'} subtitle={teams.length ? 'הקבוצות והילדים שלך' : undefined} />
      <RequestsSection />
      {(isClub || teams.some((t) => isStaffRole(t.role))) && (
        <>
          <RosterReviewHomeCard />
          <MatchConflictsHomeCard />
        </>
      )}
      {isClub && (
        <button type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = 'club')}>
          <span className="ip-icon-tile ip-icon-tile--navy">
            <Icon name="shield" size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">ניהול מועדון</span>
            <span className="ip-list-row-sub">קבוצות ליגה ואקדמיה, צוות, שחקנים ומעברים</span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
      )}
      {!teams.length ? (
        isParent ? <NoTeam onShowSample={onShowSample} /> : null
      ) : (
        <>
          {kids && kids.length === 1 && <ChildHero k={kids[0]} />}
          <NextUp teams={teams} />
          {teams.map((t) => (
            <LeagueHomeCard key={`league-${t.id}`} teamId={t.id} teamName={teams.length > 1 ? t.name : undefined} />
          ))}
          {teams.map((t) => (
            <TeamShortcuts key={t.id} team={t} showName={teams.length > 1} />
          ))}
          {kids && kids.length > 1 && (
            <section>
              <SectionHeader title="הילדים שלי" icon="user" />
              <Card padded={false}>
                {kids.map((k) => (
                  <ListRow
                    key={`${k.id}-${k.team.id}`}
                    icon="user"
                    iconTone="lime"
                    title={`${k.first_name} ${k.last_name}`.trim()}
                    subtitle={[k.team.name, k.birth_year && `שנתון ${k.birth_year}`, k.shirt_number != null && `חולצה ${k.shirt_number}`].filter(Boolean).join(' · ')}
                    trailing={<InitialsAvatar name={`${k.first_name} ${k.last_name}`} size={36} tone="lime" />}
                    onClick={() => goTeam(k.team.id)}
                  />
                ))}
              </Card>
            </section>
          )}
          {(!kids || teams.some((t) => !kids.some((k) => k.team.id === t.id))) && (
            <section>
              <SectionHeader title="הקבוצות שלי" icon="team" />
              <TeamsList teams={kids ? teams.filter((t) => !kids.some((k) => k.team.id === t.id)) : teams} />
            </section>
          )}
          {kids && kids.length === 0 && (
            <Card>
              <p className="ip-muted">עוד לא סימנת את הילד שלך בקבוצה.</p>
              <div className="ip-btn-row">
                <Button variant="primary" icon="user" onClick={() => goTeam(teams[0].id)}>
                  סימון הילד שלי
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export function RealTeamsScreen({ onShowSample }: { onShowSample: () => void }) {
  const { teams } = useAuth();
  // One team: the team tab is that team's page.
  if (teams.length === 1) return <MyTeamScreen teamId={teams[0].id} onBack={() => (window.location.hash = 'home')} />;
  return (
    <div className="ip-stack">
      <ScreenTitle title="הקבוצות שלי" />
      {!teams.length ? (
        <NoTeam onShowSample={onShowSample} />
      ) : (
        <>
          <TeamsList teams={teams} />
          <div className="ip-btn-row">
            <Button variant="secondary" icon="plus" onClick={goFind}>
              הצטרפות לקבוצה נוספת
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type TeamEvent = {
  key: string;
  kind: 'training' | 'match';
  eventId: string;
  rides?: RideSummary;
  at: number;
  endsAt: number;
  title: string;
  time: string;
  place: string | null;
  navigateTo: string;
  tag?: string;
  team: MyTeam;
  href: string;
  canceled: boolean;
  /** a match being played now (live reporting open) */
  live?: boolean;
  /** trainings: type, audience and participants */
  training?: TrainingSession;
};

const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
const hhmm = (d: Date) => d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/** Upcoming trainings and matches (club + IFA league games) of all my teams. */
function useTeamEvents(teams: MyTeam[]): [TeamEvent[] | null, () => void] {
  const [events, setEvents] = useState<TeamEvent[] | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const key = teams.map((t) => t.id).join(',');
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    Promise.all(
      teams.map(async (t) => {
        const [matches, sessions, rides] = await Promise.all([
          getMatches(t.id).catch(() => [] as Match[]),
          supabaseCoach(t.id).listSessions().catch(() => [] as TrainingSession[]),
          getRidesSummary(t.id).catch(() => [] as RideSummary[]),
        ]);
        const rideOf = (kind: 'training' | 'match', id: string) => rides.find((r) => r.kind === kind && r.event_id === id);
        const ms: TeamEvent[] = matches
          .filter((m) => m.status !== 'canceled')
          .map((m) => ({
            key: `m-${m.id}`,
            kind: 'match' as const,
            eventId: m.id,
            rides: rideOf('match', m.id),
            at: new Date(m.starts_at).getTime(),
            endsAt: matchEndsAt(m),
            title: `${m.home ? 'נגד' : 'אצל'} ${m.opponent}`,
            time: matchTimeLabel(m),
            place: matchVenueLabel(m),
            navigateTo: matchVenueName(m),
            tag: competitionLabel[m.competition],
            team: t,
            href: `matches/${m.team_id}/${m.id}`,
            canceled: false,
            live: matchIsLive(m),
          }));
        const ts: TeamEvent[] = sessions.map((x) => {
          const d = new Date(x.starts_at);
          return {
            key: `t-${x.id}`,
            kind: 'training' as const,
            eventId: x.id,
            rides: rideOf('training', x.id),
            at: d.getTime(),
            endsAt: d.getTime() + (x.duration_min || 90) * 60_000,
            title: x.title || 'אימון',
            time: hhmm(d),
            place: x.location || null,
            navigateTo: x.location || '',
            team: t,
            href: `coach/${t.id}`,
            canceled: x.canceled,
            tag: trainingTypeLabel(x.kind, x.audience) ?? undefined,
            training: x,
          };
        });
        return [...ms, ...ts];
      }),
    )
      .then((all) => {
        if (!alive) return;
        setEvents(all.flat().filter((e) => e.endsAt >= now).sort((a, b) => a.at - b.at));
      })
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  return [events, reload];
}

const rideEventOf = (e: TeamEvent): RideEvent => ({
  kind: e.kind,
  id: e.eventId,
  title: e.title,
  when: [dayFmt.format(new Date(e.at)), e.time, e.place].filter(Boolean).join(' · '),
});

/** The rides sheet for one event, with my children in that event's team. */
function useRidesSheet(onChanged: () => void) {
  const { session } = useAuth();
  const kids = useMyKids();
  const [open, setOpen] = useState<TeamEvent | null>(null);
  const sheet = (
    <RidesSheet
      event={open ? rideEventOf(open) : null}
      me={session?.user.id ?? ''}
      myKids={open && kids ? kids.filter((k) => k.team.id === open.team.id).map((k) => ({ id: k.id, first_name: k.first_name })) : []}
      onClose={() => setOpen(null)}
      onChanged={onChanged}
    />
  );
  return [sheet, setOpen] as const;
}

function RidesLine({ e, onOpen }: { e: TeamEvent; onOpen: () => void }) {
  if (e.canceled) return null;
  const label = summaryLabel(e.rides);
  return (
    <button type="button" className="ip-rides-line" onClick={onOpen}>
      <Icon name="car" size={16} />
      <span>{label ? `הסעות: ${label}` : 'הסעות: מציעים או מבקשים הסעה'}</span>
    </button>
  );
}

function EventCard({ label, e, onRides }: { label: string; e: TeamEvent; onRides: () => void }) {
  return (
    <Card className="ip-next-event">
      <div className="ip-next-event-head">
        {e.live ? (
          <Tag tone="live" icon="live">
            LIVE · דיווח גולים
          </Tag>
        ) : (
          <Tag tone={e.kind === 'match' ? 'blue' : 'lime'} icon={e.kind === 'match' ? 'ball' : 'whistle'}>
            {label}
          </Tag>
        )}
        {e.tag && <Tag>{e.tag}</Tag>}
        {e.canceled && <Tag tone="warning">בוטל</Tag>}
      </div>
      <button type="button" className="ip-next-event-body" onClick={() => (window.location.hash = e.href)}>
        <strong>{e.title}</strong>
        <span>
          {dayFmt.format(new Date(e.at))} · {e.time}
        </span>
        {e.place && <span className="ip-muted">{e.place}</span>}
        <span className="ip-muted">{e.team.name}</span>
      </button>
      {e.navigateTo && (
        <a className="ip-link" href={wazeUrl(e.navigateTo)} target="_blank" rel="noreferrer">
          <Icon name="navigate" size={16} /> ניווט ב-Waze
        </a>
      )}
      <RidesLine e={e} onOpen={onRides} />
    </Card>
  );
}

/** Home: the next training and the next match. */
function NextUp({ teams }: { teams: MyTeam[] }) {
  const [events, reload] = useTeamEvents(teams);
  const [sheet, openRides] = useRidesSheet(reload);
  if (events === null) return <p className="ip-muted">טוען את האימון והמשחק הקרובים…</p>;
  const training = events.find((e) => e.kind === 'training' && !e.canceled);
  const match = events.find((e) => e.kind === 'match');
  return (
    <section>
      <SectionHeader title="הקרוב" icon="calendar" />
      <div className="ip-stack">
        {training ? <EventCard label="האימון הקרוב" e={training} onRides={() => openRides(training)} /> : <Card>
            <p className="ip-muted">עוד אין אימון קרוב ביומן.</p>
            <div className="ip-btn-row">
              <Button variant="secondary" icon="whistle" onClick={() => (window.location.hash = `coach/${teams[0].id}`)}>
                ללוח האימונים
              </Button>
            </div>
          </Card>}
        {match ? <EventCard label="המשחק הקרוב" e={match} onRides={() => openRides(match)} /> : <Card><p className="ip-muted">אין משחק קרוב ביומן.</p></Card>}
      </div>
      {sheet}
    </section>
  );
}

/** Absence reports I may see (my children's; staff: the team's), per team. */
function useTeamAbsences(teams: MyTeam[]): Absence[] {
  const [list, setList] = useState<Absence[]>([]);
  const key = teams.map((t) => t.id).join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(teams.map((t) => supabaseCoach(t.id).listAbsences().catch(() => [] as Absence[])))
      .then((all) => alive && setList(all.flat()))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list;
}

type Kid = Player & { team: MyTeam };

/** My children expected at an event (team trainings / matches: all my kids in the team). */
function kidsAt(e: TeamEvent, kids: Kid[]): Kid[] {
  const inTeam = kids.filter((k) => k.team.id === e.team.id);
  const s = e.training;
  if (!s || !s.audience || s.audience === 'team') return inTeam;
  if (s.audience === 'goalkeepers') return inTeam.filter((k) => isGoalkeeperPosition(k.position));
  return inTeam.filter((k) => (s.participants ?? []).includes(k.id));
}

/**
 * Calendar: every upcoming training (team, goalkeeper, personal) and match of
 * all my children's teams in one list, by day, with clash warnings per child
 * and the absences already reported.
 */
function Agenda({ teams }: { teams: MyTeam[] }) {
  const [events, reload] = useTeamEvents(teams);
  const [sheet, openRides] = useRidesSheet(reload);
  const { session } = useAuth();
  const kids = useMyKids() ?? [];
  const absences = useTeamAbsences(teams);
  const [only, setOnly] = useState<string>('all');
  if (events === null) return <p className="ip-muted">טוען…</p>;

  const uniqueKids = [...new Map(kids.map((k) => [k.id, k])).values()];
  const kidsOf = new Map(events.map((e) => [e.key, kidsAt(e, kids)]));
  // events of my children (a staff member without children sees everything)
  const me = session?.user.id;
  const relevant = events.filter(
    (e) => e.kind === 'match' || isStaffRole(e.team.role) || (kidsOf.get(e.key) ?? []).length > 0 || e.training?.created_by === me || !kids.some((k) => k.team.id === e.team.id),
  );
  const shown = only === 'all' ? relevant : relevant.filter((e) => (kidsOf.get(e.key) ?? []).some((k) => k.id === only));

  // clashes: per child, or across everything for staff
  const clash = new Set<string>();
  if (uniqueKids.length) {
    for (const k of uniqueKids) overlapping(relevant.filter((e) => (kidsOf.get(e.key) ?? []).some((x) => x.id === k.id))).forEach((x) => clash.add(x));
  } else {
    overlapping(relevant).forEach((x) => clash.add(x));
  }
  const clashCount = shown.filter((e) => clash.has(e.key)).length;
  const absentAt = (e: TeamEvent) =>
    (kidsOf.get(e.key) ?? []).filter((k) =>
      absences.some((a) => a.player_id === k.id && absenceCoversEvent(a, e.kind, e.eventId, ymd(new Date(e.at)))),
    );

  const days = new Map<string, TeamEvent[]>();
  for (const e of shown) {
    const k = dayFmt.format(new Date(e.at));
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  return (
    <>
      <AddTrainingButton teams={teams} kids={kids} onAdded={reload} />
      {uniqueKids.length > 1 && (
        <div className="ip-player-chips" role="group" aria-label="סינון לפי ילד">
          <button type="button" className={only === 'all' ? 'is-on' : ''} aria-pressed={only === 'all'} onClick={() => setOnly('all')}>
            כל הילדים
          </button>
          {uniqueKids.map((k) => (
            <button key={k.id} type="button" className={only === k.id ? 'is-on' : ''} aria-pressed={only === k.id} onClick={() => setOnly(k.id)}>
              {k.first_name}
            </button>
          ))}
        </div>
      )}
      {clashCount > 0 && (
        <Card className="ip-clash-banner">
          <p>
            <strong>יש התנגשות ביומן:</strong> {clashCount} פעילויות חופפות בזמן{uniqueKids.length ? ' לאותו ילד' : ''}. הן מסומנות למטה.
          </p>
        </Card>
      )}
      {!shown.length && <EmptyState icon="calendar" title="היומן ריק" text="אימונים ומשחקים של הקבוצות שלך יופיעו כאן, כולל משחקי הליגה מההתאחדות ואימונים אישיים." />}
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <SectionHeader title={day} />
          <Card padded={false}>
            {list.map((e) => {
              const who = kidsOf.get(e.key) ?? [];
              const away = absentAt(e);
              const sub = [
                e.time,
                e.place,
                teams.length > 1 ? e.team.name : null,
                uniqueKids.length > 1 && who.length ? who.map((k) => k.first_name).join(', ') : null,
              ];
              return (
                <div key={e.key} className="ip-agenda-item">
                  <ListRow
                    icon={e.kind === 'match' ? 'ball' : e.training?.kind === 'personal' ? 'user' : 'whistle'}
                    iconTone={e.kind === 'match' ? 'blue' : e.training?.kind && e.training.kind !== 'team' ? 'navy' : 'lime'}
                    title={e.canceled ? `${e.title} (בוטל)` : e.title}
                    subtitle={sub.filter(Boolean).join(' · ')}
                    trailing={
                      <span className="ip-agenda-tags">
                        {clash.has(e.key) && <Tag tone="warning">התנגשות</Tag>}
                        {away.length > 0 && <Tag tone="navy">{who.length > 1 ? `${away.map((k) => k.first_name).join(', ')} לא מגיע/ה` : 'לא מגיע/ה'}</Tag>}
                        {e.tag && <Tag>{e.tag}</Tag>}
                      </span>
                    }
                    onClick={() => (window.location.hash = e.href)}
                  />
                  <RidesLine e={e} onOpen={() => openRides(e)} />
                </div>
              );
            })}
          </Card>
        </section>
      ))}
      <KidsAttendance kids={uniqueKids} />
      {sheet}
    </>
  );
}

export function RealCalendarScreen({ onShowSample }: { onShowSample: () => void }) {
  const { teams } = useAuth();
  return (
    <div className="ip-stack">
      <ScreenTitle title="יומן" subtitle={teams.length ? 'כל האימונים והמשחקים של הילדים במקום אחד' : undefined} />
      {!teams.length ? <NoTeam onShowSample={onShowSample} /> : <Agenda teams={teams} />}
    </div>
  );
}

export function RealFamilyScreen() {
  const kids = useMyKids();
  const { profile } = useAuth();
  return (
    <div className="ip-stack">
      <ScreenTitle title="החשבון שלי" subtitle={profile?.full_name || undefined} />
      <FamilyInviteCard />
      <Card padded={false}>
        <ListRow icon="wallet" iconTone="lime" title="תשלומים ומחנות" subtitle="חיובים מהמועדון, דיווח תשלום והרשמה למחנות וקייטנות" onClick={() => (window.location.hash = 'pay')} />
      </Card>
      <AccountSection />
      <section>
        <SectionHeader title="הילדים" />
        {kids && kids.length > 0 ? (
          <Card padded={false}>
            {kids.map((k) => (
              <ListRow
                key={`${k.id}-${k.team.id}`}
                icon="user"
                title={`${k.first_name} ${k.last_name}`.trim()}
                subtitle={k.team.name}
                trailing={<InitialsAvatar name={`${k.first_name} ${k.last_name}`} size={36} tone="lime" />}
                onClick={() => goTeam(k.team.id)}
              />
            ))}
          </Card>
        ) : (
          <Card>
            <p className="ip-muted">עוד אין ילדים מקושרים אליך.</p>
            <div className="ip-btn-row">
              <Button variant="secondary" icon="eye" onClick={goFind}>
                חיפוש הקבוצה או הילד
              </Button>
            </div>
          </Card>
        )}
      </section>
      <FamilyMembersSection />
    </div>
  );
}
