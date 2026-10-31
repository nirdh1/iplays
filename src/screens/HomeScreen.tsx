/**
 * Home — child-first. Everything on this screen is scoped to the selected child.
 * Order: child card → next match → next training → live/goals → week →
 * carpool → community → career snapshot.
 */
import { useState } from 'react';
import { Avatar, InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Button, Card, ListRow, LiveBadge, MetaRow, ProgressBar, Scoreline, SectionHeader, StatTile, Tag, TeamCrest } from '../components/ui';
import { today, weekDays, type Child, type EventKind } from '../data/demo';
import { useLive } from '../data/liveStore';
import type { TabId } from '../components/shell';
import { IfaFixturesCard } from './IfaFixturesCard';

const kindLabel: Record<EventKind, string> = { match: 'משחק', team: 'אימון קבוצתי', private: 'אימון אישי' };
const kindTone: Record<EventKind, 'navy' | 'blue' | 'lime'> = { match: 'navy', team: 'blue', private: 'lime' };

export function HomeScreen({ child, onNavigate, onSwitchChild, onOpenMatch }: { child: Child; onNavigate: (t: TabId) => void; onSwitchChild: () => void; onOpenMatch: () => void }) {
  return (
    <div className="ip-stack" key={child.id}>
      <ChildCard child={child} onCareer={() => onNavigate('career')} onSwitch={onSwitchChild} />
      <IfaFixturesCard limit={3} />
      <NextMatchCard child={child} />
      <NextTrainingCard child={child} />
      <LiveCard child={child} onOpen={onOpenMatch} />
      <WeekCard child={child} onOpen={() => onNavigate('calendar')} />
      <CarpoolCard child={child} onOpen={() => onNavigate('family')} />
      <CommunityCard child={child} onOpen={() => onNavigate('team')} />
      <CareerSnapshot child={child} onOpen={() => onNavigate('career')} />
      <p className="ip-tagline">
        <span dir="ltr">iplays</span> · המשחק שלהם. העולם שלך.
      </p>
    </div>
  );
}

/* 0 — Selected child */
function ChildCard({ child, onCareer, onSwitch }: { child: Child; onCareer: () => void; onSwitch: () => void }) {
  const m = child.nextMatch;
  return (
    <Card tone="navy" className="ip-child-card" as="section" aria-label={`כרטיס ${child.firstName}`}>
      <div className="ip-child-card-top">
        <button type="button" className="ip-child-card-photo" onClick={onSwitch} aria-label="החלפת ילד">
          <Avatar size={76} name={child.firstName} jersey={child.jersey} hair={child.hair} hairStyle={child.hairStyle} ring />
          <span className="ip-jersey-no">{child.number}</span>
        </button>
        <div className="ip-child-card-id">
          <h1>
            {child.firstName} {child.lastName}
          </h1>
          <p>{child.club}</p>
          <p className="ip-on-navy-muted">
            {child.team} · עונת {child.season}
          </p>
        </div>
      </div>

      <div className="ip-child-card-next">
        <span className="ip-on-navy-muted">המשחק הבא</span>
        <strong>
          מול {m.home === child.club ? m.away : m.home}
        </strong>
        <span>
          {m.dateLabel} · {m.kickoff}
        </span>
      </div>

      {child.notifications.length > 0 && (
        <ul className="ip-child-notes">
          {child.notifications.map((n) => (
            <li key={n.id} className={n.tone === 'action' ? 'is-action' : ''}>
              <span className="ip-note-dot" aria-hidden />
              <span>{n.text}</span>
              <time>{n.time}</time>
            </li>
          ))}
        </ul>
      )}

      <Button variant="lime" block icon="career" onClick={onCareer}>
        לדשבורד הקריירה של {child.firstName}
      </Button>
    </Card>
  );
}

