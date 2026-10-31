/** Living style guide: open with #brand. Mirrors docs/brand-style-guide.md. */
import { Logo, LogoSymbol } from '../components/Logo';
import { Icon, type IconName } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { Button, Card, LiveBadge, ListRow, ProgressBar, SectionHeader, StatTile, Tag } from '../components/ui';
import { ChildSwitcherPill } from '../components/shell';
import { children } from '../data/demo';

const colors = [
  { name: 'Navy', hex: '#0B1F3B', use: 'טקסט ראשי, כפתור ראשי, כרטיס ילד' },
  { name: 'Lime', hex: '#7CF23D', use: 'הדגשה, הצלחה, קריאה לפעולה משנית' },
  { name: 'Action blue', hex: '#3DA5FF', use: 'פעולות, קישורים, אימון קבוצתי' },
  { name: 'Background', hex: '#F4F7FB', use: 'רקע האפליקציה' },
  { name: 'White', hex: '#FFFFFF', use: 'כרטיסים' },
  { name: 'Live', hex: '#FF3B4E', use: 'LIVE בלבד' },
];

const icons: IconName[] = ['home', 'team', 'calendar', 'career', 'family', 'bell', 'ball', 'whistle', 'goal', 'live', 'car', 'pin', 'navigate', 'clock', 'chat', 'wallet', 'shield', 'star', 'bolt', 'user'];

export function BrandScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="ip-stack ip-brand">
      <div className="ip-screen-title">
        <div>
          <h1>מדריך מותג</h1>
          <p>iplays · המשחק שלהם. העולם שלך.</p>
        </div>
        <Button variant="ghost" size="sm" icon="home" onClick={onClose}>
          לאפליקציה
        </Button>
      </div>

      <section>
        <SectionHeader title="לוגו" />
        <Card>
          <div className="ip-brand-logo-light">
            <Logo height={56} />
          </div>
          <div className="ip-brand-logo-dark">
            <Logo height={56} tone="white" />
          </div>
          <p className="ip-footnote">תמיד באותיות קטנות. הנקודה של ה-i היא סמל התנועה: כדור ליים עם שובל מהירות כחול, לא מזוהה עם ענף ספורט אחד.</p>
        </Card>
      </section>

      <section>
        <SectionHeader title="אייקון אפליקציה" />
        <Card>
          <div className="ip-brand-icons">
            <figure>
              <LogoSymbol size={88} variant="light" />
              <figcaption>בהיר</figcaption>
            </figure>
            <figure>
              <LogoSymbol size={88} variant="dark" />
              <figcaption>כהה</figcaption>
            </figure>
            <figure>
              <img src="./brand/app-icon-wordmark.svg" width={88} height={88} alt="אייקון עם לוגוטייפ" />
              <figcaption>לוגוטייפ</figcaption>
            </figure>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="צבעים" />
        <div className="ip-swatches">
          {colors.map((c) => (
            <div key={c.hex} className="ip-swatch">
              <span style={{ background: c.hex }} />
              <strong>{c.name}</strong>
              <code>{c.hex}</code>
              <small>{c.use}</small>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="טיפוגרפיה · Heebo" />
        <Card>
          <div className="ip-type-scale">
            <span style={{ fontSize: 28, fontWeight: 800 }}>כותרת תצוגה 28/800</span>
            <span style={{ fontSize: 22, fontWeight: 700 }}>כותרת מסך 22/700</span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>כותרת אזור 18/700</span>
            <span style={{ fontSize: 16 }}>טקסט גוף 16/400 — קריא ונוח</span>
            <span style={{ fontSize: 14, color: 'var(--ip-text-2)' }}>טקסט משני 14/400</span>
            <span style={{ fontSize: 12, color: 'var(--ip-text-3)', fontWeight: 600 }}>תווית 12/600</span>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="אייקונים" />
        <Card>
          <div className="ip-icon-grid">
            {icons.map((n) => (
              <span key={n} title={n}>
                <Icon name={n} />
              </span>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="רכיבים" />
        <Card>
          <div className="ip-stack ip-stack--tight">
            <div className="ip-btn-row">
              <Button>ראשי</Button>
              <Button variant="secondary">משני</Button>
            </div>
            <div className="ip-btn-row">
              <Button variant="lime" icon="career">הדגשה</Button>
              <Button variant="ghost">שקט</Button>
            </div>
            <div className="ip-tag-row">
              <Tag tone="navy">משחק</Tag>
              <Tag tone="blue">אימון קבוצתי</Tag>
              <Tag tone="lime">אימון אישי</Tag>
              <Tag tone="warning">חסר נהג</Tag>
              <LiveBadge />
            </div>
            <ChildSwitcherPill child={children[0]} onClick={() => {}} />
            <div className="ip-stats">
              <StatTile value={14} label="הופעות" />
              <StatTile value={9} label="שערים" accent />
              <StatTile value={6} label="בישולים" />
            </div>
            <ProgressBar label="מהירות" value={78} delta={6} />
            <div className="ip-avatar-row">
              {children.map((c) => (
                <Avatar key={c.id} size={48} name={c.firstName} jersey={c.jersey} hair={c.hair} hairStyle={c.hairStyle} ring={c.id === 'noam'} />
              ))}
            </div>
          </div>
        </Card>
        <Card padded={false} className="ip-mt">
          <ListRow icon="car" title="שורת רשימה" subtitle="אייקון, כותרת, תת-כותרת וחץ" />
        </Card>
      </section>
    </div>
  );
}
