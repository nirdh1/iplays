import { useCallback, useEffect, useState } from 'react';
import { AppHeader, BottomNav, ChildSwitcherSheet, type TabId } from './components/shell';
import { children, parent } from './data/demo';
import { HomeScreen } from './screens/HomeScreen';
import { CareerScreen } from './screens/CareerScreen';
import { CalendarScreen, FamilyScreen } from './screens/OtherScreens';
import { TeamScreen } from './screens/TeamScreen';
import { MatchCenterScreen } from './screens/MatchCenterScreen';
import { BrandScreen } from './screens/BrandScreen';

type Route = TabId | 'brand' | 'match';
const routes: Route[] = ['home', 'team', 'calendar', 'career', 'family', 'brand', 'match'];

function readHash(): { route: Route; child?: string } {
  const [r, c] = window.location.hash.replace('#', '').split('/');
  return { route: (routes as string[]).includes(r) ? (r as Route) : 'home', child: c };
}

export function App() {
  const initial = readHash();
  const [route, setRoute] = useState<Route>(initial.route);
  const [childId, setChildId] = useState(children.some((c) => c.id === initial.child) ? initial.child! : children[0].id);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const child = children.find((c) => c.id === childId) ?? children[0];

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setRoute(h.route);
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

  return (
    <div className="ip-app">
      <AppHeader parentName={`${parent.firstName} ${parent.lastName}`} unread={parent.unread} child={child} onOpenSwitcher={openSwitcher} />
      <main className="ip-main">
        {route === 'home' && <HomeScreen child={child} onNavigate={go} onSwitchChild={openSwitcher} onOpenMatch={() => go('match')} />}
        {route === 'team' && <TeamScreen child={child} onOpenMatch={() => go('match')} />}
        {route === 'match' && <MatchCenterScreen child={child} onBack={() => (history.length > 1 ? history.back() : go('team'))} />}
        {route === 'calendar' && <CalendarScreen child={child} />}
        {route === 'career' && <CareerScreen child={child} onSwitchChild={openSwitcher} />}
        {route === 'family' && <FamilyScreen />}
      </main>
      <BottomNav active={route === 'match' ? 'team' : route} onChange={go} />
      <ChildSwitcherSheet open={switcherOpen} onClose={closeSwitcher} items={children} selectedId={child.id} onSelect={selectChild} />
    </div>
  );
}