/* 1 — Next match */
function NextMatchCard({ child }: { child: Child }) {
  const m = child.nextMatch;
  const isLiveNow = child.live?.status === 'live';
  return (
    <section>
      <SectionHeader title="המשחק הבא" icon="ball" action="כל המשחקים" />
      <Card>
        <div className="ip-match-meta">
          <span className="ip-muted">{m.competition}</span>
          {isLiveNow ? <LiveBadge /> : <Tag tone="navy">{m.dateLabel}</Tag>}
        </div>
        <div className="ip-match-teams">
          <div className="ip-match-team">
            <TeamCrest name={m.homeShort} tone={m.home === child.club ? 'blue' : 'neutral'} />
            <span>{m.home}</span>
          </div>
          <div className="ip-match-time">
            <strong>{m.kickoff}</strong>
            <span className="ip-muted">שריקת פתיחה</span>
          </div>
          <div className="ip-match-team">
            <TeamCrest name={m.awayShort} tone={m.away === child.club ? 'blue' : 'neutral'} />
            <span>{m.away}</span>
          </div>
        </div>
        <div className="ip-divider" />
        <MetaRow icon="pin">
          {m.venue} · {m.address}
        </MetaRow>
        <MetaRow icon="clock">הגעה עד {m.arrival}</MetaRow>
        <div className="ip-btn-row">
          <Button variant="primary" icon="navigate">
            ניווט למגרש
          </Button>
          <Button variant="secondary" icon="check">
            אישור הגעה
          </Button>
        </div>
      </Card>
    </section>
  );
}

/* 2 — Next training */
function NextTrainingCard({ child }: { child: Child }) {
  const t = child.nextTraining;
  return (
    <section>
      <SectionHeader title="האימון הבא" icon="whistle" />
      <Card className="ip-training">
        <div className={`ip-date-tile ip-date-tile--${kindTone[t.kind]}`}>
          <span>{t.dateLabel}</span>
          <strong>{t.time.split('–')[0]}</strong>
        </div>
        <div className="ip-training-body">
          <div className="ip-training-title">
            <strong>{t.title}</strong>
            <Tag tone={kindTone[t.kind]}>{kindLabel[t.kind]}</Tag>
          </div>
          <span className="ip-muted">
            {t.time} · {t.place}
          </span>
          <span className="ip-muted">{t.coach}</span>
          <span className="ip-training-bring">
            <Icon name="check" size={16} /> להביא: {t.bring}
          </span>
        </div>
      </Card>
    </section>
  );
}

/* 3 — Live match / goal notifications */
function LiveCard({ child, onOpen }: { child: Child; onOpen: () => void }) {
  const { live: l } = useLive(child.id);
  if (!l) return null;
  const live = l.status === 'live';
  return (
    <section>
      <SectionHeader title={live ? 'משחק חי' : 'עדכוני משחק'} icon="live" action="מרכז המשחק" onAction={onOpen} />
      <Card tone={live ? 'live' : 'default'}>
        <Scoreline home={l.home} away={l.away} homeScore={l.homeScore} awayScore={l.awayScore} />
        <div className="ip-score-status">{live ? <LiveBadge label={`LIVE · ${l.period}`} /> : <Tag>{l.period}</Tag>}</div>
        <ul className="ip-feed">
          {l.updates.slice(0, 3).map((u, i) => (
            <li key={i} className={u.mine ? 'is-mine' : ''}>
              <span className="ip-feed-min">{u.minute}</span>
              <Icon name={u.kind === 'goal' ? 'goal' : u.kind === 'card' ? 'card' : 'whistle'} size={18} />
              <span>{u.text}</span>
            </li>
          ))}
        </ul>
        {live && (
          <Button variant="secondary" block icon="goal" onClick={onOpen}>
            דיווח על {child.sport === 'כדורסל' ? 'סל' : 'שער'}
          </Button>
        )}
      </Card>
    </section>
  );
}

