/**
 * Team tab — the selected child's team. Sections: overview, matches,
 * training (with RSVP), team fund, roster. The LIVE match center opens
 * from the overview and the matches list.
 */
import { useState } from 'react';
import { Avatar, InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Button, Card, ListRow, LiveBadge, MetaRow, SectionHeader, Segmented, Tag, TeamCrest } from '../components/ui';
import { useLive } from '../data/liveStore';
import { teams, type Fixture, type TrainingEvent } from '../data/team';
import type { Child } from '../data/demo';

type Section = 'overview' | 'matches' | 'training' | 'fund' | 'roster';
const sections: { id: Section; label: string }[] = [
  { id: 'overview', label: 'סקירה' },
  { id: 'matches', label: 'משחקים' },
  { id: 'training', label: 'אימונים' },
  { id: 'fund', label: 'קופה' },
  { id: 'roster', label: 'סגל' },
];

const shekel = (n: number) => `${n.toLocaleString('he-IL')} ₪`;

export function TeamScreen({ child, onOpenMatch, onOpenCoach }: { child: Child; onOpenMatch: () => void; onOpenCoach: () => void }) {
  const [section, setSection] = useState<Section>('overview');
  const team = teams[child.id];
  return (
    <div className="ip-stack" key={child.id}>
      <TeamHero child={child} />
      <CoachEntry onClick={onOpenCoach} coach={team.coach} />
      <div className="ip-sticky-seg">
        <Segmented items={sections} value={section} onChange={setSection} label="אזורי הקבוצה" />
      </div>
      {section === 'overview' && <Overview child={child} onOpenMatch={onOpenMatch} onSection={setSection} />}
      {section === 'matches' && <Matches child={child} fixtures={team.fixtures} onOpenMatch={onOpenMatch} />}
      {section === 'training' && <Trainings initial={team.trainings} child={child} />}
      {section === 'fund' && <Fund child={child} />}
      {section === 'roster' && <Roster child={child} />}
    </div>
  );
}

function TeamHero({ child }: { child: Child }) {
  const t = teams[child.id];
  const usRow = t.standings.find((s) => s.us);
  return (
    <Card tone="navy" className="ip-team-hero">
      <div className="ip-team-hero-id">
        <TeamCrest name={child.club} tone="lime" size={56} />
        <div>
          <h1>{child.team}</h1>
          <p>{child.club}</p>
          <p className="ip-on-navy-muted">{t.league}</p>
        </div>
      </div>
      <div className="ip-team-hero-stats">
        <div>
          <strong className="ip-lime-text">{usRow ? usRow.pos : '—'}</strong>
          <span>מקום בטבלה</span>
        </div>
        <div>
          <strong>{t.record.w}</strong>
          <span>ניצחונות</span>
        </div>
        <div>
          <strong>{t.record.d}</strong>
          <span>תיקו</span>
        </div>
        <div>
          <strong>{t.record.l}</strong>
          <span>הפסדים</span>
        </div>
      </div>
    </Card>
  );
}

/** Entry to the coach board: announcements, training days, absence reports. */
function CoachEntry({ onClick, coach }: { onClick: () => void; coach: string }) {
  return (
    <button type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={onClick}>
      <span className="ip-icon-tile ip-icon-tile--lime">
        <Icon name="whistle" size={20} />
      </span>
      <span className="ip-list-row-text">
        <span className="ip-list-row-title">לוח המאמן</span>
        <span className="ip-list-row-sub">הודעות מ{coach}, ימי אימון ודיווח איחור / אי־הגעה</span>
      </span>
      <Icon name="chevron" size={18} className="ip-muted" />
    </button>
  );
}

