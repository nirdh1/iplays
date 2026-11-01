/**
 * Live reporting on a real team match. Every tap is one goal (basketball: 1-3
 * points) for the home or the away team; the scorer's shirt number can be
 * added right after or later, and the app finds the player in the roster.
 * Any member of the team reports; everyone in the team sees the score update
 * live (Supabase Realtime, with a slow poll as a fallback).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, LiveBadge, SectionHeader, Scoreline, Tag } from '../components/ui';
import { friendlyError, type Player } from '../lib/api';
import {
  getMatchEvents,
  liveError,
  liveScore,
  matchIsLive,
  matchReportable,
  removeMatchEvent,
  reportGoal,
  setGoalScorer,
  subscribeMatchEvents,
  type Match,
  type MatchEvent,
  type Side,
} from '../lib/matchApi';
import type { SportProfile } from '../lib/sports';

const errText = (e: unknown) => liveError(e) ?? friendlyError(e);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

export function LiveMatch({
  match,
  teamName,
  profile,
  roster,
  me,
}: {
  match: Match;
  teamName: string;
  profile: SportProfile;
  roster: Player[];
  me: string;
}) {
  const basket = profile.scoreLabel === 'נקודות';
  const [events, setEvents] = useState<MatchEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState(2);
  const [scorerFor, setScorerFor] = useState<MatchEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reportable = matchReportable(match, now);
  const live = matchIsLive(match, now);
  const homeName = match.home ? teamName : match.opponent;
  const awayName = match.home ? match.opponent : teamName;
  const ourSide: Side = match.home ? 'home' : 'away';

  const load = useCallback(async () => {
    try {
      setEvents(await getMatchEvents(match.id));
    } catch (e) {
      setEvents((cur) => cur ?? []);
      setError(errText(e));
    }
  }, [match.id]);

  useEffect(() => {
    void load();
    const off = subscribeMatchEvents(match.id, () => void load());
    // Fallback while the game is on, in case realtime is not available.
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (matchReportable(match, Date.now())) void load();
    }, 20_000);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, [load, match]);

  const score = useMemo(() => liveScore(events ?? [], match.home), [events, match.home]);
  const byNumber = useMemo(() => new Map(roster.filter((p) => p.shirt_number != null).map((p) => [p.shirt_number!, p])), [roster]);
  const mine = useMemo(() => new Set(roster.filter((p) => p.guardians.includes(me)).map((p) => p.id)), [roster, me]);
  const lastReport = useRef<{ side: Side; at: number } | null>(null);

  // Nothing to show for a game far from now with no reports.
  if (!reportable && (events === null || events.length === 0)) return null;

  async function tap(side: Side) {
    const recent = (events ?? []).filter((e) => e.side === side && e.created_by !== me && now - new Date(e.created_at).getTime() < 60_000);
    const mineRecent = lastReport.current && lastReport.current.side === side && Date.now() - lastReport.current.at < 60_000;
    if (recent.length && !mineRecent) {
      const who = recent[recent.length - 1].reporter_name ?? 'הורה אחר';
      if (!confirm(`${who} דיווח/ה על גול ל${side === 'home' ? homeName : awayName} לפני פחות מדקה. זה גול נוסף?`)) return;
    }
    setBusy(true);
    setError(null);
    try {
      const pts = basket ? points : 1;
      const id = await reportGoal(match.id, side, null, pts);
      lastReport.current = { side, at: Date.now() };
      setToast(`${basket ? `+${pts}` : 'גול'} ל${side === 'home' ? homeName : awayName} · כל הקבוצה רואה`);
      setScorerFor({
        id,
        side,
        points: pts,
        shirt_number: null,
        player_id: null,
        scorer_name: null,
        minute: null,
        created_at: new Date().toISOString(),
        created_by: me,
        reporter_name: null,
      });
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: MatchEvent) {
    if (!confirm(`להסיר את הדיווח על ${basket ? `${e.points} נקודות` : 'הגול'} ל${e.side === 'home' ? homeName : awayName}?`)) return;
    setError(null);
    try {
      await removeMatchEvent(e.id);
      await load();
    } catch (err) {
      setError(errText(err));
    }
  }

  const list = [...(events ?? [])].reverse();

  return (
    <section>
      <SectionHeader title={reportable ? 'דיווח בזמן אמת' : 'מהלך המשחק'} icon="live" />
      <Card tone={live ? 'live' : 'default'} className="ip-scoreboard">
        <div className="ip-score-status">{live ? <LiveBadge label="LIVE" /> : <Tag>{reportable ? 'לפי דיווחי ההורים' : 'לפי הדיווחים'}</Tag>}</div>
        <Scoreline home={homeName} away={awayName} homeScore={score.home} awayScore={score.away} size="lg" />
        {match.score_for != null && match.score_against != null && (
          <p className="ip-muted ip-center">
            תוצאה רשמית{match.source === 'ifa' ? ' (התאחדות)' : ''}:{' '}
            <bdi dir="ltr">
              {match.home ? match.score_for : match.score_against} : {match.home ? match.score_against : match.score_for}
            </bdi>
          </p>
        )}
        {reportable && (
          <div className="ip-live-report">
            {basket && (
              <div className="ip-choice-row ip-choice-row--3" role="group" aria-label="כמה נקודות">
                {[1, 2, 3].map((p) => (
                  <button key={p} type="button" className={points === p ? 'is-on' : ''} aria-pressed={points === p} onClick={() => setPoints(p)}>
                    <strong>{p}</strong>
                    <span>{p === 1 ? 'עונשין' : p === 2 ? 'סל' : 'שלשה'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="ip-live-goal-row">
              {(['home', 'away'] as Side[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={`ip-live-goal ${side === ourSide ? 'is-ours' : ''}`}
                  disabled={busy}
                  onClick={() => void tap(side)}
                >
                  <Icon name="goal" size={22} />
                  <strong>{basket ? `+${points}` : 'גול!'}</strong>
                  <span>{side === 'home' ? homeName : awayName}</span>
                  <small>{side === 'home' ? 'בית' : 'חוץ'}</small>
                </button>
              ))}
            </div>
            <p className="ip-footnote ip-center">כל לחיצה היא {basket ? 'סל' : 'גול'}. אחרי הלחיצה אפשר להוסיף את מספר החולצה של המבקיע/ה.</p>
          </div>
        )}
      </Card>
      {error && <p className="ip-error" role="alert">{error}</p>}

      {list.length > 0 && (
        <Card padded={false}>
          <ol className="ip-timeline-live">
            {list.map((e) => {
              const ours = e.side === ourSide;
              const isMine = e.player_id != null && mine.has(e.player_id);
              const team = e.side === 'home' ? homeName : awayName;
              const who = e.scorer_name
                ? `${e.scorer_name}${e.shirt_number != null ? ` (#${e.shirt_number})` : ''}`
                : e.shirt_number != null
                  ? `מספר ${e.shirt_number}`
                  : null;
              return (
                <li key={e.id} className={`ip-tl ip-tl--goal ${isMine ? 'is-mine' : ''} ${ours ? '' : 'is-away'}`}>
                  <span className="ip-tl-min">{e.minute != null ? `${e.minute}'` : timeOf(e.created_at)}</span>
                  <span className="ip-tl-dot ip-tl-dot--goal">
                    <Icon name="goal" size={16} strokeWidth={2.2} />
                  </span>
                  <span className="ip-tl-body">
                    <span className="ip-tl-text">
                      {basket ? (e.points === 3 ? 'שלשה' : e.points === 2 ? 'סל' : 'עונשין') : 'גול'} ל{team}
                      {who && ` · ${who}`}
                      {basket && <span className="ip-tl-pts">+{e.points}</span>}
                    </span>
                    <span className="ip-tl-meta">
                      דיווח: {e.created_by === me ? 'אני' : e.reporter_name ?? 'חבר/ת קבוצה'} · {timeOf(e.created_at)}
                    </span>
                    <span className="ip-live-actions">
                      <button type="button" className="ip-link-btn" onClick={() => setScorerFor(e)}>
                        {e.shirt_number == null ? 'הוספת מבקיע/ה' : 'שינוי מבקיע/ה'}
                      </button>
                      <button type="button" className="ip-link-btn" onClick={() => void remove(e)}>
                        הסרה
                      </button>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <ScorerSheet
        event={scorerFor}
        ours={scorerFor?.side === ourSide}
        teamName={scorerFor ? (scorerFor.side === 'home' ? homeName : awayName) : ''}
        roster={roster}
        byNumber={byNumber}
        mine={mine}
        onClose={() => setScorerFor(null)}
        onSave={async (n) => {
          await setGoalScorer(scorerFor!.id, n);
          setScorerFor(null);
          await load();
        }}
      />

      {toast && (
        <div className="ip-toast" role="status" onAnimationEnd={() => setToast(null)}>
          <Icon name="check" size={18} /> {toast}
        </div>
      )}
    </section>
  );
}

function ScorerSheet({
  event,
  ours,
  teamName,
  roster,
  byNumber,
  mine,
  onClose,
  onSave,
}: {
  event: MatchEvent | null;
  ours: boolean;
  teamName: string;
  roster: Player[];
  byNumber: Map<number, Player>;
  mine: Set<string>;
  onClose: () => void;
  onSave: (shirt: number | null) => Promise<void>;
}) {
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNum(event?.shirt_number != null ? String(event.shirt_number) : '');
    setError(null);
  }, [event]);

  const n = num === '' ? null : Number(num);
  const found = ours && n != null ? byNumber.get(n) : undefined;
  const numbered = roster.filter((p) => p.shirt_number != null).sort((a, b) => a.shirt_number! - b.shirt_number!);

  async function save(shirt: number | null) {
    setBusy(true);
    setError(null);
    try {
      await onSave(shirt);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={event !== null} onClose={onClose} title={`מי הבקיע/ה ל${teamName}?`}>
      <div className="ip-report">
        <fieldset>
          <legend>מספר חולצה</legend>
          <input
            id="live-shirt"
            className="ip-input ip-live-shirt"
            inputMode="numeric"
            dir="ltr"
            autoFocus
            placeholder="למשל 10"
            value={num}
            onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
          {ours && n != null && (
            <p className={found ? 'ip-live-found' : 'ip-muted'}>
              {found ? `${found.first_name} ${found.last_name}` : 'אין בסגל שחקן עם המספר הזה. נשמור את המספר בלבד.'}
            </p>
          )}
        </fieldset>
        {ours && numbered.length > 0 && (
          <fieldset>
            <legend>או בוחרים מהסגל</legend>
            <div className="ip-player-chips">
              {numbered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${n === p.shirt_number ? 'is-on' : ''} ${mine.has(p.id) ? 'is-mine' : ''}`}
                  aria-pressed={n === p.shirt_number}
                  onClick={() => setNum(String(p.shirt_number))}
                >
                  <span className="ip-chip-no">{p.shirt_number}</span>
                  {p.first_name}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {error && <p className="ip-error" role="alert">{error}</p>}
        <Button variant="primary" block icon="check" disabled={busy || n == null} onClick={() => void save(n)}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
        {event?.shirt_number != null ? (
          <Button variant="ghost" block disabled={busy} onClick={() => void save(null)}>
            הסרת המבקיע/ה
          </Button>
        ) : (
          <Button variant="ghost" block disabled={busy} onClick={onClose}>
            לא יודעים, דלג
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}
