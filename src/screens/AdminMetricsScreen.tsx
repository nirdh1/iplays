/**
 * #adminmetrics — Super Admin growth metrics: who signed in, linked clubs,
 * players vs. parents (IFA-imported players kept apart from players linked to
 * a real family), day-over-day / week-over-week growth, activity, retention,
 * invite funnel, feature use, and users linked to more than one child.
 * Server side: supabase/migrations/20261103700000_admin_growth_metrics.sql
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Card, EmptyState, ProgressBar, SectionHeader, Segmented, StatTile, Tag } from '../components/ui';
import { TrendChart } from '../components/TrendChart';
import { friendlyError } from '../lib/api';
import { isMissing } from '../lib/coachApi';
import { isPlatformAdmin } from '../lib/ifaApi';
import { getGrowthMetrics, getMultiChildUsers, pct, pctChange, type DailyPoint, type GrowthMetrics, type MultiChildUser } from '../lib/adminMetrics';
import '../theme/adminMetrics.css';

type Tab = 'overview' | 'growth' | 'users' | 'clubs' | 'multi';
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'סקירה' },
  { id: 'growth', label: 'צמיחה' },
  { id: 'users', label: 'כניסות' },
  { id: 'clubs', label: 'מועדונים' },
  { id: 'multi', label: 'רב-ילדים' },
];

const nf = new Intl.NumberFormat('he-IL');
const n = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
const pctText = (v: number | null) => (v == null ? '—' : `${v}%`);

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="ip-gm-delta ip-gm-delta--none">—</span>;
  const r = Math.round(value * 10) / 10;
  const cls = r > 0 ? 'ip-gm-delta--up' : r < 0 ? 'ip-gm-delta--down' : 'ip-gm-delta--none';
  return (
    <span className={`ip-gm-delta ${cls}`} dir="ltr">
      {r > 0 ? '+' : ''}
      {r}%
    </span>
  );
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  if (mins < 24 * 60) return `לפני ${Math.round(mins / 60)} שע׳`;
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
}

const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Growth of a cumulative series between the last point and `back` days earlier. */
function growth(daily: DailyPoint[], key: 'users' | 'parents' | 'linked_players', back: number): number | null {
  if (daily.length <= back) return null;
  return pctChange(daily[daily.length - 1][key], daily[daily.length - 1 - back][key]);
}

function KpiRow({ label, value, sub, delta }: { label: string; value: ReactNode; sub?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="ip-gm-kpi">
      <span className="ip-gm-kpi-text">
        <span className="ip-gm-kpi-label">{label}</span>
        {sub && <span className="ip-gm-kpi-sub">{sub}</span>}
      </span>
      <span className="ip-gm-kpi-value">
        {value}
        {delta}
      </span>
    </div>
  );
}

export function AdminMetricsScreen({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState<'14' | '30' | '90'>('30');
  const [m, setM] = useState<GrowthMetrics | null>(null);
  const [multi, setMulti] = useState<MultiChildUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);

  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setError(null);
    getGrowthMetrics(Number(days))
      .then(setM)
      .catch((e) => (isMissing(e) ? setNotInstalled(true) : setError(friendlyError(e))));
  }, [allowed, days]);

  useEffect(() => {
    if (!allowed || tab !== 'multi' || multi) return;
    getMultiChildUsers()
      .then(setMulti)
      .catch((e) => (isMissing(e) ? setNotInstalled(true) : setError(friendlyError(e))));
  }, [allowed, tab, multi]);

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>מדדי צמיחה</h1>
        <span />
      </div>
      {allowed === null ? (
        <p className="ip-muted ip-pad">טוען…</p>
      ) : !allowed ? (
        <Card>
          <EmptyState icon="shield" title="אין גישה" text="המסך הזה מיועד למנהלי המערכת בלבד." />
        </Card>
      ) : notInstalled ? (
        <Card>
          <EmptyState icon="grid" title="המדדים עוד לא הותקנו" text="יש להריץ ב-Supabase את הקובץ iplays-admin-growth-metrics.sql ואז לרענן." />
        </Card>
      ) : (
        <>
          <div className="ip-gm-tabs">
            <Segmented items={tabs} value={tab} onChange={setTab} label="מדדים" />
          </div>
          {error && <p className="ip-error">{error}</p>}
          {!m ? (
            !error && <p className="ip-muted ip-pad">טוען נתונים…</p>
          ) : tab === 'overview' ? (
            <Overview m={m} />
          ) : tab === 'growth' ? (
            <Growth m={m} days={days} setDays={setDays} />
          ) : tab === 'users' ? (
            <Users m={m} />
          ) : tab === 'clubs' ? (
            <Clubs m={m} />
          ) : (
            <Multi rows={multi} />
          )}
        </>
      )}
    </div>
  );
}

