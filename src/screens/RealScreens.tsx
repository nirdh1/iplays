/**
 * Main tabs for a signed-in user who is NOT viewing the sample data.
 * They show only the user's own data: their teams and the children linked to
 * them. A user without a team sees an empty state with a search button and,
 * until they belong to a real team, a link to the sample view.
 */
import { useEffect, useState } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Button, Card, EmptyState, ListRow, SectionHeader, Tag, TeamCrest } from '../components/ui';
import { ScreenTitle } from '../components/shell';
import { useAuth } from '../auth/AuthContext';
import { getRoster, isStaffRole, roleLabel, sportLabel, type MyTeam, type Player } from '../lib/api';
import { getMatches, competitionLabel, type Match } from '../lib/matchApi';
import { AccountSection, RequestsSection } from './AccountSection';

const goFind = () => (window.location.hash = 'find');
const goTeam = (id: string) => (window.location.hash = `myteam/${id}`);

/** The children linked to me, across all my teams. */
function useMyKids(): (Player & { team: MyTeam })[] | null {
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

function teamSub(t: MyTeam) {
  return [t.league, t.club, sportLabel[t.sport], roleLabel[t.role]].filter(Boolean).join(' · ');
}

/** No team yet: search first; the sample view is offered only here. */
function NoTeam({ onShowSample }: { onShowSample: () => void }) {
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

export function RealHomeScreen({ onShowSample }: { onShowSample: () => void }) {
  const { profile, teams } = useAuth();
  const kids = useMyKids();
  const first = profile?.full_name?.split(' ')[0];
  return (
    <div className="ip-stack">
      <ScreenTitle title={first ? `שלום ${first}` : 'שלום'} subtitle={teams.length ? 'הקבוצות והילדים שלך' : undefined} />
      <RequestsSection />
      {!teams.length ? (
        <NoTeam onShowSample={onShowSample} />
      ) : (
        <>
          {kids && kids.length > 0 && (
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
          <section>
            <SectionHeader title="הקבוצות שלי" icon="team" />
            <TeamsList teams={teams} />
          </section>
          <UpcomingMatches teams={teams} limit={3} />
        </>
      )}
    </div>
  );
}

export function RealTeamsScreen({ onShowSample }: { onShowSample: () => void }) {
  const { teams } = useAuth();
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

function UpcomingMatches({ teams, limit }: { teams: MyTeam[]; limit?: number }) {
  const [rows, setRows] = useState<(Match & { team: MyTeam })[] | null>(null);
  const key = teams.map((t) => t.id).join(',');
  useEffect(() => {
    let alive = true;
    const now = Date.now() - 3 * 3600 * 1000;
    Promise.all(teams.map((t) => getMatches(t.id).then((m) => m.map((x) => ({ ...x, team: t }))).catch(() => [])))
      .then((all) => {
        if (!alive) return;
        const upcoming = all
          .flat()
          .filter((m) => m.status !== 'canceled' && new Date(m.starts_at).getTime() >= now)
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        setRows(limit ? upcoming.slice(0, limit) : upcoming);
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, limit]);

  if (rows === null) return null;
  if (!rows.length) {
    return limit ? null : <EmptyState icon="calendar" title="אין משחקים קרובים" text="משחקים שהצוות מזין יופיעו כאן." />;
  }
  const fmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <section>
      <SectionHeader title="משחקים קרובים" icon="calendar" />
      <Card padded={false}>
        {rows.map((m) => (
          <ListRow
            key={m.id}
            icon="ball"
            title={`${m.home ? 'נגד' : 'אצל'} ${m.opponent}`}
            subtitle={[fmt.format(new Date(m.starts_at)), m.venue, m.team.name].filter(Boolean).join(' · ')}
            trailing={<Tag>{competitionLabel[m.competition]}</Tag>}
            onClick={() => (window.location.hash = `matches/${m.team_id}`)}
          />
        ))}
      </Card>
    </section>
  );
}

export function RealCalendarScreen({ onShowSample }: { onShowSample: () => void }) {
  const { teams } = useAuth();
  return (
    <div className="ip-stack">
      <ScreenTitle title="יומן" subtitle={teams.length ? 'המשחקים הקרובים של הקבוצות שלך' : undefined} />
      {!teams.length ? <NoTeam onShowSample={onShowSample} /> : <UpcomingMatches teams={teams} />}
    </div>
  );
}

export function RealCareerScreen({ onShowSample }: { onShowSample: () => void }) {
  const { teams } = useAuth();
  return (
    <div className="ip-stack">
      <ScreenTitle title="קריירה" />
      {!teams.length ? (
        <NoTeam onShowSample={onShowSample} />
      ) : (
        <Card>
          <EmptyState icon="career" title="עוד אין נתונים" text="הופעות, דקות משחק ושערים יופיעו כאן אחרי שהצוות יזין משחקים והרכבים." />
        </Card>
      )}
    </div>
  );
}

export function RealFamilyScreen() {
  const kids = useMyKids();
  const { profile } = useAuth();
  return (
    <div className="ip-stack">
      <ScreenTitle title="משפחה" subtitle={profile?.full_name || undefined} />
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
    </div>
  );
}
