/** Career overview preview — per child, season-level progress. */
import { Avatar } from '../components/Avatar';
import { CareerChart } from '../components/CareerChart';
import { Icon } from '../components/Icon';
import { Card, ProgressBar, SectionHeader, StatTile, Tag } from '../components/ui';
import type { Child } from '../data/demo';

export function CareerScreen({ child, onSwitchChild }: { child: Child; onSwitchChild: () => void }) {
  const c = child.career;
  const isBasket = child.sport === 'כדורסל';
  const goalsLabel = isBasket ? 'נקודות' : 'שערים';
  const assistsLabel = isBasket ? 'אסיסטים' : 'בישולים';
  const perGame = c.appearances ? (c.goals / c.appearances).toFixed(1) : '0';
  return (
    <div className="ip-stack" key={child.id}>
      <Card tone="navy" className="ip-career-hero">
        <button type="button" className="ip-career-hero-id" onClick={onSwitchChild} aria-label="החלפת ילד">
          <Avatar size={56} name={child.firstName} jersey={child.jersey} hair={child.hair} hairStyle={child.hairStyle} ring />
          <span>
            <strong>
              {child.firstName} {child.lastName}
            </strong>
            <span className="ip-on-navy-muted">
              #{child.number} · {child.position} · {child.team}
            </span>
          </span>
          <Icon name="chevronDown" size={18} />
        </button>
        <div className="ip-career-hero-stats">
          <div>
            <strong>{c.appearances}</strong>
            <span>הופעות</span>
          </div>
          <div>
            <strong className="ip-lime-text">{c.goals}</strong>
            <span>{goalsLabel}</span>
          </div>
          <div>
            <strong>{c.assists}</strong>
            <span>{assistsLabel}</span>
          </div>
          <div>
            <strong>{c.minutes}</strong>
            <span>דקות משחק</span>
          </div>
        </div>
        <span className="ip-on-navy-muted">עונת {child.season} · {child.club}</span>
      </Card>

      <section>
        <SectionHeader title="מגמה לפי חודש" icon="career" />
        <Card>
          <CareerChart data={c.monthly} goalsLabel={goalsLabel} assistsLabel={assistsLabel} />
          <div className="ip-stats ip-stats--compact">
            <StatTile value={perGame} label={`${goalsLabel} למשחק`} />
            <StatTile value={`${Math.round((c.minutes / Math.max(1, c.appearances)) * 10) / 10}`} label="דקות למשחק" />
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="התקדמות אתלטית" icon="bolt" />
        <Card>
          <div className="ip-progress-list">
            {c.attributes.map((a) => (
              <ProgressBar key={a.label} label={a.label} value={a.value} delta={a.delta} />
            ))}
          </div>
          <p className="ip-footnote">מבוסס על הערכת המאמן ומבדקי הכושר האחרונים · השינוי מוצג ביחס להערכה הקודמת</p>
        </Card>
      </section>

      <section>
        <SectionHeader title="רגעים מיוחדים" icon="star" />
        <Card padded={false}>
          <ol className="ip-timeline">
            {c.highlights.map((h) => (
              <li key={h.date + h.title}>
                <span className={`ip-icon-tile ip-icon-tile--${h.icon === 'star' ? 'lime' : 'blue'}`}>
                  <Icon name={h.icon} size={20} />
                </span>
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{h.title}</span>
                  <span className="ip-list-row-sub">{h.detail}</span>
                </span>
                <Tag>{h.date}</Tag>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
