/**
 * Shared live-match state, so a goal reported in the match center shows up
 * immediately on the home screen too. Replace the reducer's local updates
 * with the real-time backend (websocket / push) when wiring the API.
 */
import { createContext, useContext, useReducer, type ReactNode } from 'react';
import { children, type Live, type LiveUpdate } from './demo';

export interface ScoreReport {
  childId: string;
  side: 'home' | 'away';
  points: number; // 1 for football goal; 1/2/3 for basketball
  scorer?: string;
  assist?: string;
  mine?: boolean;
  /** Which of the child's own stats changed: scorer adds points/goals, assist adds one assist. */
  mineAs?: 'scorer' | 'assist';
}

type State = Record<string, Live | undefined>;
type Action = { type: 'report'; report: ScoreReport } | { type: 'undo'; childId: string };

const initial: State = Object.fromEntries(children.map((c) => [c.id, c.live]));

function currentMinute(live: Live): string {
  // Demo: basketball periods are labeled "רבע N · mm:ss"; take the period part.
  return live.period.split('·')[0].trim();
}

function describe(r: ScoreReport, live: Live): string {
  const team = r.side === 'home' ? live.home : live.away;
  const basket = r.points > 1 || live.period.includes('רבע');
  const what = basket ? (r.points === 3 ? 'שלשה' : r.points === 2 ? 'סל' : 'זריקת עונשין') : 'שער';
  if (!r.scorer) return `${what} ל${team}`;
  return `${what}! ${r.scorer}${r.assist ? ` · ${basket ? 'אסיסט' : 'בישול'}: ${r.assist}` : ''}`;
}

function reducer(state: State, action: Action): State {
  if (action.type === 'undo') {
    const live = state[action.childId];
    if (!live || !live.updates[0]?.reported) return state;
    const [last, ...rest] = live.updates;
    return {
      ...state,
      [action.childId]: {
        ...live,
        homeScore: live.homeScore - (last.side === 'home' ? last.points ?? 0 : 0),
        awayScore: live.awayScore - (last.side === 'away' ? last.points ?? 0 : 0),
        updates: rest,
        myStats: last.prevStats ?? live.myStats,
      },
    };
  }
  const r = action.report;
  const live = state[r.childId];
  if (!live || live.status !== 'live') return state;
  const update: LiveUpdate = {
    minute: currentMinute(live),
    text: describe(r, live),
    kind: 'goal',
    mine: r.mine,
    reported: true,
    side: r.side,
    points: r.points,
    prevStats: live.myStats,
  };
  // myStats order is [points/goals, assists, …] for both sports.
  const myStats = live.myStats?.map((st, i) => {
    const add = r.mineAs === 'scorer' && i === 0 ? r.points : r.mineAs === 'assist' && i === 1 ? 1 : 0;
    return add ? { ...st, value: String(Number(st.value) + add) } : st;
  });
  return {
    ...state,
    [r.childId]: {
      ...live,
      homeScore: live.homeScore + (r.side === 'home' ? r.points : 0),
      awayScore: live.awayScore + (r.side === 'away' ? r.points : 0),
      updates: [update, ...live.updates],
      myStats,
    },
  };
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null);

export function LiveProvider({ children: node }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  return <Ctx.Provider value={{ state, dispatch }}>{node}</Ctx.Provider>;
}

export function useLive(childId: string) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLive must be used inside <LiveProvider>');
  return {
    live: ctx.state[childId],
    report: (r: Omit<ScoreReport, 'childId'>) => ctx.dispatch({ type: 'report', report: { ...r, childId } }),
    undo: () => ctx.dispatch({ type: 'undo', childId }),
  };
}