/* ---------- Overview ---------- */
function Overview({ child, onOpenMatch, onSection }: { child: Child; onOpenMatch: () => void; onSection: (s: Section) => void }) {
  const t = teams[child.id];
  const { live } = useLive(child.id);
  const isLive = live?.status === 'live';
  const next = t.fixtures.find((f) => !f.result);
  const lastResult = t.fixtures.find((f) => f.result);
  const nextTraining = t.trainings.find((x) => x.kind === 'team');
  const openFund = t.fund.find((f) => !f.paid);
  return (
    <>
      <section>
        <SectionHeader title="מרכז המשחק" icon="live" />
        <button type="button" className={`ip-card ip-card--padded ip-match-entry ${isLive ? 'ip-card--live' : ''}`} onClick={onOpenMatch}>
          {live ? (
            <>
              <div className="ip-match-meta">
                <span className="ip-muted">{isLive ? 'משחק חי עכשיו' : 'המשחק האחרון'}</span>
                {isLive ? <LiveBadge label={`LIVE · ${live.period}`} /> : <Tag>{live.period}</Tag>}
              </div>
              <div className="ip-match-entry-score">
                <span>{live.home}</span>
                <strong className="ip-score-inline">
                  <span>{live.homeScore}</span>
                  <span className="ip-score-sep">:</span>
                  <span>{live.awayScore}</span>
                </strong>
                <span>{live.away}</span>
              </div>
              <span className="ip-match-entry-cta">
                {isLive ? 'לצפייה ולדיווח על שער / סל' : 'לסיכום המשחק'}
                <Icon name="chevron" size={18} />
              </span>
            </>
          ) : (
            <>
              <div className="ip-match-meta">
                <span className="ip-muted">אין משחק חי כרגע</span>
              </div>
              <p className="ip-match-entry-empty">מרכז המשחק נפתח אוטומטית בשריקת הפתיחה, ותקבלו התראה על כל שער.</p>
            </>
          )}
        </button>
      </section>

      <section>
        <SectionHeader title="בקרוב" icon="calendar" action="כל המשחקים" onAction={() => onSection('matches')} />
        <Card padded={false}>
          {next && (
            <ListRow icon="ball" iconTone="navy" title={`${next.home ? 'בית' : 'חוץ'} מול ${next.opponent}`} subtitle={`${next.date} · ${next.time} · ${next.venue}`} onClick={() => onSection('matches')} />
          )}
          {nextTraining && (
            <ListRow icon="whistle" title={nextTraining.title} subtitle={`${nextTraining.day} · ${nextTraining.time}`} trailing={<RsvpTag rsvp={nextTraining.rsvp} gender={child.gender} />} onClick={() => onSection('training')} />
          )}
          {lastResult?.result && (
            <ListRow
              icon="trophy"
              iconTone="lime"
              title={`${lastResult.result.us > lastResult.result.them ? 'ניצחון' : lastResult.result.us < lastResult.result.them ? 'הפסד' : 'תיקו'} ${lastResult.result.us}–${lastResult.result.them} מול ${lastResult.opponent}`}
              subtitle={lastResult.date}
              onClick={() => onSection('matches')}
            />
          )}
        </Card>
      </section>

      {openFund && (
        <section>
          <SectionHeader title="קופת הקבוצה" icon="wallet" action="לקופה" onAction={() => onSection('fund')} />
          <FundCard item={openFund} compact />
        </section>
      )}

      <section>
        <SectionHeader title="קהילה" icon="chat" />
        <Card padded={false}>
          {child.community.map((p, i) => (
            <article key={p.id} className={`ip-post ${i > 0 ? 'ip-post--sep' : ''}`}>
              <div className="ip-post-head">
                <InitialsAvatar name={p.author} size={40} tone={p.role.includes('קופה') ? 'lime' : 'blue'} />
                <span>
                  <strong>{p.author}</strong>
                  <span className="ip-muted">
                    {p.role} · {p.time}
                  </span>
                </span>
              </div>
              <p>{p.text}</p>
              <div className="ip-post-foot ip-muted">
                <span>👏 {p.reactions}</span>
                <span>{p.comments} תגובות</span>
              </div>
            </article>
          ))}
          <div className="ip-post-compose">
            <Button variant="secondary" block icon="chat">
              כתיבת הודעה לקבוצה
            </Button>
          </div>
        </Card>
      </section>
    </>
  );
}

