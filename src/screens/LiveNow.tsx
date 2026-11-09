/**
 * Home: "משחקים חיים עכשיו" — the games of MY teams that are on now, with the
 * live score, the game clock and the last goal, updated in real time.
 * Only the user's own teams (no league-wide board), parents' app only.
 */
import { useEffect, useState } from 'react';
import { Card, LiveBadge, Scoreline, SectionHeader } from '../components/ui';
import type { MyTeam } from '../lib/api';
import {
  clockLabel,
  getLiveState,
  getMatchEvents,
  getMatches,
  goalTypeLabel,
  liveScore,
  matchIsLive,
  subscribeMatchEvents,
  type LiveState,
  type Match,
  type MatchEvent,
} from '../lib/matchApi';

type LiveGame = { match: Match; team: MyTeam };

/** My teams' games that are on now; re-checked every minute. */
function useLiveGames(teams: MyTeam[]): LiveGame[] {
  const [games, setGames] = useState<LiveGame[]>([]);
  const key = teams.map((t) => t.id).join(',');
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all(teams.map(async (t) => (await getMatches(t.id).catch(() => [] as Match[])).filter((m) => matchIsLive(m)).map((match) => ({ match, team: t }))))
        .then((all) => alive && setGames(all.flat().sort((a, b) => a.match.starts_at.localeCompare(b.match.starts_at))))
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return games;
}

export function LiveNowSection({ teams }: { teams: MyTeam[] }) {
  const games = useLiveGames(teams);
  if (!games.length) return null;
  return (
    <section>
      <SectionHeader title={games.length > 1 ? 'משחקים חיים עכשיו' : 'משחק חי עכשיו'} icon="live" />
      <div className="ip-stack">
        {games.map((g) => (
          <LiveGameCard key={g.match.id} game={g} showTeam={teams.length > 1} />
        ))}
      </div>
    </section>
  );
}

function statusLabel(s: LiveState | null, basket: boolean, now: number, fetchedAt: number): string {
  if (!s || s.status === 'not_started') return 'לפני שריקת הפתיחה';
  if (s.status === 'finished') return 'הסתיים';
  if (s.status === 'break') return basket ? `הפסקה אחרי רבע ${s.period}` : 'מחצית';
  const sec = s.clock_seconds + (s.running ? (now - fetchedAt) / 1000 : 0);
  return `${basket ? `רבע ${s.period}` : `מחצית ${s.period === 1 ? 'ראשונה' : s.period === 2 ? 'שנייה' : s.period}`} · ${clockLabel(sec)}`;
}

function goalLine(e: MatchEvent, basket: boolean): string {
  const who = e.scorer_name ? `${e.scorer_name}${e.shirt_number != null ? ` (#${e.shirt_number})` : ''}` : e.shirt_number != null ? `מספר ${e.shirt_number}` : null;
  const type = e.goal_type && e.goal_type !== 'other' ? goalTypeLabel[e.goal_type] : null;
  return [e.minute != null ? `דקה ${e.minute}` : null, basket ? (e.points === 3 ? 'שלשה' : 'סל') : 'גול', who, type].filter(Boolean).join(' · ');
}

function LiveGameCard({ game, showTeam }: { game: LiveGame; showTeam: boolean }) {
  const { match: m, team } = game;
  const basket = team.sport === 'basketball';
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [state, setState] = useState<LiveState | null>(null);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([getMatchEvents(m.id).catch(() => [] as MatchEvent[]), getLiveState(m.id).catch(() => null)]).then(([ev, st]) => {
        if (!alive) return;
        setEvents(ev);
        setState(st);
        setFetchedAt(Date.now());
      });
    void load();
    const off = subscribeMatchEvents(m.id, () => void load());
    return () => {
      alive = false;
      off();
    };
  }, [m.id]);

  useEffect(() => {
    if (!state?.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state?.running]);

  const score = liveScore(events, m.home);
  const homeName = m.home ? team.name : m.opponent;
  const awayName = m.home ? m.opponent : team.name;
  const goals = events.filter((e) => !e.kind || e.kind === 'goal');
  const last = goals[goals.length - 1];

  return (
    <button type="button" className="ip-live-now" onClick={() => (window.location.hash = `matches/${m.team_id}/${m.id}`)}>
      <Card tone="live">
        <div className="ip-score-status">
          <LiveBadge label={`LIVE · ${statusLabel(state, basket, now, fetchedAt)}`} />
        </div>
        <Scoreline home={homeName} away={awayName} homeScore={score.home} awayScore={score.away} />
        {last ? (
          <p className="ip-live-now-last">
            {goalLine(last, basket)} · ל{last.side === 'home' ? homeName : awayName}
          </p>
        ) : (
          <p className="ip-muted ip-live-now-last">עוד אין {basket ? 'סלים' : 'שערים'}. לחצו לדיווח</p>
        )}
        <p className="ip-muted ip-live-now-foot">{showTeam ? `${team.name} · ` : ''}לחצו למרכז המשחק</p>
      </Card>
    </button>
  );
}