function Overview({ m }: { m: GrowthMetrics }) {
  const t = m.totals;
  const a = m.activity;
  const r = m.retention;
  const f = m.funnel;
  const features: { key: keyof GrowthMetrics['features']; label: string }[] = [
    { key: 'trainings', label: 'יצרו אימונים' },
    { key: 'absences', label: 'דיווחו היעדרות' },
    { key: 'rides', label: 'הציעו הסעה' },
    { key: 'contacts', label: 'עדכנו פרטי קשר (אלפון)' },
    { key: 'gallery', label: 'שיתפו אלבום בגלריה' },
    { key: 'self_stats', label: 'דיווחו שערים / בישולים' },
    { key: 'feedback', label: 'שלחו פנייה / משוב' },
  ];
  const funnelMax = Math.max(f.signed_up, 1);
  return (
    <section className="ip-stack ip-stack--tight">
      <div className="ip-stats">
        <StatTile value={n(t.users)} label="משתמשים רשומים" accent />
        <StatTile value={n(t.parents)} label="הורים / קרובים" />
        <StatTile value={n(a.online_now)} label="מחוברים עכשיו" />
      </div>

      <Card>
        <SectionHeader title="צמיחה" icon="bolt" />
        <KpiRow label="משתמשים" value={n(t.users)} sub="מאתמול · משבוע שעבר" delta={<Deltas daily={m.daily} k="users" />} />
        <KpiRow label="הורים / קרובים רשומים" value={n(t.parents)} sub="מאתמול · משבוע שעבר" delta={<Deltas daily={m.daily} k="parents" />} />
        <KpiRow label="ילדים מקושרים למשפחה" value={n(t.players_linked)} sub="מאתמול · משבוע שעבר" delta={<Deltas daily={m.daily} k="linked_players" />} />
      </Card>

      <Card>
        <SectionHeader title="שחקנים: ייבוא מול שימוש אמיתי" icon="team" />
        <div className="ip-stats ip-stats--compact">
          <StatTile value={n(t.players_imported)} label="יובאו מההתאחדות" />
          <StatTile value={n(t.players_imported_linked)} label="מהם קושרו להורה" accent />
          <StatTile value={n(t.players_added_in_app)} label="נוספו באפליקציה" />
          <StatTile value={n(t.self_players)} label="שחקנים שתבעו פרופיל" />
        </div>
        <div className="ip-gm-gap" />
        <ProgressBar
          label="הפעלה: שחקנים מיובאים שקושרו למשפחה"
          value={pct(t.players_imported_linked, t.players_imported) ?? 0}
          display={pctText(pct(t.players_imported_linked, t.players_imported))}
        />
        <ProgressBar label="כל השחקנים שמקושרים למשתמש אמיתי" value={pct(t.players_linked, t.players) ?? 0} display={`${n(t.players_linked)} / ${n(t.players)}`} />
      </Card>

      <Card>
        <SectionHeader title="פעילות" icon="live" />
        <KpiRow label="פעילים היום (DAU)" value={n(a.dau)} sub={`אתמול ${n(a.dau_yesterday)}`} delta={<Delta value={pctChange(a.dau, a.dau_yesterday)} />} />
        <KpiRow label="פעילים השבוע (WAU)" value={n(a.wau)} sub={`שבוע קודם ${n(a.wau_prev)}`} delta={<Delta value={pctChange(a.wau, a.wau_prev)} />} />
        <KpiRow label="פעילים בחודש (MAU)" value={n(a.mau)} />
        <KpiRow label="דביקות (DAU / MAU)" value={pctText(pct(a.dau, a.mau))} sub="כמה מהפעילים בחודש נכנסים כל יום" />
        <KpiRow label="נכנסו (התחברות) היום / 7 ימים" value={`${n(a.signed_in_today)} / ${n(a.signed_in_7d)}`} />
        {m.tracking_since && <p className="ip-footnote">מעקב פעילות יומי מלא מתחיל מהרצת ה-SQL; הימים שלפני משוחזרים חלקית מנתוני ההתחברות.</p>}
      </Card>

      <Card>
        <SectionHeader title="כיסוי קבוצות ומועדונים" icon="grid" />
        <ProgressBar label="קבוצות עם לפחות הורה אחד" value={pct(t.teams_with_parent, t.teams) ?? 0} display={`${n(t.teams_with_parent)} / ${n(t.teams)}`} />
        <ProgressBar label="קבוצות עם הורה פעיל ב-7 ימים" value={pct(t.teams_with_active_parent_7d, t.teams) ?? 0} display={`${n(t.teams_with_active_parent_7d)} / ${n(t.teams)}`} />
        <ProgressBar label="קבוצות עם מאמן / צוות" value={pct(t.teams_with_staff, t.teams) ?? 0} display={`${n(t.teams_with_staff)} / ${n(t.teams)}`} />
        <ProgressBar label="מועדונים עם מנהל רשום" value={pct(t.clubs_with_admin, t.clubs) ?? 0} display={`${n(t.clubs_with_admin)} / ${n(t.clubs)}`} />
        <KpiRow label="מועדונים מאומתים" value={n(t.clubs_verified)} />
        <KpiRow label="אנשי צוות (מאמנים ומנהלים)" value={n(t.staff)} />
      </Card>

      <Card>
        <SectionHeader title={`משפך הצטרפות (${m.days} ימים)`} icon="arrow" />
        {[
          { label: 'נרשמו', v: f.signed_up },
          { label: 'הצטרפו לקבוצה', v: f.joined_team },
          { label: 'קישרו ילד', v: f.linked_child },
          { label: 'פעילים ב-7 ימים', v: f.active_7d },
        ].map((s) => (
          <ProgressBar key={s.label} label={s.label} value={Math.round((s.v / funnelMax) * 100)} display={`${n(s.v)} · ${pctText(pct(s.v, f.signed_up))}`} />
        ))}
        <KpiRow label="קודי הזמנה לקבוצה שנוצרו" value={n(f.team_invites_created)} />
        <KpiRow label="הזמנות משפחה: נשלחו / מומשו" value={`${n(f.family_invites_created)} / ${n(f.family_invites_used)}`} />
      </Card>

      <Card>
        <SectionHeader title="שימור" icon="undo" />
        <KpiRow label="חזרו בשבוע הראשון" value={pctText(pct(r.w1_returned, r.w1_cohort))} sub={`${n(r.w1_returned)} מתוך ${n(r.w1_cohort)} שנרשמו לפני 8–90 ימים`} />
        <KpiRow label="חזרו בשבוע הרביעי" value={pctText(pct(r.w4_returned, r.w4_cohort))} sub={`${n(r.w4_returned)} מתוך ${n(r.w4_cohort)} שנרשמו לפני 29–120 ימים`} />
      </Card>

      <Card>
        <SectionHeader title="שימוש בפיצ׳רים (30 ימים)" icon="star" />
        {features.map((x) => (
          <KpiRow key={x.key} label={x.label} value={m.features[x.key] == null ? <span className="ip-muted">לא מותקן</span> : n(m.features[x.key])} />
        ))}
        <p className="ip-footnote">מספר משתמשים שונים. "לא מותקן" = ה-SQL של הפיצ׳ר עוד לא הורץ.</p>
      </Card>
    </section>
  );
}