/* ---------- Matches ---------- */
function Matches({ child, fixtures, onOpenMatch }: { child: Child; fixtures: Fixture[]; onOpenMatch: () => void }) {
  const t = teams[child.id];
  const { live } = useLive(child.id);
  const upcoming = fixtures.filter((f) => !f.result);
  const played = fixtures.filter((f) => f.result);
  return (
    <>
      <section>
        <SectionHeader title="משחקים קרובים" icon="calendar" />
        <Card padded={false}>
          {upcoming.map((f, i) => {
            const isLiveNow = i === 0 && live?.status === 'live';
            return <FixtureRow key={f.id} f={f} club={child.club} live={isLiveNow} onClick={isLiveNow ? onOpenMatch : undefined} />;
          })}
        </Card>
      </section>
      <section>
        <SectionHeader title="תוצאות" icon="trophy" />
        <Card padded={false}>
          {played.map((f, i) => (
            <FixtureRow key={f.id} f={f} club={child.club} onClick={i === 0 && live?.status === 'final' ? onOpenMatch : undefined} />
          ))}
        </Card>
      </section>
      {t.standings.length > 0 && (
        <section>
          <SectionHeader title="טבלה" icon="career" />
          <Card padded={false}>
            <table className="ip-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>קבוצה</th>
                  <th>מש׳</th>
                  <th>נק׳</th>
                </tr>
              </thead>
              <tbody>
                {t.standings.map((r) => (
                  <tr key={r.team} className={r.us ? 'is-us' : ''}>
                    <td>{r.pos}</td>
                    <td>{r.team}</td>
                    <td>{r.played}</td>
                    <td>
                      <strong>{r.points}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </>
  );
}

function FixtureRow({ f, club, live, onClick }: { f: Fixture; club: string; live?: boolean; onClick?: () => void }) {
  const outcome = f.result ? (f.result.us > f.result.them ? 'win' : f.result.us < f.result.them ? 'loss' : 'draw') : undefined;
  const outcomeLabel = { win: 'נ', draw: 'ת', loss: 'ה' };
  const [homeName, awayName] = f.home ? [club, f.opponent] : [f.opponent, club];
  const [hs, as] = f.result ? (f.home ? [f.result.us, f.result.them] : [f.result.them, f.result.us]) : [];
  const Tag_ = onClick ? 'button' : 'div';
  return (
    <Tag_ type={onClick ? 'button' : undefined} className="ip-fixture" onClick={onClick}>
      <span className="ip-fixture-date">
        <span>{f.date}</span>
        <span className="ip-muted">{f.home ? 'בית' : 'חוץ'}</span>
      </span>
      <span className="ip-fixture-teams">
        <span className={f.home ? 'is-us' : ''}>{homeName}</span>
        <span className={!f.home ? 'is-us' : ''}>{awayName}</span>
      </span>
      {f.result ? (
        <span className="ip-fixture-result">
          <span className="ip-fixture-score">
            <span>{hs}</span>
            <span>{as}</span>
          </span>
          <span className={`ip-outcome ip-outcome--${outcome}`} aria-label={{ win: 'ניצחון', draw: 'תיקו', loss: 'הפסד' }[outcome!]}>
            {outcomeLabel[outcome!]}
          </span>
        </span>
      ) : live ? (
        <LiveBadge />
      ) : (
        <strong className="ip-fixture-time">{f.time}</strong>
      )}
    </Tag_>
  );
}

/* ---------- Training ---------- */
const going = (g: Child['gender']) => (g === 'f' ? 'מגיעה' : 'מגיע');

function RsvpTag({ rsvp, gender }: { rsvp: TrainingEvent['rsvp']; gender: Child['gender'] }) {
  if (rsvp === 'yes') return <Tag tone="lime" icon="check">{going(gender)}</Tag>;
  if (rsvp === 'no') return <Tag>לא {going(gender)}</Tag>;
  return <Tag tone="warning">ממתין לאישור</Tag>;
}

function Trainings({ initial, child }: { initial: TrainingEvent[]; child: Child }) {
  const [items, setItems] = useState(initial);
  const setRsvp = (id: string, rsvp: TrainingEvent['rsvp']) =>
    setItems((xs) =>
      xs.map((x) => {
        if (x.id !== id || x.rsvp === rsvp) return x;
        const going = x.going + (rsvp === 'yes' ? 1 : 0) - (x.rsvp === 'yes' ? 1 : 0);
        return { ...x, rsvp, going };
      }),
    );
  return (
    <section>
      <SectionHeader title="אימונים השבוע" icon="whistle" />
      <div className="ip-stack ip-stack--tight">
        {items.map((x) => (
          <Card key={x.id} className="ip-training-event">
            <div className="ip-carpool-head">
              <strong>{x.title}</strong>
              <Tag tone={x.kind === 'team' ? 'blue' : 'lime'}>{x.kind === 'team' ? 'אימון קבוצתי' : 'אימון אישי'}</Tag>
            </div>
            <MetaRow icon="clock">
              {x.day} · {x.time}
            </MetaRow>
            <MetaRow icon="pin">{x.place}</MetaRow>
            {x.kind === 'team' && (
              <div className="ip-attendance">
                <div className="ip-progress-track" aria-hidden>
                  <div className="ip-progress-fill" style={{ width: `${(x.going / x.squad) * 100}%` }} />
                </div>
                <span className="ip-muted">
                  {x.going} מתוך {x.squad} אישרו הגעה
                </span>
              </div>
            )}
            <div className="ip-rsvp" role="group" aria-label={`אישור הגעה של ${child.firstName}: ${x.title} ${x.day}`}>
              <button type="button" className={x.rsvp === 'yes' ? 'is-yes' : ''} aria-pressed={x.rsvp === 'yes'} onClick={() => setRsvp(x.id, 'yes')}>
                <Icon name="check" size={18} /> {going(child.gender)}
              </button>
              <button type="button" className={x.rsvp === 'no' ? 'is-no' : ''} aria-pressed={x.rsvp === 'no'} onClick={() => setRsvp(x.id, 'no')}>
                <Icon name="close" size={18} /> לא {going(child.gender)}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ---------- Fund ---------- */
function FundCard({ item, compact }: { item: (typeof teams)[string]['fund'][number]; compact?: boolean }) {
  const pct = Math.min(100, Math.round((item.raised / item.goal) * 100));
  return (
    <Card>
      <div className="ip-carpool-head">
        <strong>{item.title}</strong>
        {item.paid ? <Tag tone="lime" icon="check">שילמתם</Tag> : <Tag tone="warning">עד {item.due}</Tag>}
      </div>
      <div className="ip-fund-amounts">
        <strong>{shekel(item.raised)}</strong>
        <span className="ip-muted">מתוך {shekel(item.goal)}</span>
      </div>
      <div className="ip-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${item.title}: ${pct}%`}>
        <div className="ip-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {!item.paid && (
        <div className="ip-btn-row">
          <Button variant="primary" icon="wallet">
            תשלום {shekel(item.perFamily)}
          </Button>
          {!compact && <Button variant="ghost">תזכורת</Button>}
        </div>
      )}
    </Card>
  );
}

function Fund({ child }: { child: Child }) {
  const t = teams[child.id];
  const total = t.fund.reduce((s, f) => s + f.raised, 0);
  const owed = t.fund.filter((f) => !f.paid).reduce((s, f) => s + f.perFamily, 0);
  return (
    <>
      <div className="ip-stats ip-stats--compact">
        <div className="ip-stat">
          <span className="ip-stat-value">{shekel(total)}</span>
          <span className="ip-stat-label">נאסף בקופה</span>
        </div>
        <div className={`ip-stat ${owed ? 'ip-stat--accent' : ''}`}>
          <span className="ip-stat-value">{owed ? shekel(owed) : '✓'}</span>
          <span className="ip-stat-label">{owed ? 'לתשלום שלכם' : 'אין חוב פתוח'}</span>
        </div>
      </div>
      <section>
        <SectionHeader title="איסופים פעילים" icon="wallet" />
        <div className="ip-stack ip-stack--tight">
          {t.fund.map((f) => (
            <FundCard key={f.id} item={f} />
          ))}
        </div>
      </section>
      <p className="ip-footnote">הקופה מנוהלת על ידי ועד ההורים · כל תנועה גלויה לכל ההורים בקבוצה</p>
    </>
  );
}

/* ---------- Roster ---------- */
function Roster({ child }: { child: Child }) {
  const t = teams[child.id];
  const players = [...t.roster].sort((a, b) => a.number - b.number);
  return (
    <>
      <section>
        <SectionHeader title="צוות מקצועי" icon="whistle" />
        <Card padded={false}>
          <ListRow icon="whistle" iconTone="navy" title={t.coach} subtitle="מאמן ראשי" trailing={<Button variant="secondary" size="sm" icon="chat">הודעה</Button>} />
          <ListRow icon="whistle" title={t.assistant} subtitle="עוזר מאמן" trailing={<Button variant="secondary" size="sm" icon="chat">הודעה</Button>} />
        </Card>
      </section>
      <section>
        <SectionHeader title={`שחקנים · ${players.length}`} icon="team" />
        <Card padded={false}>
          <ul className="ip-roster">
            {players.map((p) => {
              const mine = p.childId === child.id;
              return (
                <li key={p.name} className={mine ? 'is-mine' : ''}>
                  <span className="ip-roster-no">{p.number}</span>
                  {mine ? (
                    <Avatar size={40} name={child.firstName} jersey={child.jersey} hair={child.hair} hairStyle={child.hairStyle} ring />
                  ) : (
                    <InitialsAvatar name={p.name} size={40} tone="blue" />
                  )}
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">{p.name}</span>
                    <span className="ip-list-row-sub">{p.position}</span>
                  </span>
                  {mine && <Tag tone="lime">{child.gender === 'f' ? 'הבת שלי' : 'הבן שלי'}</Tag>}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>
    </>
  );
}
