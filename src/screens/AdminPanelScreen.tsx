/**
 * #admin — Super Admin panel (platform admins only). Collects the system-wide
 * tools so regular users never see them: IFA data, clubs, coach claims.
 */
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Card, EmptyState } from '../components/ui';
import { isPlatformAdmin } from '../lib/ifaApi';

const tools: { icon: IconName; tone: string; title: string; sub: string; href: string }[] = [
  { icon: 'shield', tone: 'lime', title: 'נתוני ההתאחדות', sub: 'ייבוא קבוצות, סגלים ומשחקים, ויומן סנכרונים', href: 'ifa' },
  { icon: 'team', tone: 'blue', title: 'מועדונים', sub: 'ניהול מועדונים, קבוצות ליגה ואקדמיה', href: 'club' },
];

export function AdminPanelScreen({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>פאנל ניהול על</h1>
        <span />
      </div>
      {allowed === null ? (
        <p className="ip-muted ip-pad">טוען…</p>
      ) : !allowed ? (
        <Card>
          <EmptyState icon="shield" title="אין גישה" text="המסך הזה מיועד למנהלי המערכת בלבד." />
        </Card>
      ) : (
        <section className="ip-stack ip-stack--tight">
          {tools.map((t) => (
            <button key={t.href} type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = t.href)}>
              <span className={`ip-icon-tile ip-icon-tile--${t.tone}`}>
                <Icon name={t.icon} size={20} />
              </span>
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">{t.title}</span>
                <span className="ip-list-row-sub">{t.sub}</span>
              </span>
              <Icon name="chevron" size={18} className="ip-muted" />
            </button>
          ))}
          <p className="ip-footnote">בקשות של מאמנים לנהל קבוצה מופיעות לאישורך בראש דף הבית ובלשונית החשבון.</p>
        </section>
      )}
    </div>
  );
}
