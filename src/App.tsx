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
import { ClubScreen } from './screens/ClubScreen';
import { DemoCoachScreen, TeamCoachScreen } from './screens/CoachScreen';
import { FindScreen } from './screens/FindScreen';
import { IfaAdminScreen } from './screens/IfaAdminScreen';
import { MatchesScreen } from './screens/MatchesScreen';
import { TeamPageScreen } from './screens/TeamPageScreen';
import { FundScreen } from './screens/FundScreen';
import { RealCalendarScreen, RealCareerScreen, RealChildPill, RealFamilyScreen, RealHomeScreen, RealTeamsScreen, SignInPill } from './screens/RealScreens';
import { wasOnboarded } from './lib/joinApi';
import { Logo } from './components/Logo';
import { Icon } from './components/Icon';
import { clearPendingInvite, readPendingInvite, savePendingInvite, saveStaffInvite, takeStaffInvite, useAuth } from './auth/AuthContext';
import { acceptClubInvite, clubError } from './lib/clubApi';
import { friendlyError, joinTeam } from './lib/api';

type Route = TabId | 'brand' | 'match' | 'myteam' | 'coach' | 'club' | 'find' | 't' | 'matches' | 'ifa' | 'fund';
const routes: Route[] = ['home', 'team', 'calendar', 'career', 'family', 'brand', 'match', 'myteam', 'coach', 'club', 'find', 't', 'matches', 'ifa', 'fund'];
/** Routes a signed-in user can open before belonging to any team (search, shared team page). */
const openRoutes: Route[] = ['find', 't'];

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
  // Club staff invites: #staff/ABCD2345
  const s = window.location.hash.match(/^#staff\/([A-Za-z0-9]{8})$/);
  if (s) {
    saveStaffInvite(s[1]);
    history.replaceState(null, '', '#club');
  }
}
captureInviteFromHash();

