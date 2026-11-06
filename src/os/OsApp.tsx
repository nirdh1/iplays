import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { roleLabel, type MyTeam } from '../lib/api';
import { envLabel } from './env';
import { findModule, modules, type OsModule } from './modules';
import { NoData, NotBuilt, StatusBadge } from './StateView';
import { TeamsScreen } from './TeamsScreen';
import { StatusScreen } from './StatusScreen';
import { HomeScreen } from './HomeScreen';
import { CalendarScreen } from './CalendarScreen';
import { PlayerScreen } from './PlayerScreen';
import './obsidian.css';

function readOsHash() {
  const [, section, param] = window.location.hash.replace('#', '').split('/');
  return { section: section || 'teams', param };
}

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

/** Staff roles see the Club OS; a parent-only account gets a clear note instead. */
const staffRoles = new Set(['admin', 'coach', 'assistant_coach', 'instructor', 'team_manager']);

export function OsApp() {
  const auth = useAuth();
  const [{ section, param }, setLoc] = useState(readOsHash);
  useEffect(() => {
    const on = () => setLoc(readOsHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const staffTeams = auth.teams.filter((t) => staffRoles.has(t.role));
  const [teamId, setTeamId] = useState<string | null>(readTeamChoice);
  const team: MyTeam | undefined = staffTeams.find((t) => t.id === teamId) ?? staffTeams[0];
  const pickTeam = (id: string) => {
    setTeamId(id);
    saveTeamChoice(id);
  };

  const active = findModule(section) ?? modules[0];
  const go = (id: string) => {
    window.location.hash = `os/${id}`;
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="os" dir="rtl">
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
            {staffTeams.length > 0 && (
              <label className="os-teampick">
                <span className="os-muted">קבוצה</span>
                <select value={team?.id} onChange={(e) => pickTeam(e.target.value)}>
                  {staffTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {roleLabel[t.role]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>

          <main className="os-main">
            {staffTeams.length === 0 ? (
              <section className="os-state">
                <h2>אין לך קבוצה כאיש צוות</h2>
                <p className="os-muted">
                  Club OS מיועד למאמנים ולצוות. החשבון הזה לא רשום כמאמן, עוזר או מנהל באף קבוצה.
                  {envLabel && ' ב-Staging: הרץ את staging_make_me_staff עם האימייל שלך.'}
                </p>
              </section>
            ) : active.id === 'teams' ? (
              <TeamsScreen team={team!} playerId={param} />
            ) : active.id === 'home' ? (
              <HomeScreen key={team!.id} team={team!} />
            ) : active.id === 'calendar' ? (
              <CalendarScreen key={team!.id} team={team!} sessionId={param} />
            ) : active.id === 'player' ? (
              param ? <PlayerScreen playerId={param} /> : <NoData>בחר שחקן מהסגל (קבוצות וסגל)</NoData>
            ) : active.id === 'status' ? (
              <StatusScreen />
            ) : (
              <NotBuilt module={active} />
            )}
          </main>
        </div>
      </div>

      <nav className="os-bottom" aria-label="ניווט Club OS">
        {modules
          .filter((m) => ['teams', 'home', 'calendar', 'library', 'status'].includes(m.id))
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