/* 4 — Weekly schedule */
function WeekCard({ child, onOpen }: { child: Child; onOpen: () => void }) {
  const firstWithEvent = child.week[0]?.day ?? 0;
  const [day, setDay] = useState(firstWithEvent);
  const items = child.week.filter((w) => w.day === day);
  return (
    <section>
      <SectionHeader title={`השבוע של ${child.firstName}`} icon="calendar" action="ליומן" onAction={onOpen} />
      <Card>
        <div className="ip-day-strip" role="tablist" aria-label="ימי השבוע">
          {weekDays.map((d, i) => {
            const kinds = [...new Set(child.week.filter((w) => w.day === i).map((w) => w.kind))];
            return (
              <button key={d.short} type="button" role="tab" aria-selected={day === i} className={`ip-day ${day === i ? 'is-selected' : ''}`} onClick={() => setDay(i)}>
                <span className="ip-day-name">{d.short}</span>
                <span className="ip-day-date">{d.date.split('.')[0]}</span>
                <span className="ip-day-dots">
                  {kinds.map((k) => (
                    <i key={k} className={`ip-ev-dot ip-ev-dot--${k}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ip-week-list">
          {items.length === 0 ? (
            <p className="ip-muted ip-week-empty">יום חופשי — אין אירועים</p>
          ) : (
            items.map((w) => (
              <div key={w.id} className={`ip-week-item ip-week-item--${w.kind}`}>
                <strong className="ip-week-time">{w.time}</strong>
                <span className="ip-week-text">
                  <span>{w.title}</span>
                  <span className="ip-muted">{w.place}</span>
                </span>
                <Tag tone={kindTone[w.kind]}>{kindLabel[w.kind]}</Tag>
              </div>
            ))
          )}
        </div>
        <div className="ip-legend">
          <span><i className="ip-ev-dot ip-ev-dot--match" />משחק</span>
          <span><i className="ip-ev-dot ip-ev-dot--team" />אימון קבוצתי</span>
          <span><i className="ip-ev-dot ip-ev-dot--private" />אימון אישי</span>
        </div>
      </Card>
    </section>
  );
}

/* 5 — Carpool */
function CarpoolCard({ child, onOpen }: { child: Child; onOpen: () => void }) {
  const c = child.carpool;
  const status = {
    confirmed: { tone: 'lime' as const, label: 'מאושר' },
    'needs-driver': { tone: 'warning' as const, label: 'חסר נהג' },
    pending: { tone: 'blue' as const, label: 'ממתין לאישור' },
  }[c.status];
  return (
    <section>
      <SectionHeader title="הסעות" icon="car" action="כל ההסעות" onAction={onOpen} />
      <Card>
        <div className="ip-carpool-head">
          <strong>{c.title}</strong>
          <Tag tone={status.tone}>{status.label}</Tag>
        </div>
        <MetaRow icon="user">{c.driver}</MetaRow>
        <MetaRow icon="clock">
          יציאה {c.departure} · {c.from}
        </MetaRow>
        <div className="ip-seats" aria-label={`${c.seats.taken} מתוך ${c.seats.total} מקומות תפוסים`}>
          {Array.from({ length: c.seats.total }, (_, i) => (
            <span key={i} className={`ip-seat ${i < c.seats.taken ? 'is-taken' : ''}`}>
              {i < c.seats.taken ? c.passengers[i]?.[0] : ''}
            </span>
          ))}
          <span className="ip-muted">
            {c.seats.taken}/{c.seats.total} מקומות
          </span>
        </div>
        {c.status === 'needs-driver' ? (
          <Button variant="primary" block icon="car">
            אני יכולה לנהוג
          </Button>
        ) : (
          <Button variant="secondary" block>
            פרטי ההסעה
          </Button>
        )}
      </Card>
    </section>
  );
}

/* 6 — Community */
function CommunityCard({ child, onOpen }: { child: Child; onOpen: () => void }) {
  return (
    <section>
      <SectionHeader title={`קהילת ${child.team}`} icon="chat" action="לקבוצה" onAction={onOpen} />
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
      </Card>
    </section>
  );
}

/* 7 — Career snapshot */
function CareerSnapshot({ child, onOpen }: { child: Child; onOpen: () => void }) {
  const c = child.career;
  const isBasket = child.sport === 'כדורסל';
  return (
    <section>
      <SectionHeader title="תמונת קריירה" icon="career" action="לדשבורד" onAction={onOpen} />
      <Card>
        <div className="ip-stats">
          <StatTile value={c.appearances} label="הופעות" />
          <StatTile value={c.goals} label={isBasket ? 'נקודות' : 'שערים'} accent />
          <StatTile value={c.assists} label={isBasket ? 'אסיסטים' : 'בישולים'} />
        </div>
        <div className="ip-divider" />
        <div className="ip-progress-list">
          {c.attributes.slice(0, 2).map((a) => (
            <ProgressBar key={a.label} label={a.label} value={a.value} delta={a.delta} />
          ))}
        </div>
        <ListRow icon="star" iconTone="lime" title={c.highlights[0].title} subtitle={c.highlights[0].detail} onClick={onOpen} />
      </Card>
      <p className="ip-footnote">נכון ל{today.label}</p>
    </section>
  );
}