function Deltas({ daily, k }: { daily: DailyPoint[]; k: 'users' | 'parents' | 'linked_players' }) {
  return (
    <span className="ip-gm-deltas">
      <Delta value={growth(daily, k, 1)} />
      <Delta value={growth(daily, k, 7)} />
    </span>
  );
}

function Growth({ m, days, setDays }: { m: GrowthMetrics; days: '14' | '30' | '90'; setDays: (d: '14' | '30' | '90') => void }) {
  const d = m.daily;
  const series = (k: keyof DailyPoint) => d.map((p) => ({ date: p.day, value: Number(p[k]) }));
  const rows = useMemo(() => [...d].reverse(), [d]);
  return (
    <section className="ip-stack ip-stack--tight">
      <Segmented
        items={[
          { id: '14', label: '14 ימים' },
          { id: '30', label: '30 ימים' },
          { id: '90', label: '90 ימים' },
        ]}
        value={days}
        onChange={setDays}
        label="טווח"
      />
      {d.length > 1 && (
        <>
          <Card>
            <TrendChart points={series('parents')} unit="הורים" label="הורים / קרובים רשומים (מצטבר)" />
          </Card>
          <Card>
            <TrendChart points={series('linked_players')} unit="ילדים" label="ילדים מקושרים למשפחה (מצטבר)" />
          </Card>
          <Card>
            <TrendChart points={series('active')} unit="משתמשים" label="משתמשים פעילים ביום" />
          </Card>
        </>
      )}
      <Card padded={false}>
        <div className="ip-gm-table-wrap">
          <table className="ip-table ip-gm-table">
            <thead>
              <tr>
                <th>יום</th>
                <th>משתמשים חדשים</th>
                <th>הורים חדשים</th>
                <th>צמיחת הורים</th>
                <th>ילדים שקושרו</th>
                <th>פעילים</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const prev = rows[i + 1];
                return (
                  <tr key={p.day}>
                    <td>{dayLabel(p.day)}</td>
                    <td>{n(p.new_users)}</td>
                    <td>{n(p.new_parents)}</td>
                    <td>{prev ? <Delta value={pctChange(p.parents, prev.parents)} /> : '—'}</td>
                    <td>{n(p.new_linked_players)}</td>
                    <td>{n(p.active)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="ip-footnote">צמיחת הורים = שינוי באחוזים במספר ההורים הרשומים לעומת היום הקודם.</p>
    </section>
  );
}

function Users({ m }: { m: GrowthMetrics }) {
  if (!m.recent_users.length) return <Card><EmptyState icon="user" title="עוד אין כניסות" text="כשמשתמשים יתחברו הם יופיעו כאן." /></Card>;
  return (
    <section className="ip-stack ip-stack--tight">
      <p className="ip-muted">40 המשתמשים האחרונים שנכנסו או פתחו את האפליקציה.</p>
      <Card padded={false}>
        {m.recent_users.map((u) => (
          <div key={u.id} className="ip-gm-row">
            <span className="ip-gm-row-text">
              <strong>{u.name || u.email || 'ללא שם'}</strong>
              <span className="ip-muted">
                {u.name && u.email ? `${u.email} · ` : ''}נרשם {when(u.created_at)}
              </span>
            </span>
            <span className="ip-gm-row-side">
              <span>{when(u.last_seen)}</span>
              <span className="ip-gm-tags">
                {u.is_staff && <Tag tone="navy">צוות</Tag>}
                {u.kids > 0 && <Tag tone="lime">{u.kids === 1 ? 'ילד 1' : `${u.kids} ילדים`}</Tag>}
              </span>
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

const clubStatus: Record<string, string> = { draft: 'טיוטה', pending_verification: 'ממתין לאימות', verified: 'מאומת', suspended: 'מושהה' };

function Clubs({ m }: { m: GrowthMetrics }) {
  return (
    <section className="ip-stack ip-stack--tight">
      <SectionHeader title={`מועדונים מקושרים (${m.clubs.length})`} icon="shield" />
      {!m.clubs.length ? (
        <Card><EmptyState icon="shield" title="אין עדיין מועדונים מקושרים" text="מועדון נחשב מקושר כשיש לו מנהל או קבוצה עם חברים." /></Card>
      ) : (
        <Card padded={false}>
          {m.clubs.map((c) => (
            <div key={c.id} className="ip-gm-row">
              <span className="ip-gm-row-text">
                <strong>{c.name}</strong>
                <span className="ip-muted">
                  {c.city ? `${c.city} · ` : ''}
                  {n(c.teams)} קבוצות · {n(c.admins)} מנהלים
                </span>
              </span>
              <span className="ip-gm-row-side">
                <span>{n(c.parents)} הורים</span>
                <Tag tone={c.status === 'verified' ? 'lime' : 'neutral'}>{clubStatus[c.status] ?? c.status}</Tag>
              </span>
            </div>
          ))}
        </Card>
      )}
      <SectionHeader title="הקבוצות המובילות (לפי הורים)" icon="trophy" />
      {!m.top_teams.length ? (
        <Card><EmptyState icon="team" title="אין עדיין הורים בקבוצות" text="כשהורים יצטרפו לקבוצות הן יופיעו כאן." /></Card>
      ) : (
        <Card padded={false}>
          {m.top_teams.map((t) => (
            <div key={t.id} className="ip-gm-row">
              <span className="ip-gm-row-text">
                <strong>{t.name}</strong>
                <span className="ip-muted">
                  {t.club ? `${t.club} · ` : ''}
                  {n(t.players_linked)}/{n(t.players)} ילדים מקושרים
                </span>
              </span>
              <span className="ip-gm-row-side">
                <span>{n(t.parents)} הורים</span>
                <span className="ip-muted">{n(t.active_7d)} פעילים השבוע</span>
              </span>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

const relationLabel = { parent: 'הורה', family: 'קרוב משפחה' } as const;

function Multi({ rows }: { rows: MultiChildUser[] | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows) return <p className="ip-muted ip-pad">טוען…</p>;
  if (!rows.length) return <Card><EmptyState icon="family" title="אין משתמשים עם יותר מילד אחד" text="כאן יופיעו מי שסימנו עצמם הורה או קרוב משפחה של כמה ילדים." /></Card>;
  return (
    <section className="ip-stack ip-stack--tight">
      <p className="ip-muted">{n(rows.length)} משתמשים סימנו את עצמם הורה או קרוב משפחה של יותר מילד אחד.</p>
      <Card padded={false}>
        {rows.map((u) => {
          const isOpen = open === u.user_id;
          return (
            <div key={u.user_id} className="ip-gm-multi">
              <button type="button" className="ip-gm-row ip-gm-row--btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : u.user_id)}>
                <span className="ip-gm-row-text">
                  <strong>{u.name || u.email || 'ללא שם'}</strong>
                  <span className="ip-muted">
                    {u.name && u.email ? `${u.email} · ` : ''}נכנס {when(u.last_sign_in_at)}
                  </span>
                </span>
                <span className="ip-gm-row-side">
                  <Tag tone="blue">{u.kids_count} ילדים</Tag>
                  <Icon name="chevronDown" size={16} className={isOpen ? 'ip-gm-rot' : ''} />
                </span>
              </button>
              {isOpen && (
                <ul className="ip-gm-kids">
                  {u.kids.map((k) => (
                    <li key={k.player_id}>
                      <span className="ip-gm-row-text">
                        <strong>
                          {k.name}
                          {k.birth_year ? ` · ${k.birth_year}` : ''}
                        </strong>
                        <span className="ip-muted">
                          {[k.team, k.club].filter(Boolean).join(' · ') || 'ללא קבוצה'}
                        </span>
                      </span>
                      <span className="ip-gm-tags">
                        <Tag tone={k.relation === 'parent' ? 'lime' : 'neutral'}>{k.kinship || relationLabel[k.relation]}</Tag>
                        {k.imported && <Tag tone="navy">התאחדות</Tag>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </Card>
      <p className="ip-footnote">להסרת מי שאינו באמת ההורה: "הורים וילדים" בפאנל הניהול.</p>
    </section>
  );
}
