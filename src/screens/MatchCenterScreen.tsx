/**
 * LIVE match center: scoreboard, the selected child's numbers, the event
 * timeline, and goal/basket reporting from the stands. Reports go through
 * the shared live store so the home screen updates at the same time.
 */
import { useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, LiveBadge, SectionHeader, Scoreline, Tag } from '../components/ui';
import { useLive } from '../data/liveStore';
import { teams } from '../data/team';
import { parent, type Child, type LiveUpdate } from '../data/demo';

export function MatchCenterScreen({ child, onBack }: { child: Child; onBack: () => void }) {
  const { live, report, undo } = useLive(child.id);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (!live) {
    return (
      <div className="ip-stack">
        <BackBar onBack={onBack} title="מרכז המשחק" />
        <Card>
          <div className="ip-empty">
            <span className="ip-icon-tile ip-icon-tile--blue ip-icon-tile--lg">
              <Icon name="live" size={26} />
            </span>
            <strong>אין משחק חי כרגע</strong>
            <p className="ip-muted">
              המשחק הבא: {child.nextMatch.dateLabel} · {child.nextMatch.kickoff}. מרכז המשחק ייפתח בשריקת הפתיחה.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const isLive = live.status === 'live';
  const lastReported = live.updates[0]?.reported;

  return (
    <div className="ip-stack">
      <BackBar onBack={onBack} title="מרכז המשחק" trailing={isLive && live.watching ? <span className="ip-watching"><Icon name="eye" size={16} /> {live.watching} צופים</span> : undefined} />

      <Card tone={isLive ? 'live' : 'default'} className="ip-scoreboard">
        <div className="ip-score-status">{isLive ? <LiveBadge label={`LIVE · ${live.period}`} /> : <Tag>{live.period}</Tag>}</div>
        <Scoreline home={live.home} away={live.away} homeScore={live.homeScore} awayScore={live.awayScore} size="lg" />
        {isLive && (
          <p className="ip-muted ip-scoreboard-venue">
            <Icon name="pin" size={16} /> {child.nextMatch.venue}
          </p>
        )}
        {isLive && (
          <Button variant="lime" block icon="goal" onClick={() => setSheet(true)}>
            דיווח על {isBasketball(child) ? 'סל' : 'שער'}
          </Button>
        )}
      </Card>

      {live.myStats && (
        <section>
          <SectionHeader title={`${child.firstName} במשחק`} icon="user" />
          <div className="ip-stats">
            {live.myStats.map((s, i) => (
              <div key={s.label} className={`ip-stat ${i === 0 ? 'ip-stat--accent' : ''}`}>
                <span className="ip-stat-value">{s.value}</span>
                <span className="ip-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="מהלך המשחק" icon="clock" />
        <Card padded={false}>
          <ol className="ip-timeline-live">
            {live.updates.map((u, i) => (
              <TimelineItem key={i} u={u} />
            ))}
          </ol>
        </Card>
        {lastReported && (
          <button type="button" className="ip-undo" onClick={() => { undo(); setToast('הדיווח האחרון בוטל'); }}>
            <Icon name="undo" size={18} /> ביטול הדיווח האחרון שלי
          </button>
        )}
      </section>

      <p className="ip-footnote">דיווחים מהיציע מסומנים בשם המדווח · המאמן יכול לתקן כל דיווח</p>

      <ReportSheet
        open={sheet}
        child={child}
        home={live.home}
        away={live.away}
        onClose={() => setSheet(false)}
        onSubmit={(r) => {
          report(r);
          setSheet(false);
          setToast('הדיווח נשלח לכל ההורים בקבוצה');
        }}
      />
      {toast && (
        <div className="ip-toast" role="status" onAnimationEnd={() => setToast(null)}>
          <Icon name="check" size={18} /> {toast}
        </div>
      )}
    </div>
  );
}

const isBasketball = (c: Child) => c.sport === 'כדורסל';

function BackBar({ onBack, title, trailing }: { onBack: () => void; title: string; trailing?: ReactNode }) {
  return (
    <div className="ip-backbar">
      <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
        <Icon name="back" size={20} />
      </button>
      <h1>{title}</h1>
      {trailing ?? <span />}
    </div>
  );
}

function TimelineItem({ u }: { u: LiveUpdate }) {
  const icon = u.kind === 'goal' ? 'goal' : u.kind === 'card' ? 'card' : 'whistle';
  return (
    <li className={`ip-tl ip-tl--${u.kind} ${u.mine ? 'is-mine' : ''} ${u.side === 'away' ? 'is-away' : ''}`}>
      <span className="ip-tl-min">{u.minute}</span>
      <span className={`ip-tl-dot ip-tl-dot--${u.kind}`}>
        <Icon name={icon} size={16} strokeWidth={2.2} />
      </span>
      <span className="ip-tl-body">
        <span className="ip-tl-text">
          {u.text}
          {u.points && u.points > 1 ? <span className="ip-tl-pts">+{u.points}</span> : null}
        </span>
        {(u.reporter || u.reported) && <span className="ip-tl-meta">{u.reported ? `דיווח: ${parent.firstName} ${parent.lastName} · עכשיו` : u.reporter}</span>}
      </span>
    </li>
  );
}

function ReportSheet({
  open,
  child,
  home,
  away,
  onClose,
  onSubmit,
}: {
  open: boolean;
  child: Child;
  home: string;
  away: string;
  onClose: () => void;
  onSubmit: (r: { side: 'home' | 'away'; points: number; scorer?: string; assist?: string; mine?: boolean; mineAs?: 'scorer' | 'assist' }) => void;
}) {
  const basket = isBasketball(child);
  const roster = teams[child.id]?.roster ?? [];
  const mineName = `${child.firstName} ${child.lastName}`;
  const [side, setSide] = useState<'home' | 'away'>('home');
  const [points, setPoints] = useState(basket ? 2 : 1);
  const [scorer, setScorer] = useState<string>(mineName);
  const [assist, setAssist] = useState<string>('');
  const ours = side === 'home';

  return (
    <BottomSheet open={open} onClose={onClose} title={`דיווח על ${basket ? 'סל' : 'שער'}`}>
      <div className="ip-report">
        <fieldset>
          <legend>לאיזו קבוצה?</legend>
          <div className="ip-choice-row">
            <button type="button" className={ours ? 'is-on' : ''} aria-pressed={ours} onClick={() => setSide('home')}>
              {home}
            </button>
            <button type="button" className={!ours ? 'is-on' : ''} aria-pressed={!ours} onClick={() => setSide('away')}>
              {away}
            </button>
          </div>
        </fieldset>

        {basket && (
          <fieldset>
            <legend>כמה נקודות?</legend>
            <div className="ip-choice-row ip-choice-row--3">
              {[1, 2, 3].map((p) => (
                <button key={p} type="button" className={points === p ? 'is-on' : ''} aria-pressed={points === p} onClick={() => setPoints(p)}>
                  <strong>{p}</strong>
                  <span>{p === 1 ? 'עונשין' : p === 2 ? 'סל' : 'שלשה'}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {ours && (
          <>
            <fieldset>
              <legend>מי {basket ? 'קלע' : 'כבש'}?</legend>
              <div className="ip-player-chips">
                {roster.map((p) => (
                  <button key={p.name} type="button" className={`${scorer === p.name ? 'is-on' : ''} ${p.childId === child.id ? 'is-mine' : ''}`} aria-pressed={scorer === p.name} onClick={() => setScorer(p.name)}>
                    <span className="ip-chip-no">{p.number}</span>
                    {p.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{basket ? 'אסיסט' : 'בישול'} (לא חובה)</legend>
              <div className="ip-player-chips">
                <button type="button" className={assist === '' ? 'is-on' : ''} aria-pressed={assist === ''} onClick={() => setAssist('')}>
                  ללא
                </button>
                {roster
                  .filter((p) => p.name !== scorer)
                  .map((p) => (
                    <button key={p.name} type="button" className={assist === p.name ? 'is-on' : ''} aria-pressed={assist === p.name} onClick={() => setAssist(p.name)}>
                      {p.name.split(' ')[0]}
                    </button>
                  ))}
              </div>
            </fieldset>
          </>
        )}

        <Button
          variant="primary"
          block
          icon="check"
          onClick={() =>
            onSubmit({
              side,
              points: basket ? points : 1,
              scorer: ours ? scorer : undefined,
              assist: ours && assist ? assist : undefined,
              mine: ours && (scorer === mineName || assist === mineName),
              mineAs: !ours ? undefined : scorer === mineName ? 'scorer' : assist === mineName ? 'assist' : undefined,
            })
          }
        >
          שליחת הדיווח
        </Button>
        <p className="ip-footnote ip-center">כל ההורים בקבוצה יקבלו התראה מיידית</p>
      </div>
    </BottomSheet>
  );
}
