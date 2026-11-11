import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { roleLabel, type MyTeam } from '../lib/api';
import { getMyClubs } from '../lib/clubApi';
import { supabase } from '../lib/supabase';
import { envLabel } from './env';
import { findModule, modules, type OsModule } from './modules';
import { NoData, NotBuilt, StatusBadge } from './StateView';
import { TeamsScreen } from './TeamsScreen';
import { StatusScreen } from './StatusScreen';
import { HomeScreen } from './HomeScreen';
import { CalendarScreen } from './CalendarScreen';
import { PlayerScreen } from './PlayerScreen';
import { LibraryScreen } from './LibraryScreen';
import { PlansScreen } from './PlansScreen';
import { TrainingDayScreen } from './TrainingDayScreen';
import { DashboardScreen } from './DashboardScreen';
import { InterventionsScreen } from './InterventionsScreen';
import './obsidian.css';

function readOsHash() {
  const [, section, param, sub] = window.location.hash.replace('#', '').split('/');
  return { section: section || '', param, sub };
}

/** Screens that work without a staff team (club owner / manager / any staff). */
const teamFreeScreens = new Set(['library', 'dashboard', 'interventions', 'status']);

const TEAM_KEY = 'iplays.os.team';
function readTeamChoice(): string | null {
  try {
    return localStorage.getItem(TEAM_KEY);
  } catch {
    return null;
  }
}
function saveTeamChoice(id: string) {
  try {
    localStorage.setItem(TEAM_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}

const THEME_KEY = 'iplays.os.theme';
type Theme = 'dark' | 'light';
function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

/** Staff roles see the Club OS; a parent-only account gets a clear note instead. */
const staffRoles = new Set(['admin', 'coach', 'assistant_coach', 'instructor', 'team_manager']);

/** Teams of the clubs where this account is owner or admin. */
async function loadClubTeams(): Promise<MyTeam[]> {
  const clubs = (await getMyClubs()).filter((c) => c.role === 'owner' || c.role === 'admin');
  if (!clubs.length || !supabase) return [];
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, club, season, sport, league')
    .in('club_id', clubs.map((c) => c.id))
    .is('archived_at', null)
    .order('name');
  if (error) throw error;
  return ((data ?? []) as Omit<MyTeam, 'role'>[]).map((t) => ({ ...t, role: 'admin' as MyTeam['role'] }));
}

export function OsApp() {
  const auth = useAuth();
  const [{ section, param, sub }, setLoc] = useState(readOsHash);
  useEffect(() => {
    const on = () => setLoc(readOsHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const ownTeams = auth.teams.filter((t) => staffRoles.has(t.role));
  // Club owner/admin: every team of the club (the database already gives them full access).
  const [clubTeams, setClubTeams] = useState<MyTeam[]>([]);
  useEffect(() => {
    let live = true;
    loadClubTeams()
      .then((t) => live && setClubTeams(t))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [auth.session?.user.id]);
  const clubOnly = new Set(clubTeams.filter((t) => !ownTeams.some((o) => o.id === t.id)).map((t) => t.id));
  const staffTeams = [...ownTeams, ...clubTeams.filter((t) => clubOnly.has(t.id))];
  const [teamId, setTeamId] = useState<string | null>(readTeamChoice);
  const team: MyTeam | undefined = staffTeams.find((t) => t.id === teamId) ?? staffTeams[0];
  const pickTeam = (id: string) => {
    setTeamId(id);
    saveTeamChoice(id);
  };

  const [theme, setTheme] = useState<Theme>(readTheme);
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* the choice lasts for this visit only */
    }
  };

  const noTeam = staffTeams.length === 0;
  // No staff team (e.g. a club owner): open on the director dashboard instead of an empty roster.
  const active = findModule(section) ?? (noTeam ? findModule('dashboard') ?? modules[0] : modules[0]);
  const go = (id: string) => {
    window.location.hash = `os/${id}`;
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="os" dir="rtl" data-theme={theme}>
      {envLabel && (
        <div className="os-envbar" role="note">
          סביבת {envLabel} · נתונים בדויים בלבד
        </div>
      )}
      <div className="os-layout">
        <nav className="os-side" aria-label="ניווט Club OS">
          <div className="os-brand">
            iPlays <span>Club OS</span>
          </div>
          {modules.map((m) => (
            <NavItem key={m.id} m={m} active={m.id === active.id} onClick={() => go(m.id)} />
          ))}
          <a className="os-side__v1" href="#home">
            חזרה ל-iPlays הרגיל
          </a>
        </nav>

        <div className="os-body">
          <header className="os-top">
            <div>
              <h1>{active.label}</h1>
              <StatusBadge status={active.status} />
            </div>
            <button type="button" className="os-theme-btn" onClick={toggleTheme} aria-pressed={theme === 'light'}>
              {theme === 'dark' ? 'תצוגה בהירה' : 'תצוגה כהה'}
            </button>
            {staffTeams.length > 0 && (
              <label className="os-teampick">
                <span className="os-muted">קבוצה</span>
                <select value={team?.id} onChange={(e) => pickTeam(e.target.value)}>
                  {staffTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {clubOnly.has(t.id) ? 'הנהלת מועדון' : roleLabel[t.role]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>

          <main className="os-main">
            {noTeam && !teamFreeScreens.has(active.id) ? (
              <section className="os-state">
                <h2>המסך הזה שייך לקבוצה</h2>
                <p className="os-muted">
                  החשבון הזה לא רשום כמאמן, עוזר או מנהל באף קבוצה, ולכן אין כאן סגל, יומן או מערכי אימון.
                  {' '}ספריית התרגילים ודשבורד המנהל פתוחים גם בלי קבוצה.
                  {envLabel && ' ב-Staging: הרץ את staging_make_me_staff עם האימייל שלך.'}
                </p>
                <div className="os-state__actions">
                  <a className="os-btn" href="#os/dashboard">קוקפיט מנהל</a>
                  <a className="os-btn" href="#os/library">ספריית תרגילים</a>
                </div>
              </section>
            ) : active.id === 'teams' ? (
              <TeamsScreen team={team!} playerId={param} />
            ) : active.id === 'home' ? (
              <HomeScreen key={team!.id} team={team!} />
            ) : active.id === 'calendar' ? (
              <CalendarScreen key={team!.id} team={team!} sessionId={param} />
            ) : active.id === 'player' ? (
              param ? <PlayerScreen playerId={param} /> : <NoData>בחר שחקן מהסגל (קבוצות וסגל)</NoData>
            ) : active.id === 'library' ? (
              <LibraryScreen key={`${param ?? ''}/${sub ?? ''}`} param={param} sub={sub} />
            ) : active.id === 'plans' ? (
              <PlansScreen key={`${team!.id}/${param ?? ''}`} team={team!} param={param} />
            ) : active.id === 'day' ? (
              <TrainingDayScreen key={`${team!.id}/${param ?? ''}`} team={team!} sessionId={param} />
            ) : active.id === 'dashboard' ? (
              <DashboardScreen />
            ) : active.id === 'interventions' ? (
              <InterventionsScreen id={param} />
            ) : active.id === 'status' ? (
              <StatusScreen />
            ) : (
              <NotBuilt module={active} />
            )}
          </main>
          {active.id !== 'status' && (
            <a className="os-phone-only os-back" href="#os/status">
              מה עובד ומה עוד לא
            </a>
          )}
        </div>
      </div>

      <nav className="os-bottom" aria-label="ניווט Club OS">
        {modules
          .filter((m) => (noTeam ? ['dashboard', 'interventions', 'library', 'status'] : ['teams', 'home', 'calendar', 'plans', 'library']).includes(m.id))
          .map((m) => (
            <NavItem key={m.id} m={m} active={m.id === active.id} onClick={() => go(m.id)} compact />
          ))}
      </nav>
    </div>
  );
}

function NavItem({ m, active, onClick, compact }: { m: OsModule; active: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" className={`os-nav${active ? ' is-active' : ''}${m.status === 'planned' ? ' is-planned' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Icon name={m.icon} size={compact ? 22 : 18} />
      <span>{m.label}</span>
      {!compact && m.status !== 'live' && <small>יום {m.day}</small>}
    </button>
  );
}
