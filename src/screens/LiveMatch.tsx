/**
 * Live match on a real team game (spec 16-17).
 *
 * - One primary reporter runs the game: starts it, ends / opens halves, reports,
 *   approves other parents' reports, ends the game and confirms the result.
 *   Others join a queue; "הפסק לדווח" offers the role to the next in line, who
 *   has 60 seconds to accept before it moves on.
 * - Any team member may report (goal, number / name, yellow / red card), even
 *   partially. It waits for the primary; only approved reports change the score.
 *   Similar reports are merged on the server. While no one holds the role, a
 *   report counts at once.
 * - The clock is computed on the server, so every phone shows the same time.
 * - Updates arrive through Supabase Realtime, with a slow poll as a fallback.
 * - If the session migration is not installed yet, this falls back to the
 *   simple one-tap reporting of PR #21.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, LiveBadge, SectionHeader, Scoreline, Tag } from '../components/ui';
import { friendlyError, type Player } from '../lib/api';
import {
  answerReporterOffer,
  claimReporter,
  clockLabel,
  finalizeResult,
  getLiveState,
  getMatchEvents,
  getPendingReports,
  joinReporterQueue,
  leaveReporterQueue,
  liveError,
  liveScore,
  matchClock,
  matchIsLive,
  matchReportable,
  releaseReporter,
  removeMatchEvent,
  reportGoal,
  reviewReport,
  setGoalScorer,
  setGoalType,
  goalTypeLabel,
  submitReport,
  subscribeMatchEvents,
  updateReport,
  type EventKind2,
  type GoalType,
  type LiveState,
  type Match,
  type MatchEvent,
  type PendingReport,
  type Side,
} from '../lib/matchApi';
import type { SportProfile } from '../lib/sports';

const errText = (e: unknown) => liveError(e) ?? friendlyError(e);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const kindWord = (k: EventKind2 | undefined, basket: boolean, points = 1) =>
  k === 'yellow' ? 'כרטיס צהוב' : k === 'red' ? 'כרטיס אדום' : basket ? (points === 3 ? 'שלשה' : points === 2 ? 'סל' : 'עונשין') : 'גול';

/** What the details sheet edits: a counted event, or a report waiting for the primary. */
type DetailsTarget = { type: 'event'; event: MatchEvent } | { type: 'report'; id: string; side: Side | null; kind: EventKind2 };

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
  const [pending, setPending] = useState<PendingReport[]>([]);
  const [state, setState] = useState<LiveState | null | undefined>(undefined); // undefined = loading, null = not installed
  const [readAt, setReadAt] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState(2);
  const [details, setDetails] = useState<DetailsTarget | null>(null);
  const [fullReport, setFullReport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reportable = matchReportable(match, now);
  const live = matchIsLive(match, now) || state?.status === 'running' || state?.status === 'break';
  const homeName = match.home ? teamName : match.opponent;
  const awayName = match.home ? match.opponent : teamName;
  const ourSide: Side = match.home ? 'home' : 'away';
  const sideName = (s: Side | null) => (s === 'home' ? homeName : s === 'away' ? awayName : 'קבוצה לא ידועה');

  const load = useCallback(async () => {
    try {
      const [ev, st, pr] = await Promise.all([getMatchEvents(match.id), getLiveState(match.id), getPendingReports(match.id)]);
      setEvents(ev);
      setState(st);
      setReadAt(Date.now());
      setPending(pr);
    } catch (e) {
      setEvents((cur) => cur ?? []);
      setState((cur) => (cur === undefined ? null : cur));
      setError(errText(e));
    }
  }, [match.id]);

  const offerOpen = !!state?.offer_to;
  useEffect(() => {
    void load();
    const off = subscribeMatchEvents(match.id, () => void load());
    return off;
  }, [load, match.id]);

  // Fallback poll (and, while an offer is open, the server moves it on after 60 s).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (matchReportable(match, Date.now())) void load();
    }, offerOpen ? 5_000 : 15_000);
    return () => window.clearInterval(t);
  }, [load, match, offerOpen]);

  // Ticking clock and countdowns.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  const score = useMemo(() => liveScore(events ?? [], match.home), [events, match.home]);
  const byNumber = useMemo(() => new Map(roster.filter((p) => p.shirt_number != null).map((p) => [p.shirt_number!, p])), [roster]);
  const mine = useMemo(() => new Set(roster.filter((p) => p.guardians.includes(me)).map((p) => p.id)), [roster, me]);
  const reminded = useRef(new Set<string>());

  const session = state ?? null;
  const isReporter = !!session && session.reporter_id === me;
  const isStaff = !!session?.staff;
  const finalized = !!session?.finalized_at;
  const inQueue = !!session?.queue.some((q) => q.user_id === me);
  const queuePos = session ? session.queue.findIndex((q) => q.user_id === me) + 1 : 0;
  const offerToMe = !!session && session.offer_to === me;
  const offerLeft = session?.offer_seconds_left != null ? Math.max(0, session.offer_seconds_left - Math.floor((now - readAt) / 1000)) : 0;
  const clock = session ? session.clock_seconds + (session.running ? Math.floor((now - readAt) / 1000) : 0) : 0;
  const canReview = isReporter || (isStaff && !session?.reporter_id);
  const canEditEvents = !session
    ? true
    : finalized
      ? isStaff
      : session.reporter_id
        ? isReporter || isStaff
        : true;
  const direct = !session || isReporter || (!session.reporter_id && !session.offer_to);

  // Remind the primary about a report waiting more than a minute.
  const late = canReview ? pending.filter((r) => now - new Date(r.created_at).getTime() > 60_000) : [];
  useEffect(() => {
    const fresh = late.filter((r) => !reminded.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach((r) => reminded.current.add(r.id));
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {
      /* not supported */
    }
  }, [late]);

  // Nothing to show for a game far from now with no reports.
  if (state === undefined) return null;
  if (!reportable && (events ?? []).length === 0) return null;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) setToast(ok);
      await load();
    } catch (e) {
      setError(errText(e));
      await load();
    } finally {
      setBusy(false);
    }
  };

  async function tap(side: Side) {
    // with no primary, warn before a likely double report (PR #21 behaviour)
    if (direct && !isReporter) {
      const recent = (events ?? []).filter((e) => (e.kind ?? 'goal') === 'goal' && e.side === side && e.created_by !== me && now - new Date(e.created_at).getTime() < 60_000);
      if (recent.length) {
        const who = recent[recent.length - 1].reporter_name ?? 'הורה אחר';
        if (!confirm(`${who} דיווח/ה על גול ל${sideName(side)} לפני פחות מדקה. זה גול נוסף?`)) return;
      }
    }
    await send({ kind: 'goal', side, points: basket ? points : 1 });
  }

  async function send(r: { kind: EventKind2; side: Side | null; points?: number; shirt?: number | null; name?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      if (!session) {
        // session migration not installed: PR #21 one-tap goal
        const id = await reportGoal(match.id, r.side ?? ourSide, r.shirt ?? null, r.points ?? 1);
        setDetails({ type: 'event', event: blankEvent(id, r.side ?? ourSide, r.points ?? 1, me) });
        setToast(`${kindWord('goal', basket, r.points)} ל${sideName(r.side)} · כל הקבוצה רואה`);
      } else {
        const res = await submitReport(match.id, { kind: r.kind, side: r.side, points: r.points, shirt: r.shirt, name: r.name });
        if (res.applied) {
          setToast(`${kindWord(r.kind, basket, r.points)} ל${sideName(r.side)} · כל הקבוצה רואה`);
          if (r.shirt == null && r.kind === 'goal' && r.side) setDetails({ type: 'event', event: blankEvent(res.id, r.side, r.points ?? 1, me) });
        } else if (res.merged) {
          setToast('הורה אחר כבר דיווח על זה. הדיווח שלך נספר כאישור.');
        } else {
          setToast('הדיווח נשלח לאישור המדווח/ת הראשי/ת');
          if (r.shirt == null) setDetails({ type: 'report', id: res.id, side: r.side, kind: r.kind });
        }
      }
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const list = [...(events ?? [])].reverse();
  const status = session?.status ?? 'not_started';
  const showReportButtons = reportable && !finalized && status !== 'finished';

  return (
    <section>
      <SectionHeader title={reportable ? 'משחק חי' : 'מהלך המשחק'} icon="live" />
      <Card tone={live && status !== 'finished' ? 'live' : 'default'} className="ip-scoreboard">
        <div className="ip-score-status">
          {status === 'running' ? (
            <LiveBadge label={`LIVE · מחצית ${session!.period}`} />
          ) : status === 'break' ? (
            <Tag tone="warning">הפסקה · אחרי מחצית {session!.period}</Tag>
          ) : status === 'finished' ? (
            <Tag tone={finalized ? 'lime' : 'neutral'}>{finalized ? 'תוצאה סופית' : 'המשחק הסתיים'}</Tag>
          ) : live ? (
            <LiveBadge label="LIVE" />
          ) : (
            <Tag>{reportable ? 'המשחק טרם התחיל' : 'לפי הדיווחים'}</Tag>
          )}
        </div>
        {session && status !== 'not_started' && (
          <p className={`ip-live-clock ${session.running ? 'is-running' : ''}`} aria-live="off" dir="ltr">
            {clockLabel(clock)}
          </p>
        )}
        <Scoreline
          home={homeName}
          away={awayName}
          homeScore={finalized && session?.final_home != null ? session.final_home : score.home}
          awayScore={finalized && session?.final_away != null ? session.final_away : score.away}
          size="lg"
        />
        {match.score_for != null && match.score_against != null && match.source === 'ifa' && (
          <p className="ip-muted ip-center">
            תוצאה רשמית (התאחדות):{' '}
            <bdi dir="ltr">
              {match.home ? match.score_for : match.score_against} : {match.home ? match.score_against : match.score_for}
            </bdi>
          </p>
        )}

        {showReportButtons && (
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
                <button key={side} type="button" className={`ip-live-goal ${side === ourSide ? 'is-ours' : ''}`} disabled={busy} onClick={() => void tap(side)}>
                  <Icon name="goal" size={22} />
                  <strong>{basket ? `+${points}` : 'גול!'}</strong>
                  <span>{sideName(side)}</span>
                  <small>{side === 'home' ? 'בית' : 'חוץ'}</small>
                </button>
              ))}
            </div>
            {session && (
              <Button variant="ghost" size="sm" icon="plus" onClick={() => setFullReport(true)}>
                {basket ? 'דיווח עם פרטים' : 'דיווח עם פרטים / כרטיס'}
              </Button>
            )}
            <p className="ip-footnote ip-center">
              {direct
                ? `כל לחיצה היא ${basket ? 'סל' : 'גול'} ונספרת מיד. אחר כך אפשר להוסיף מספר חולצה.`
                : 'הדיווח שלך נשלח למדווח/ת הראשי/ת, ונספר אחרי אישור.'}
            </p>
          </div>
        )}
      </Card>
      {error && <p className="ip-error" role="alert">{error}</p>}

      {session && reportable && (
        <ReporterPanel
          session={session}
          status={status}
          isReporter={isReporter}
          isStaff={isStaff}
          inQueue={inQueue}
          queuePos={queuePos}
          offerToMe={offerToMe}
          offerLeft={offerLeft}
          finalized={finalized}
          busy={busy}
          score={score}
          homeName={homeName}
          awayName={awayName}
          run={run}
          matchId={match.id}
        />
      )}

      {session && pending.length > 0 && (
        <Card className="ip-live-pending">
          <strong>{canReview ? 'דיווחים שמחכים לאישור שלך' : 'דיווחים שמחכים לאישור המדווח/ת'}</strong>
          {late.length > 0 && (
            <p className="ip-live-remind" role="alert">
              <Icon name="bell" size={16} /> יש דיווח שמחכה יותר מדקה
            </p>
          )}
          <ul className="ip-live-pending-list">
            {pending.map((r) => {
              const who = r.scorer_name ? `${r.scorer_name}${r.shirt_number != null ? ` (#${r.shirt_number})` : ''}` : r.shirt_number != null ? `מספר ${r.shirt_number}` : null;
              const waited = Math.floor((now - new Date(r.created_at).getTime()) / 1000);
              return (
                <li key={r.id} className={waited > 60 ? 'is-late' : ''}>
                  <span className="ip-live-pending-text">
                    <strong>
                      {kindWord(r.kind, basket, r.points)} ל{sideName(r.side)}
                      {who && ` · ${who}`}
                    </strong>
                    <span className="ip-list-row-sub">
                      {r.created_by === me ? 'אני' : r.reporter_name ?? 'חבר/ת קבוצה'}
                      {r.confirmations > 1 && ` · ${r.confirmations} הורים דיווחו`}
                      {r.minute != null && ` · דקה ${r.minute}`} · לפני {waited < 60 ? `${waited} שניות` : `${Math.floor(waited / 60)} דק׳`}
                    </span>
                  </span>
                  <span className="ip-btn-row">
                    {canReview ? (
                      <>
                        {r.side ? (
                          <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => void run(() => reviewReport(r.id, true), 'הדיווח אושר')}>
                            אישור
                          </Button>
                        ) : (
                          (['home', 'away'] as Side[]).map((s) => (
                            <Button key={s} size="sm" variant="primary" disabled={busy} onClick={() => void run(() => reviewReport(r.id, true, s), 'הדיווח אושר')}>
                              אישור · {sideName(s)}
                            </Button>
                          ))
                        )}
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => reviewReport(r.id, false), 'הדיווח נדחה')}>
                          דחייה
                        </Button>
                      </>
                    ) : r.created_by === me ? (
                      <button type="button" className="ip-link-btn" onClick={() => setDetails({ type: 'report', id: r.id, side: r.side, kind: r.kind })}>
                        השלמת פרטים
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {list.length > 0 && (
        <Card padded={false}>
          <ol className="ip-timeline-live">
            {list.map((e) => {
              const kind = e.kind ?? 'goal';
              const ours = e.side === ourSide;
              const isMine = e.player_id != null && mine.has(e.player_id);
              const who = e.scorer_name
                ? `${e.scorer_name}${e.shirt_number != null ? ` (#${e.shirt_number})` : ''}`
                : e.shirt_number != null
                  ? `מספר ${e.shirt_number}`
                  : null;
              const canFill = canEditEvents || (e.created_by === me && e.shirt_number == null);
              return (
                <li key={e.id} className={`ip-tl ip-tl--${kind === 'goal' ? 'goal' : 'card'} ${isMine ? 'is-mine' : ''} ${ours ? '' : 'is-away'}`}>
                  <span className="ip-tl-min">{e.minute != null ? `${e.minute}'` : timeOf(e.created_at)}</span>
                  <span className={`ip-tl-dot ip-tl-dot--${kind === 'goal' ? 'goal' : 'card'} ${kind === 'red' ? 'is-red' : kind === 'yellow' ? 'is-yellow' : ''}`}>
                    <Icon name={kind === 'goal' ? 'goal' : 'card'} size={16} strokeWidth={2.2} />
                  </span>
                  <span className="ip-tl-body">
                    <span className="ip-tl-text">
                      {kindWord(kind, basket, e.points)} ל{sideName(e.side)}
                      {who && ` · ${who}`}
                      {e.goal_type && e.goal_type !== 'other' && ` · ${goalTypeLabel[e.goal_type]}`}
                      {basket && kind === 'goal' && <span className="ip-tl-pts">+{e.points}</span>}
                    </span>
                    <span className="ip-tl-meta">
                      {e.period ? `מחצית ${e.period} · ` : ''}דיווח: {e.created_by === me ? 'אני' : e.reporter_name ?? 'חבר/ת קבוצה'} · {timeOf(e.created_at)}
                    </span>
                    {(canFill || canEditEvents) && (
                      <span className="ip-live-actions">
                        {canFill && (
                          <button type="button" className="ip-link-btn" onClick={() => setDetails({ type: 'event', event: e })}>
                            {!basket && kind === 'goal' ? 'פרטי הגול' : e.shirt_number == null ? 'הוספת שחקן' : 'שינוי שחקן'}
                          </button>
                        )}
                        {canEditEvents && (
                          <button
                            type="button"
                            className="ip-link-btn"
                            onClick={() => confirm(`להסיר את "${kindWord(kind, basket, e.points)} ל${sideName(e.side)}"?`) && void run(() => removeMatchEvent(e.id), 'הדיווח הוסר')}
                          >
                            הסרה
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <DetailsSheet
        target={details}
        ourSide={ourSide}
        sideName={sideName}
        roster={roster}
        byNumber={byNumber}
        mine={mine}
        onClose={() => setDetails(null)}
        goalTypes={!basket}
        onSave={async (side, shirt, name, goalType) => {
          if (!details) return;
          if (details.type === 'event') {
            if (shirt !== details.event.shirt_number) await setGoalScorer(details.event.id, shirt);
            if (goalType !== undefined && goalType !== (details.event.goal_type ?? null)) await setGoalType(details.event.id, goalType);
          } else await updateReport(details.id, side, shirt, name);
          setDetails(null);
          await load();
        }}
      />

      <FullReportSheet
        open={fullReport}
        basket={basket}
        ourSide={ourSide}
        sideName={sideName}
        roster={roster}
        byNumber={byNumber}
        mine={mine}
        onClose={() => setFullReport(false)}
        onSend={async (r) => {
          setFullReport(false);
          await send(r);
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

function blankEvent(id: string, side: Side, points: number, me: string): MatchEvent {
  return { id, side, points, kind: 'goal', shirt_number: null, player_id: null, scorer_name: null, minute: null, created_at: new Date().toISOString(), created_by: me, reporter_name: null };
}

/* ------------------------------------------------------------ reporter panel */

function ReporterPanel({
  session,
  status,
  isReporter,
  isStaff,
  inQueue,
  queuePos,
  offerToMe,
  offerLeft,
  finalized,
  busy,
  score,
  homeName,
  awayName,
  run,
  matchId,
}: {
  session: LiveState;
  status: LiveState['status'];
  isReporter: boolean;
  isStaff: boolean;
  inQueue: boolean;
  queuePos: number;
  offerToMe: boolean;
  offerLeft: number;
  finalized: boolean;
  busy: boolean;
  score: { home: number; away: number };
  homeName: string;
  awayName: string;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  matchId: string;
}) {
  const [final, setFinal] = useState({ h: '', a: '' });
  useEffect(() => {
    if (status === 'finished') setFinal({ h: String(session.final_home ?? score.home), a: String(session.final_away ?? score.away) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session.final_home, session.final_away]);

  const queueRow: ReactNode = inQueue ? (
    <div className="ip-btn-row">
      <span className="ip-muted">את/ה במקום {queuePos} בתור המדווחים</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => leaveReporterQueue(matchId))}>
        יציאה מהתור
      </Button>
    </div>
  ) : (
    <div className="ip-btn-row">
      <Button size="sm" variant="secondary" icon="plus" disabled={busy} onClick={() => void run(() => joinReporterQueue(matchId), 'הצטרפת לתור המדווחים')}>
        הצטרפות לתור המדווחים
      </Button>
    </div>
  );

  if (offerToMe) {
    return (
      <Card tone="live" className="ip-live-offer">
        <strong>תורך לדווח על המשחק</strong>
        <p>המדווח/ת הקודם/ת הפסיק/ה לדווח. המשחק ממשיך מאותו מצב. נשארו {offerLeft} שניות לענות.</p>
        <div className="ip-btn-row">
          <Button variant="primary" icon="check" disabled={busy} onClick={() => void run(() => answerReporterOffer(matchId, true), 'את/ה המדווח/ת הראשי/ת')}>
            אני מדווח/ת
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => answerReporterOffer(matchId, false))}>
            לא עכשיו
          </Button>
        </div>
      </Card>
    );
  }

  if (isReporter) {
    return (
      <Card className="ip-live-panel">
        <div className="ip-carpool-head">
          <strong>את/ה המדווח/ת הראשי/ת</strong>
          {session.queue.length > 0 && <Tag>{session.queue.length} בתור</Tag>}
        </div>
        {status === 'not_started' && (
          <Button variant="primary" block icon="whistle" disabled={busy} onClick={() => void run(() => matchClock(matchId, 'start'), 'המשחק התחיל, השעון רץ')}>
            התחלת משחק
          </Button>
        )}
        {status === 'running' && (
          <div className="ip-btn-row">
            <Button variant="secondary" icon="whistle" disabled={busy} onClick={() => void run(() => matchClock(matchId, 'end_period'), `סוף מחצית ${session.period}`)}>
              סיום מחצית {session.period}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => confirm('לסיים את המשחק?') && void run(() => matchClock(matchId, 'finish'))}>
              סיום משחק
            </Button>
          </div>
        )}
        {status === 'break' && (
          <div className="ip-btn-row">
            <Button variant="primary" icon="whistle" disabled={busy} onClick={() => void run(() => matchClock(matchId, 'start_period'), `מחצית ${session.period + 1} התחילה`)}>
              פתיחת מחצית {session.period + 1}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => confirm('לסיים את המשחק?') && void run(() => matchClock(matchId, 'finish'))}>
              סיום משחק
            </Button>
          </div>
        )}
        {status === 'finished' && !finalized && (
          <FinalForm final={final} setFinal={setFinal} homeName={homeName} awayName={awayName} busy={busy}
            onConfirm={() => void run(() => finalizeResult(matchId, Number(final.h), Number(final.a)), 'התוצאה הסופית אושרה')}
            onReopen={() => void run(() => matchClock(matchId, 'reopen'))} />
        )}
        {status !== 'finished' && <p className="ip-footnote">השעון ממשיך לרוץ גם בעצירות. עוצרים אותו רק בסוף מחצית.</p>}
        {status !== 'finished' && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => confirm('להפסיק לדווח? התפקיד יוצע להורה הבא בתור.') && void run(() => releaseReporter(matchId), 'הפסקת לדווח')}>
            הפסק לדווח
          </Button>
        )}
      </Card>
    );
  }

  if (finalized) return null;

  // Staff may finish / confirm when the game ended without a primary.
  if (status === 'finished' && isStaff && !session.reporter_id) {
    return (
      <Card className="ip-live-panel">
        <FinalForm final={final} setFinal={setFinal} homeName={homeName} awayName={awayName} busy={busy}
          onConfirm={() => void run(() => finalizeResult(matchId, Number(final.h), Number(final.a)), 'התוצאה הסופית אושרה')} />
      </Card>
    );
  }

  if (session.reporter_id) {
    return (
      <Card className="ip-live-panel">
        <p>
          <strong>{session.reporter_label ?? 'הורה'}</strong> כבר משמש/ת כמדווח/ת הראשי/ת במשחק. הדיווחים שלך יישלחו אליו/ה לאישור.
        </p>
        {queueRow}
        {isStaff && (
          <button type="button" className="ip-link-btn" onClick={() => confirm('לקחת את תפקיד המדווח/ת כצוות הקבוצה?') && void run(() => claimReporter(matchId, true))}>
            צוות: לקיחת התפקיד
          </button>
        )}
      </Card>
    );
  }

  if (session.offer_to) {
    return (
      <Card className="ip-live-panel">
        <p>
          תפקיד המדווח/ת הוצע ל<strong>{session.offer_label ?? 'הורה בתור'}</strong> ({offerLeft} שניות).
        </p>
        {queueRow}
      </Card>
    );
  }

  return (
    <Card className="ip-live-panel">
      <p>
        <strong>אף אחד לא מדווח כרגע.</strong> מדווח/ת ראשי/ת מפעיל/ה את השעון, מנהל/ת מחציות ומאשר/ת את הדיווחים של כולם.
      </p>
      <Button variant="primary" block icon="live" disabled={busy} onClick={() => void run(() => claimReporter(matchId), 'את/ה המדווח/ת הראשי/ת')}>
        אני אדווח על המשחק
      </Button>
    </Card>
  );
}

function FinalForm({
  final,
  setFinal,
  homeName,
  awayName,
  busy,
  onConfirm,
  onReopen,
}: {
  final: { h: string; a: string };
  setFinal: (f: { h: string; a: string }) => void;
  homeName: string;
  awayName: string;
  busy: boolean;
  onConfirm: () => void;
  onReopen?: () => void;
}) {
  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 3);
  return (
    <div className="ip-live-final">
      <strong>אישור התוצאה הסופית</strong>
      <div className="ip-live-final-row">
        <label>
          <span>{homeName}</span>
          <input id="final-home" className="ip-input" inputMode="numeric" dir="ltr" value={final.h} onChange={(e) => setFinal({ ...final, h: clean(e.target.value) })} />
        </label>
        <label>
          <span>{awayName}</span>
          <input id="final-away" className="ip-input" inputMode="numeric" dir="ltr" value={final.a} onChange={(e) => setFinal({ ...final, a: clean(e.target.value) })} />
        </label>
      </div>
      <div className="ip-btn-row">
        <Button variant="primary" icon="check" disabled={busy || final.h === '' || final.a === ''} onClick={onConfirm}>
          אישור תוצאה סופית
        </Button>
        {onReopen && (
          <Button variant="ghost" disabled={busy} onClick={onReopen}>
            המשחק לא נגמר
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sheets */

function PlayerPicker({
  num,
  setNum,
  ours,
  roster,
  byNumber,
  mine,
}: {
  num: string;
  setNum: (v: string) => void;
  ours: boolean;
  roster: Player[];
  byNumber: Map<number, Player>;
  mine: Set<string>;
}) {
  const n = num === '' ? null : Number(num);
  const found = ours && n != null ? byNumber.get(n) : undefined;
  const numbered = roster.filter((p) => p.shirt_number != null).sort((a, b) => a.shirt_number! - b.shirt_number!);
  return (
    <>
      <fieldset>
        <legend>מספר חולצה (לא חובה)</legend>
        <input
          id="live-shirt"
          className="ip-input ip-live-shirt"
          inputMode="numeric"
          dir="ltr"
          placeholder="למשל 9"
          value={num}
          onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
        />
        {ours && n != null && (
          <p className={found ? 'ip-live-found' : 'ip-muted'}>{found ? `${found.first_name} ${found.last_name}` : 'אין בסגל שחקן עם המספר הזה. נשמור את המספר בלבד.'}</p>
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
    </>
  );
}

function SidePicker({ side, setSide, sideName, allowUnknown }: { side: Side | null; setSide: (s: Side | null) => void; sideName: (s: Side | null) => string; allowUnknown: boolean }) {
  const opts: (Side | null)[] = allowUnknown ? ['home', 'away', null] : ['home', 'away'];
  return (
    <fieldset>
      <legend>לאיזו קבוצה?</legend>
      <div className={`ip-choice-row ${allowUnknown ? 'ip-choice-row--3' : ''}`}>
        {opts.map((s) => (
          <button key={s ?? 'x'} type="button" className={side === s ? 'is-on' : ''} aria-pressed={side === s} onClick={() => setSide(s)}>
            {s ? sideName(s) : 'לא יודע/ת'}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function DetailsSheet({
  target,
  ourSide,
  sideName,
  roster,
  byNumber,
  mine,
  goalTypes,
  onClose,
  onSave,
}: {
  target: DetailsTarget | null;
  ourSide: Side;
  sideName: (s: Side | null) => string;
  roster: Player[];
  byNumber: Map<number, Player>;
  mine: Set<string>;
  goalTypes: boolean;
  onClose: () => void;
  onSave: (side: Side | null, shirt: number | null, name: string | null, goalType?: GoalType | null) => Promise<void>;
}) {
  const [num, setNum] = useState('');
  const [gType, setGType] = useState<GoalType | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setNum(target.type === 'event' && target.event.shirt_number != null ? String(target.event.shirt_number) : '');
    setSide(target.type === 'event' ? target.event.side : target.side);
    setName('');
    setGType(target.type === 'event' ? target.event.goal_type ?? null : null);
    setError(null);
  }, [target]);
  const showTypes = goalTypes && target?.type === 'event' && (target.event.kind ?? 'goal') === 'goal';
  const typeChanged = showTypes && target?.type === 'event' && gType !== (target.event.goal_type ?? null);

  const isReport = target?.type === 'report';
  const ours = side === ourSide || (side === null && num !== '' && byNumber.has(Number(num)));

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    try {
      await onSave(side, clear || num === '' ? null : Number(num), name.trim() || null, showTypes ? gType : undefined);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const title = target?.type === 'event' ? `מי ${target.event.kind && target.event.kind !== 'goal' ? 'קיבל/ה את הכרטיס' : 'הבקיע/ה'} ל${sideName(target.event.side)}?` : 'השלמת פרטים לדיווח';
  return (
    <BottomSheet open={target !== null} onClose={onClose} title={title}>
      <div className="ip-report">
        {isReport && <SidePicker side={side} setSide={setSide} sideName={sideName} allowUnknown />}
        <PlayerPicker num={num} setNum={setNum} ours={ours} roster={roster} byNumber={byNumber} mine={mine} />
        {showTypes && (
          <fieldset>
            <legend>איך נכבש? (לא חובה)</legend>
            <div className="ip-player-chips">
              {(['free_kick', 'penalty', 'header', 'own_goal'] as GoalType[]).map((t) => (
                <button key={t} type="button" className={gType === t ? 'is-on' : ''} aria-pressed={gType === t} onClick={() => setGType(gType === t ? null : t)}>
                  {goalTypeLabel[t]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {isReport && (
          <fieldset>
            <legend>שם השחקן/ית (לא חובה)</legend>
            <input id="live-name" className="ip-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="אם יודעים" />
          </fieldset>
        )}
        {error && <p className="ip-error" role="alert">{error}</p>}
        <Button variant="primary" block icon="check" disabled={busy || (!isReport && num === '' && !typeChanged)} onClick={() => void save()}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
        {target?.type === 'event' && target.event.shirt_number != null ? (
          <Button variant="ghost" block disabled={busy} onClick={() => void save(true)}>
            הסרת השחקן מהדיווח
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

function FullReportSheet({
  open,
  basket,
  ourSide,
  sideName,
  roster,
  byNumber,
  mine,
  onClose,
  onSend,
}: {
  open: boolean;
  basket: boolean;
  ourSide: Side;
  sideName: (s: Side | null) => string;
  roster: Player[];
  byNumber: Map<number, Player>;
  mine: Set<string>;
  onClose: () => void;
  onSend: (r: { kind: EventKind2; side: Side | null; points: number; shirt: number | null; name: string | null }) => Promise<void>;
}) {
  const [kind, setKind] = useState<EventKind2>('goal');
  const [side, setSide] = useState<Side | null>(null);
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [points, setPoints] = useState(2);

  useEffect(() => {
    if (open) {
      setKind('goal');
      setSide(null);
      setNum('');
      setName('');
    }
  }, [open]);

  const ours = side === ourSide || (side === null && num !== '' && byNumber.has(Number(num)));
  const enough = side !== null || num !== '' || name.trim() !== '';

  return (
    <BottomSheet open={open} onClose={onClose} title="דיווח על אירוע">
      <div className="ip-report">
        {!basket && (
          <fieldset>
            <legend>מה קרה?</legend>
            <div className="ip-choice-row ip-choice-row--3">
              {(['goal', 'yellow', 'red'] as EventKind2[]).map((k) => (
                <button key={k} type="button" className={kind === k ? 'is-on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {kindWord(k, false)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {basket && (
          <fieldset>
            <legend>כמה נקודות?</legend>
            <div className="ip-choice-row ip-choice-row--3">
              {[1, 2, 3].map((p) => (
                <button key={p} type="button" className={points === p ? 'is-on' : ''} aria-pressed={points === p} onClick={() => setPoints(p)}>
                  <strong>{p}</strong>
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <SidePicker side={side} setSide={setSide} sideName={sideName} allowUnknown />
        <PlayerPicker num={num} setNum={setNum} ours={ours} roster={roster} byNumber={byNumber} mine={mine} />
        <fieldset>
          <legend>שם השחקן/ית (לא חובה)</legend>
          <input id="live-full-name" className="ip-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="אם יודעים" />
        </fieldset>
        <Button
          variant="primary"
          block
          icon="check"
          disabled={!enough}
          onClick={() => void onSend({ kind: basket ? 'goal' : kind, side, points: basket ? points : 1, shirt: num === '' ? null : Number(num), name: name.trim() || null })}
        >
          שליחת הדיווח
        </Button>
        <p className="ip-footnote ip-center">אפשר לדווח רק מה שיודעים. המדווח/ת הראשי/ת ישלים/תשלים את השאר.</p>
      </div>
    </BottomSheet>
  );
}
