/**
 * Calendar and Family tabs. These are NOT redesigned yet — this pass only
 * rebrands them with the shared components and keeps an entry point for the
 * existing capabilities (training events, carpools, family permissions).
 */
import { Card, ListRow, SectionHeader, Tag } from '../components/ui';
import { ScreenTitle } from '../components/shell';
import { Avatar, InitialsAvatar } from '../components/Avatar';
import { children, parent, weekDays, type Child } from '../data/demo';
import { AccountSection } from './AccountSection';
import { IfaFixturesCard } from './IfaFixturesCard';

function NextPassNote() {
  return <p className="ip-footnote">המסך הזה יעוצב מחדש בשלב הבא · כל היכולות הקיימות נשמרות</p>;
}

export function CalendarScreen({ child }: { child: Child }) {
  return (
    <div className="ip-stack">
      <ScreenTitle title="יומן" subtitle="אימונים, אימונים אישיים ומשחקים של כל הילדים" />
      <IfaFixturesCard title="משחקי הליגה הקרובים" />
      {weekDays.map((d, i) => {
        const items = children
          .flatMap((c) => c.week.filter((w) => w.day === i).map((w) => ({ ...w, c })))
          .sort((a, b) => a.time.localeCompare(b.time));
        if (!items.length) return null;
        return (
          <section key={d.short}>
            <SectionHeader title={`יום ${d.short} · ${d.date}`} />
            <Card padded={false}>
              {items.map((w) => (
                <div key={w.id} className={`ip-week-item ip-week-item--${w.kind} ip-week-item--row ${w.c.id === child.id ? '' : 'is-dim'}`}>
                  <strong className="ip-week-time">{w.time}</strong>
                  <span className="ip-week-text">
                    <span>{w.title}</span>
                    <span className="ip-muted">
                      {w.c.firstName} · {w.place}
                    </span>
                  </span>
                  <Avatar size={32} name={w.c.firstName} jersey={w.c.jersey} hair={w.c.hair} hairStyle={w.c.hairStyle} />
                </div>
              ))}
            </Card>
          </section>
        );
      })}
      <NextPassNote />
    </div>
  );
}

export function FamilyScreen() {
  return (
    <div className="ip-stack">
      <ScreenTitle title="משפחה" subtitle={`משפחת ${parent.lastName}`} />
      <AccountSection />
      <section>
        <SectionHeader title="הילדים" />
        <Card padded={false}>
          {children.map((c) => (
            <ListRow
              key={c.id}
              icon="user"
              title={`${c.firstName} ${c.lastName}`}
              subtitle={`${c.club} · ${c.team}`}
              trailing={<Avatar size={36} name={c.firstName} jersey={c.jersey} hair={c.hair} hairStyle={c.hairStyle} />}
            />
          ))}
        </Card>
      </section>
      <section>
        <SectionHeader title="בני משפחה והרשאות" />
        <Card padded={false}>
          <ListRow icon="shield" iconTone="navy" title={`${parent.firstName} ${parent.lastName}`} subtitle="מנהלת משפחה · כל ההרשאות" trailing={<InitialsAvatar name={`${parent.firstName} ${parent.lastName}`} size={36} />} />
          <ListRow icon="shield" title="אבי לוי" subtitle="הורה · צפייה, הסעות ואישורים" trailing={<InitialsAvatar name="אבי לוי" size={36} tone="blue" />} />
          <ListRow icon="shield" title="סבתא חנה" subtitle="צפייה בלבד · משחקים ותוצאות" trailing={<Tag>צפייה</Tag>} />
        </Card>
      </section>
      <section>
        <SectionHeader title="הסעות" />
        <Card padded={false}>
          {children.map((c) => (
            <ListRow key={c.id} icon="car" iconTone={c.carpool.status === 'needs-driver' ? 'live' : 'blue'} title={c.carpool.title} subtitle={`${c.carpool.driver} · ${c.carpool.departure}`} />
          ))}
        </Card>
      </section>
      <NextPassNote />
    </div>
  );
}
