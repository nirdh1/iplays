import { useCallback, useEffect, useState } from 'react';
import { AppHeader, BottomNav, ChildSwitcherSheet, type TabId } from './components/shell';
import { children, parent } from './data/demo';
import { HomeScreen } from './screens/HomeScreen';
import { CareerScreen } from './screens/CareerScreen';
import { CalendarScreen, FamilyScreen } from './screens/OtherScreens';
import { TeamScreen } from './screens/TeamScreen';
import { MatchCenterScreen } from './screens/MatchCenterScreen';
import { BrandScreen } from './screens/BrandScreen';
import { AuthScreen } from './screens/AuthScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { MyTeamScreen } from './screens/MyTeamScreen';
import { DemoCoachScreen, TeamCoachScreen } from './screens/CoachScreen';
import { Logo } from './components/Logo';
import { Icon } from './components/Icon';
import { clearPendingInvite, readPendingInvite, savePendingInvite, useAuth } from './auth/AuthContext';
import { friendlyError, joinTeam } from './lib/api';

type Route = TabId | 'brand' | 'match' | 'myteam' | 'coach';
const routes: Route[] = ['home', 'team', 'calendar', 'career', 'family', 'brand', 'match', 'myteam', 'coach'];

function readHash(): { route: Route; child?: string; param?: string } {
  const [r, c] = window.location.hash.replace('#', '').split('/');
  return { route: (routes as string[]).includes(r) ? (r as Route) : 'home', child: c, param: c };
}

// Invite links look like #join/ABC234: keep the code and continue to the app.
function captureInviteFromHash() {
  const m = window.location.hash.match(/^#join\/([A-Za-z0-9]{6})$/);
  if (m) {
    savePendingInvite(m[1]);
    history.replaceState(null, '', '#home');
  }
}
captureInviteFromHash();

/**
 * Gate: with a backend configured, users sign in and finish onboarding first
 * (unless they chose to browse the demo). Without one, the demo app opens directly.
 */
export function App() {
  const auth = useAuth();
  const [onboarding, setOnboarding] = useState(false);
  const needsOnboarding = !!auth.session && (!auth.profile?.full_name || auth.teams.length === 0);

  useEffect(() => {
    if (needsOnboarding) setOnboarding(true);
  }, [needsOnboarding]);

  // Signed-in users who open another team's invite link join it directly.
  const [joinError, setJoinError] = useState<string | null>(null);
  useEffect(() => {
    const code = readPendingInvite();
    if (!auth.session || needsOnboarding || !code) return;
    clearPendingInvite();
    joinTeam(code)
      .then((teamId) => auth.refresh().then(() => (window.location.hash = `myteam/${teamId}`)))
      .catch((e) => setJoinError(friendlyError(e)));
  }, [auth, needsOnboarding]);

  if (auth.enabled && !auth.demo) {
    if (auth.loading) {
      return (
        <div className="ip-splash" aria-busy="true">
          <Logo height={48} />
        </div>
      );
    }
    if (!auth.session) return <AuthScreen />;
    if (needsOnboarding || onboarding) {
      return (
        <div className="ip-app">
          <OnboardingScreen onDone={() => setOnboarding(false)} />
        </div>
      );
    }
  }
  return <MainApp joinError={joinError} />;
}

function MainApp({ joinError }: { joinError: string | null }) {
  const auth = useAuth();
  const initial = readHash();
  const [route, setRoute] = useState<Route>(initial.route);
  const [param, setParam] = useState(initial.param);
  const [childId, setChildId] = useState(children.some((c) => c.id === initial.child) ? initial.child! : children[0].id);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const child = children.find((c) => c.id === childId) ?? children[0];

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setRoute(h.route);
      setParam(h.param);
      if (h.child && children.some((c) => c.id === h.child)) setChildId(h.child);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback(
    (r: Route) => {
      window.location.hash = `${r}/${childId}`;
      window.scrollTo({ top: 0 });
    },
    [childId],
  );

  const selectChild = (id: string) => {
    setChildId(id);
    history.replaceState(null, '', `#${route}/${id}`);
  };

  const openSwitcher = () => setSwitcherOpen(true);
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

  if (route === 'brand') {
    return (
      <div className="ip-app">
        <main className="ip-main ip-main--plain">
          <BrandScreen onClose={() => go('home')} />
        </main>
      </div>
    );
  }

  const signedIn = !!auth.session;
  const parentName = signedIn && auth.profile?.full_name ? auth.profile.full_name : `${parent.firstName} ${parent.lastName}`;
  const firstTeam = auth.teams[0];
  // #coach/<teamId> opens a real team's board; #coach/<childId> opens the demo one.
  const coachTeam = route === 'coach' && signedIn ? auth.teams.find((t) => t.id === param) : undefined;
  const back = (fallback: Route) => (history.length > 1 ? history.back() : go(fallback));

  return (
    <div className="ip-app">
      <AppHeader parentName={parentName} unread={parent.unread} child={child} onOpenSwitcher={openSwitcher} />
      <main className="ip-main">
        {joinError && (
          <p className="ip-error" role="alert">
            {joinError}
          </p>
        )}
        {signedIn && firstTeam && route !== 'myteam' && route !== 'family' && !coachTeam && (
          <button type="button" className="ip-demo-banner" onClick={() => (window.location.hash = `myteam/${firstTeam.id}`)}>
            <Icon name="team" size={18} />
            <span>
              המסכים כאן עדיין מציגים נתוני הדגמה. <strong>לקבוצה שלך: {firstTeam.name}</strong>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        )}
        {route === 'myteam' && signedIn && param && <MyTeamScreen teamId={param} onBack={() => go('family')} />}
        {route === 'home' && <HomeScreen child={child} onNavigate={go} onSwitchChild={openSwitcher} onOpenMatch={() => go('match')} />}
        {route === 'team' && <TeamScreen child={child} onOpenMatch={() => go('match')} onOpenCoach={() => go('coach')} />}
        {route === 'coach' && (coachTeam ? <TeamCoachScreen teamId={coachTeam.id} onBack={() => back('family')} /> : <DemoCoachScreen child={child} onBack={() => back('team')} />)}
        {route === 'match' && <MatchCenterScreen child={child} onBack={() => (history.length > 1 ? history.back() : go('team'))} />}
        {route === 'calendar' && <CalendarScreen child={child} />}
        {route === 'career' && <CareerScreen child={child} onSwitchChild={openSwitcher} />}
        {route === 'family' && <FamilyScreen />}
        {route === 'myteam' && !signedIn && <FamilyScreen />}
      </main>
      <BottomNav active={route === 'match' ? 'team' : route === 'coach' ? (coachTeam ? 'family' : 'team') : route === 'myteam' ? 'family' : route} onChange={go} />
      <ChildSwitcherSheet open={switcherOpen} onClose={closeSwitcher} items={children} selectedId={child.id} onSelect={selectChild} />
    </div>
  );
}
