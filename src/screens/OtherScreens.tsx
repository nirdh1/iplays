/**
 * Team, Calendar and Family tabs. These are NOT redesigned yet — this pass
 * only rebrands them with the shared components and keeps an entry point for
 * every existing TeamUp capability (LIVE match center, goal reporting,
 * carpools, team funds, training events, family permissions) so nothing is lost.
 */
import { Card, ListRow, LiveBadge, SectionHeader, Tag } from '../components/ui';
import { ScreenTitle } from '../components/shell';
import { Avatar, InitialsAvatar } from '../components/Avatar';
import { children, parent, weekDays, type Child } from '../data/demo';

function NextPassNote() {
  return <p className="ip-footnote">המסך הזה יעוצב מחדש בשלב הבא · כל היכולות הקיימות נשמרות</p>;
}

export function TeamScreen({ child }: { child: Child }) {
  const live = child.live?.status === 'live';
  return (
    <div className="ip-stack">
      <ScreenTitle title={child.team} subtitle={`${child.club} · עונת ${child.season}`} />
      <Card padded={false}>
        <ListRow icon="live" iconTone="live" title="מרכז המשחק LIVE" subtitle={live ? `${child.live!.home} ${child.live!.homeScore}:${child.live!.awayScore} ${child.live!.away}` : 'עדכונים חיים בזמן משחק'} trailing={live ? <LiveBadge /> : undefined} />
        <ListRow icon="goal" title="דיווח שער / סל" subtitle="דיווח מהיר מהיציע לכל ההורים" />
        <ListRow icon="ball" title="משחקים ותוצאות" subtitle="לוח המשחקים והטבלה" />
        <ListRow icon="whistle" title="אימונים" subtitle="אימונים קבוצתיים ואישורי הגעה" />
        <ListRow icon="wallet" iconTone="lime" title="קופת הקבוצה" subtitle="2,400 ₪ מתוך 3,000 ₪ · מתנה למאמנים" />
        <ListRow icon="chat" title="קהילה והודעות" subtitle="עדכונים מהמאמנים וההורים" />
        <ListRow icon="team" iconTone="navy" title="סגל השחקנים" subtitle="שחקנים, מאמנים ואנשי קשר" />
      </Card>
      <NextPassNote />
    </div>
  );
}

export function CalendarScreen({ child }: { child: Child }) {
  return (
    <div className="ip-stack">
      <ScreenTitle title="יומן" subtitle="אימונים, אימונים אישיים ומשחקים של כל הילדים" />
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
