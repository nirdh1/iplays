/**
 * #admin — Super Admin panel (platform admins only). Collects the system-wide
 * tools so regular users never see them: IFA data, clubs, coach claims.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Card, EmptyState, SectionHeader, StatTile } from '../components/ui';
import { isPlatformAdmin } from '../lib/ifaApi';
import { getAdminStats, type AdminStats } from '../lib/adminStats';

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
          <UsageStats />
          <SectionHeader title="כלים" icon="grid" />
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
          <p className="ip-footnote">בקשות של מאמנים לנהל קבוצה מופיעות לאישורך בראש דף הבית ובלשונית משפחה.</p>
        </section>
      )}
    </div>
  );
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('he-IL'));

function StatGroup({ title, icon, children, note }: { title: string; icon: IconName; children: ReactNode; note?: string }) {
  return (
    <Card>
      <SectionHeader title={title} icon={icon} />
      <div className="ip-stats">{children}</div>
      {note && <p className="ip-footnote">{note}</p>}
    </Card>
  );
}

/** Aggregate usage counts only: no names or personal details. */
function UsageStats() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    getAdminStats()
      .then(setStats)
      .catch((e: { code?: string; message?: string }) =>
        setError(e?.code === 'PGRST202' || e?.code === '42883'
          ? 'הסטטיסטיקות עוד לא פעילות: צריך להריץ את קובץ ה־SQL של הסטטיסטיקות ב־Supabase.'
          : 'לא הצלחנו לטעון את הנתונים. נסו שוב.'),
      )
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <>
      <SectionHeader title="שימוש במערכת" icon="career" action={loading ? 'טוען…' : 'רענון'} onAction={loading ? undefined : load} />
      {error && <Card><p className="ip-muted">{error}</p></Card>}
      {!stats && !error && <p className="ip-muted ip-pad">טוען…</p>}
      {stats && (
        <>
          <StatGroup title="מחוברים ואונליין" icon="live" note={`"אונליין עכשיו" = האפליקציה פתוחה ב־${stats.online_window_minutes} הדקות האחרונות. "פעילים" נספר מאז שהמדידה הופעלה.`}>
            <StatTile value={n(stats.online_now)} label="אונליין עכשיו" accent />
            <StatTile value={n(stats.active_today)} label="פעילים היום" />
            <StatTile value={n(stats.active_7d)} label="פעילים ב־7 ימים" />
            <StatTile value={n(stats.signed_in_today)} label="התחברו היום" />
            <StatTile value={n(stats.signed_in_7d)} label="התחברו ב־7 ימים" />
            <StatTile value={n(stats.signed_in_30d)} label="התחברו ב־30 ימים" />
          </StatGroup>
          <StatGroup title="משתמשים" icon="user">
            <StatTile value={n(stats.users_total)} label="משתמשים רשומים" accent />
            <StatTile value={n(stats.users_new_7d)} label="חדשים ב־7 ימים" />
            <StatTile value={n(stats.parents_total)} label="הורים בקבוצות" />
          </StatGroup>
          <StatGroup title="מאמנים" icon="whistle" note="מאמנים = מאמן, עוזר מאמן, מדריך, מנהל קבוצה או מנהל בקבוצה כלשהי.">
            <StatTile value={n(stats.coaches_total)} label="מאמנים רשומים" accent />
            <StatTile value={n(stats.coaches_online_now)} label="אונליין עכשיו" />
            <StatTile value={n(stats.coaches_active_7d)} label="פעילים ב־7 ימים" />
          </StatGroup>
          <StatGroup title="קבוצות ומועדונים" icon="team">
            <StatTile value={n(stats.teams_total)} label="קבוצות" accent />
            <StatTile value={n(stats.teams_with_members)} label="עם משתמשים" />
            <StatTile value={n(stats.teams_with_staff)} label="עם מאמן" />
            <StatTile value={n(stats.teams_linked_ifa)} label="מקושרות להתאחדות" />
            <StatTile value={n(stats.teams_in_club)} label="משויכות למועדון" />
            <StatTile value={n(stats.clubs_total)} label={`מועדונים (${n(stats.clubs_verified)} מאומתים)`} />
          </StatGroup>
          <StatGroup title="הסעות" icon="car" note="משתמשים בהסעות = הציעו הסעה, הצטרפו להסעה או ביקשו הסעה.">
            <StatTile value={n(stats.rides_users)} label="משתמשים בהסעות" accent />
            <StatTile value={n(stats.rides_drivers)} label="נהגים" />
            <StatTile value={n(stats.rides_offered)} label="הסעות שהוצעו" />
            <StatTile value={n(stats.rides_seats_taken)} label="מקומות שנתפסו" />
            <StatTile value={n(stats.rides_teams)} label="קבוצות עם הסעות" />
          </StatGroup>
        </>
      )}
    </>
  );
}