/** A signed-in user without a team can ask to see the sample data; kept until they join a real team. */
const SAMPLE_KEY = 'iplays.sampleView';
function readSample(): boolean {
  try {
    return localStorage.getItem(SAMPLE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeSample(on: boolean) {
  try {
    if (on) localStorage.setItem(SAMPLE_KEY, '1');
    else localStorage.removeItem(SAMPLE_KEY);
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}

/**
 * Gate: with a backend configured, users sign in and finish onboarding first
 * (unless they chose to browse the demo). Without one, the demo app opens directly.
 */
export function App() {
  const auth = useAuth();
  const [onboarding, setOnboarding] = useState(false);
  const [hashRoute, setHashRoute] = useState(readHash().route);
  useEffect(() => {
    const onHash = () => setHashRoute(readHash().route);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Sign-up is once: a name, then (only the first time) a team step. Someone
  // who opened a shared team page or the search, or already sent a request,
  // is not sent back to the team step.
  const openRoute = openRoutes.includes(hashRoute);
  // Only decide once the profile and teams have loaded: while loading they are
  // empty, and deciding then sent returning users back into onboarding.
  const ready = !!auth.session && !auth.loading;
  const needsName = ready && !auth.profile?.full_name;
  const needsTeam = ready && auth.teams.length === 0 && !openRoute && !wasOnboarded();
  const needsOnboarding = needsName || needsTeam;

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

  // Club staff invite: accept right after sign-in (before team onboarding).
  useEffect(() => {
    if (!auth.session) return;
    const code = takeStaffInvite();
    if (!code) return;
    acceptClubInvite(code)
      .then((clubId) => auth.refresh().then(() => {
        setOnboarding(false);
        window.location.hash = `club/${clubId}`;
      }))
      .catch((e) => setJoinError(clubError(e) ?? friendlyError(e)));
  }, [auth]);

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
          <OnboardingScreen skipTeamStep={openRoute} onDone={() => setOnboarding(false)} />
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
  const [sample, setSampleState] = useState(readSample);
  const setSample = useCallback((on: boolean) => {
    writeSample(on);
    setSampleState(on);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    if (auth.teams.length > 0 && readSample()) setSample(false);
  }, [auth.teams.length, setSample]);
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
  const hasTeam = auth.teams.length > 0;
  // Signed-in users see only their own data. The sample data shows when not
  // signed in (demo from the login screen, or no backend), or when a user
  // without a team asked for it; joining a real team ends it.
  const demoMode = !signedIn || (!hasTeam && sample);
  const parentName = signedIn && auth.profile?.full_name ? auth.profile.full_name : `${parent.firstName} ${parent.lastName}`;
  // #coach/<teamId> opens a real team's board; #coach/<childId> opens the demo one.
  const coachTeam = route === 'coach' && signedIn ? auth.teams.find((t) => t.id === param) : undefined;
  const back = (fallback: Route) => (history.length > 1 ? history.back() : go(fallback));

  return (
    <div className="ip-app">
      <AppHeader
        parentName={parentName}
        unread={demoMode ? parent.unread : 0}
        child={demoMode ? child : undefined}
        slot={!signedIn && auth.enabled ? <SignInPill onClick={() => auth.setDemo(false)} /> : !demoMode ? <RealChildPill /> : undefined}
        onOpenSwitcher={openSwitcher}
      />
      <main className="ip-main">
        {joinError && (
          <p className="ip-error" role="alert">
            {joinError}
          </p>
        )}
        {signedIn && demoMode && (
          <button type="button" className="ip-demo-banner" onClick={() => setSample(false)}>
            <Icon name="eye" size={18} />
            <span>
              הצגה לדוגמה: הנתונים כאן אינם שלך. <strong>סגירת ההצגה לדוגמה</strong>
            </span>
            <Icon name="close" size={16} />
          </button>
        )}
        {route === 'club' && signedIn && <ClubScreen clubId={param} onBack={() => back('family')} />}
        {route === 'club' && !signedIn && <FamilyScreen />}
        {route === 'matches' && (signedIn && param ? <MatchesScreen teamId={param} onBack={() => back('family')} /> : <FamilyScreen />)}
        {route === 'fund' && (signedIn && param ? <FundScreen teamId={param} onBack={() => back('family')} /> : <FamilyScreen />)}
        {route === 'ifa' && (signedIn ? <IfaAdminScreen onBack={() => back('family')} /> : <FamilyScreen />)}
        {route === 'find' && (signedIn ? <FindScreen onBack={() => back('family')} /> : <FamilyScreen />)}
        {route === 't' && (signedIn && param ? <TeamPageScreen teamId={param} onBack={() => back('family')} /> : <FamilyScreen />)}
        {route === 'myteam' && signedIn && param && <MyTeamScreen teamId={param} onBack={() => go('family')} />}
        {!demoMode && (route === 'home' || route === 'match') && <RealHomeScreen onShowSample={() => setSample(true)} />}
        {!demoMode && (route === 'team' || (route === 'coach' && !coachTeam)) && <RealTeamsScreen onShowSample={() => setSample(true)} />}
        {!demoMode && route === 'calendar' && <RealCalendarScreen onShowSample={() => setSample(true)} />}
        {!demoMode && route === 'career' && <RealCareerScreen onShowSample={() => setSample(true)} />}
        {!demoMode && route === 'family' && <RealFamilyScreen />}
        {route === 'coach' && coachTeam && <TeamCoachScreen teamId={coachTeam.id} onBack={() => back('family')} />}
        {demoMode && route === 'home' && <HomeScreen child={child} onNavigate={go} onSwitchChild={openSwitcher} onOpenMatch={() => go('match')} />}
        {demoMode && route === 'team' && <TeamScreen child={child} onOpenMatch={() => go('match')} onOpenCoach={() => go('coach')} />}
        {demoMode && route === 'coach' && !coachTeam && <DemoCoachScreen child={child} onBack={() => back('team')} />}
        {demoMode && route === 'match' && <MatchCenterScreen child={child} onBack={() => (history.length > 1 ? history.back() : go('team'))} />}
        {demoMode && route === 'calendar' && <CalendarScreen child={child} />}
        {demoMode && route === 'career' && <CareerScreen child={child} onSwitchChild={openSwitcher} />}
        {demoMode && route === 'family' && <FamilyScreen />}
        {route === 'myteam' && !signedIn && <FamilyScreen />}
      </main>
      <BottomNav active={route === 'match' ? 'team' : route === 'coach' ? (coachTeam ? 'family' : 'team') : route === 'myteam' || route === 'club' || route === 'find' || route === 't' || route === 'matches' || route === 'ifa' || route === 'fund' ? 'family' : route} onChange={go} />
      <ChildSwitcherSheet open={demoMode && switcherOpen} onClose={closeSwitcher} items={children} selectedId={child.id} onSelect={selectChild} />
    </div>
  );
}
