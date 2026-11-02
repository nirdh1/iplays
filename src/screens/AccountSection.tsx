/** Top of the Family tab: the signed-in account, its teams, and sign-in/out. */
import { Button, Card, ListRow, SectionHeader, Tag } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { useAuth } from '../auth/AuthContext';
import { friendlyError, roleLabel, sportLabel, updateMyAccountTypes, type AccountType } from '../lib/api';
import { AccountTypePicker } from './OnboardingScreen';
import { useEffect, useState } from 'react';
import {
  joinError,
  cancelPlayerSelf,
  myFollowRequests,
  myJoinRequests,
  mySelfClaims,
  pendingSelfClaims,
  reviewPlayerSelf,
  selfApproverLabel,
  type MySelfClaim,
  type SelfClaim,
  pendingTeamClaims,
  reviewJoinRequest,
  reviewTeamClaim,
  type FollowRequest,
  type MyRequest,
  type TeamClaim,
} from '../lib/joinApi';
import { isPlatformAdmin } from '../lib/ifaApi';
import '../theme/coach.css';
import { PasswordCard } from '../components/PasswordSetup';
import { disablePush, enablePush, getPrefs, pushState, savePrefs, type NotificationPrefs, type PushState } from '../lib/push';

/** Notifications: push on this device on/off, and what to get (bell and push alike). */
function NotificationsSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState);
    getPrefs().then(setPrefs, () => setPrefs(null));
  }, []);

  async function toggle() {
    setError(null);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush());
    } catch {
      setError('לא הצלחנו להפעיל התראות במכשיר הזה.');
    }
  }

  async function change(p: NotificationPrefs) {
    setPrefs(p);
    try {
      await savePrefs(p);
    } catch {
      setError('ההעדפה לא נשמרה. נסו שוב.');
    }
  }

  const note: Record<PushState, string> = {
    unsupported: 'הדפדפן הזה לא תומך בהתראות. באייפון: קודם "הוספה למסך הבית", ואז פותחים את iplays מהאייקון.',
    'not-configured': 'התראות למכשיר עוד לא הופעלו בשרת. העדכונים מופיעים בינתיים באפליקציה.',
    denied: 'ההתראות חסומות בהגדרות הדפדפן של המכשיר.',
    off: 'ההתראות מופיעות בפעמון למעלה. אפשר לקבל אותן גם כהודעה במכשיר.',
    on: 'ההתראות פעילות במכשיר הזה.',
  };

  return (
    <section>
      <SectionHeader title="התראות" icon="bell" />
      <Card>
        <div className="ip-form">
          {state && <p className="ip-muted">{note[state]}</p>}
          {(state === 'on' || state === 'off') && (
            <Button variant={state === 'on' ? 'secondary' : 'primary'} size="sm" icon="bell" onClick={() => void toggle()}>
              {state === 'on' ? 'כיבוי התראות במכשיר הזה' : 'הפעלת התראות במכשיר הזה'}
            </Button>
          )}
          {prefs && (
            <>
              <label className="ip-check">
                <input type="checkbox" checked={prefs.match_changes} onChange={(e) => void change({ ...prefs, match_changes: e.target.checked })} />
                <span>שינויים במועד או במגרש</span>
              </label>
              <label className="ip-check">
                <input type="checkbox" checked={prefs.match_results} onChange={(e) => void change({ ...prefs, match_results: e.target.checked })} />
                <span>תוצאות משחקים</span>
              </label>
              {prefs.team_updates !== undefined && (
                <label className="ip-check">
                  <input type="checkbox" checked={prefs.team_updates} onChange={(e) => void change({ ...prefs, team_updates: e.target.checked })} />
                  <span>עדכוני קבוצה: אימונים, הודעות והיעדרויות</span>
                </label>
              )}
            </>
          )}
          {error && <p className="ip-error">{error}</p>}
        </div>
      </Card>
    </section>
  );
}

/** Follow requests waiting for me (as the child's parent) and my own pending requests. */
/**
 * A player said "this is me" about a profile: the approver (the child's parent,
 * else team staff, else platform admin) approves here; the player sees their own
 * request waiting.
 */
export function SelfClaimsSection() {
  const [toReview, setToReview] = useState<SelfClaim[]>([]);
  const [mine, setMine] = useState<MySelfClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () =>
    Promise.all([pendingSelfClaims().catch(() => []), mySelfClaims().catch(() => [])]).then(([r, m]) => {
      setToReview(r);
      setMine(m);
    });
  useEffect(() => {
    void load();
  }, []);
  const act = (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    fn()
      .then(load)
      .catch((e) => setError(joinError(e) ?? friendlyError(e)))
      .finally(() => setBusy(null));
  };

  if (!toReview.length && !mine.length) return null;
  return (
    <>
      {toReview.length > 0 && (
        <section>
          <SectionHeader title={`שחקנים שמבקשים את הפרופיל שלהם · ${toReview.length}`} icon="user" />
          <Card padded={false}>
            {toReview.map((r) => (
              <div key={r.id} className="ip-member ip-request">
                <InitialsAvatar name={r.player_name || 'שחקן'} size={40} tone="lime" />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {`${r.requester || r.requester_email || 'משתמש'} אומר/ת: "זה אני, ${r.player_name}"`}
                  </span>
                  <span className="ip-list-row-sub">
                    {[r.team_names.join(', '), r.birth_year && `שנתון ${r.birth_year}`, r.requester_email, r.message].filter(Boolean).join(' · ')}
                  </span>
                  <span className="ip-list-row-sub">
                    אחרי אישור השחקן/ית יראה את הקבוצה והלוח ויעדכן את הקריירה. מדדי גוף, תשלומים וניהול המשפחה נשארים להורים.
                  </span>
                </span>
                <span className="ip-find-actions">
                  <Button variant="primary" size="sm" disabled={busy === r.id} onClick={() => act(r.id, () => reviewPlayerSelf(r.id, true))}>
                    אישור
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => act(r.id, () => reviewPlayerSelf(r.id, false))}>
                    דחייה
                  </Button>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
      {mine.length > 0 && (
        <section>
          <SectionHeader title="הפרופיל שלי כשחקן/ית" icon="clock" />
          <Card padded={false}>
            {mine.map((r) => (
              <div key={r.id} className="ip-member">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{r.player_name}</span>
                  <span className="ip-list-row-sub">
                    {r.status === 'pending' ? `ממתין לאישור של ${selfApproverLabel[r.approver]}` : 'הבקשה לא אושרה. אפשר לפנות להורה או למאמן.'}
                  </span>
                </span>
                {r.status === 'pending' ? (
                  <Button variant="ghost" size="sm" disabled={busy === r.id} onClick={() => act(r.id, () => cancelPlayerSelf(r.id))}>
                    ביטול
                  </Button>
                ) : (
                  <Tag tone="warning">לא אושר</Tag>
                )}
              </div>
            ))}
          </Card>
        </section>
      )}
      {error && <p className="ip-error" role="alert">{error}</p>}
    </>
  );
}

export function RequestsSection() {
  const [follow, setFollow] = useState<FollowRequest[]>([]);
  const [mine, setMine] = useState<MyRequest[]>([]);
  const [claims, setClaims] = useState<TeamClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The lists need their migrations; before them they stay empty.
  const load = () =>
    Promise.all([myFollowRequests().catch(() => []), myJoinRequests().catch(() => []), pendingTeamClaims().catch(() => [])]).then(([f, m, c]) => {
      setFollow(f);
      setMine(m.filter((r) => r.status === 'pending'));
      setClaims(c);
    });
  useEffect(() => {
    void load();
  }, []);
  const review = (id: string, ok: boolean) =>
    reviewJoinRequest(id, ok)
      .then(load)
      .catch((e) => setError(joinError(e) ?? friendlyError(e)));

  const reviewClaim = (id: string, ok: boolean) =>
    reviewTeamClaim(id, ok)
      .then(load)
      .catch((e) => setError(joinError(e) ?? friendlyError(e)));

  if (!follow.length && !mine.length && !claims.length) return null;
  return (
    <>
      {claims.length > 0 && (
        <section>
          <SectionHeader title={`מאמנים שמבקשים לנהל קבוצה · ${claims.length}`} icon="whistle" />
          <Card padded={false}>
            {claims.map((r) => (
              <div key={r.id} className="ip-member ip-request">
                <InitialsAvatar name={r.requester || 'מאמן'} size={40} tone="navy" />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {r.requester || 'מאמן'} · {r.team_name}
                  </span>
                  <span className="ip-list-row-sub">{[r.club_name, r.message].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="ip-find-actions">
                  <Button variant="primary" size="sm" onClick={() => reviewClaim(r.id, true)}>
                    אישור
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => reviewClaim(r.id, false)}>
                    דחייה
                  </Button>
                </span>
              </div>
            ))}
          </Card>
          {!follow.length && error && <p className="ip-error" role="alert">{error}</p>}
        </section>
      )}
      {follow.length > 0 && (
        <section>
          <SectionHeader title={`בקשות לאישורך · ${follow.length}`} icon="bell" />
          <Card padded={false}>
            {follow.map((r) => (
              <div key={r.id} className="ip-member ip-request">
                <InitialsAvatar name={r.requester || 'בן משפחה'} size={40} tone="blue" />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {r.relation === 'parent' ? `${r.requester || 'משתמש'} הצהיר/ה שהוא/היא הורה של ${r.child_name}` : `${r.requester || 'בן משפחה'} רוצה לעקוב אחרי ${r.child_name}`}
                  </span>
                  <span className="ip-list-row-sub">
                    {r.relation === 'parent' ? r.message || 'את/ה ההורה הרשום/ה של הילד ולכן יכול/ה לאשר. אפשר גם להזמין הורה שני ישירות, בקישור מ"בני משפחה והרשאות".' : r.message || 'צפייה בילד ובלוח הקבוצה, בלי עריכה'}
                  </span>
                </span>
                <span className="ip-find-actions">
                  <Button variant="primary" size="sm" onClick={() => review(r.id, true)}>
                    אישור
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => review(r.id, false)}>
                    דחייה
                  </Button>
                </span>
              </div>
            ))}
          </Card>
          {error && <p className="ip-error" role="alert">{error}</p>}
        </section>
      )}
      {mine.length > 0 && (
        <section>
          <SectionHeader title="הבקשות שלי" icon="clock" />
          <Card padded={false}>
            {mine.map((r) => (
              <ListRow
                key={r.id}
                icon="clock"
                title={`${r.child_name} · ${r.team_name}`}
                subtitle={r.relation === 'parent' ? 'ממתין לאישור מאמן הקבוצה, או ההורה שכבר רשום לילד' : 'ממתין לאישור ההורה'}
                trailing={<Tag tone="warning">ממתין</Tag>}
                onClick={() => (window.location.hash = `t/${r.team_id}`)}
              />
            ))}
          </Card>
        </section>
      )}
    </>
  );
}

export function AccountSection() {
  const auth = useAuth();
  const [superAdmin, setSuperAdmin] = useState(false);
  useEffect(() => {
    if (auth.session) void isPlatformAdmin().then(setSuperAdmin);
  }, [auth.session]);
  const kinds: AccountType[] = auth.profile?.account_types?.length ? auth.profile.account_types : ['parent'];
  const [kindError, setKindError] = useState<string | null>(null);
  const toggleKind = (k: AccountType) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    if (!next.length || !auth.session) return;
    setKindError(null);
    updateMyAccountTypes(auth.session.user.id, next)
      .then(() => auth.refresh())
      .catch(() => setKindError('לא נשמר. ייתכן שעדיין לא הורץ עדכון השרת (account_types).'));
  };

  if (!auth.enabled) {
    return (
      <Card className="ip-account-demo">
        <Tag tone="warning">מצב הדגמה</Tag>
        <p className="ip-muted">כל הנתונים באפליקציה הם להדגמה. ההרשמה תיפתח אחרי שהשרת יחובר.</p>
      </Card>
    );
  }

  if (!auth.session) {
    return (
      <Card className="ip-account-demo">
        <Tag tone="warning">מצב הדגמה</Tag>
        <p className="ip-muted">אתם צופים בנתוני הדגמה. כדי לפתוח קבוצה או להצטרף לקבוצה של הילד, היכנסו עם הטלפון.</p>
        <Button variant="primary" block onClick={() => auth.setDemo(false)}>
          כניסה או הרשמה
        </Button>
      </Card>
    );
  }

  const name = auth.profile?.full_name || 'החשבון שלי';
  const contact = auth.profile?.phone ? `+${auth.profile.phone.replace(/^\+/, '')}` : auth.profile?.email ?? auth.session.user.email ?? '';

  return (
    <>
      <section>
        <SectionHeader title="החשבון שלי" icon="user" />
        <Card>
          <div className="ip-account">
            <InitialsAvatar name={name} size={48} />
            <span className="ip-list-row-text">
              <span className="ip-list-row-title">{name}</span>
              <bdi className="ip-list-row-sub" dir="ltr">
                {contact}
              </bdi>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void auth.signOut()}>
              יציאה
            </Button>
          </div>
        </Card>
      </section>
      <PasswordCard />
      <RequestsSection />
      <SelfClaimsSection />
      <NotificationsSection />
      <section>
        <SectionHeader title="הקבוצות שלי" icon="team" />
        <Card padded={false}>
          {auth.teams.map((t) => (
            <ListRow
              key={t.id}
              icon="team"
              iconTone={t.role === 'parent' ? 'blue' : 'navy'}
              title={t.name}
              subtitle={[t.club, sportLabel[t.sport], roleLabel[t.role]].filter(Boolean).join(' · ')}
              onClick={() => (window.location.hash = `myteam/${t.id}`)}
            />
          ))}
          <ListRow
            icon="plus"
            iconTone="lime"
            title="הוספת ילד או קבוצה"
            subtitle="חיפוש הילד לפי שם ושנתון, או חיפוש מועדון"
            onClick={() => (window.location.hash = 'find')}
          />
        </Card>
      </section>
      <section>
        <SectionHeader title="סוג החשבון" icon="user" />
        <Card>
          <AccountTypePicker value={kinds} onToggle={toggleKind} />
          {kindError && <p className="ip-error" role="alert">{kindError}</p>}
        </Card>
      </section>
      {(kinds.includes('club') || superAdmin) && (
      <section>
        <SectionHeader title={kinds.includes('club') ? 'מועדון' : 'ניהול'} icon="shield" />
        <Card padded={false}>
          {kinds.includes('club') && (
          <ListRow
            icon="shield"
            iconTone="navy"
            title="ניהול מועדון"
            subtitle="קבוצות ליגה ואקדמיה, שחקנים ומעברים"
            onClick={() => (window.location.hash = 'club')}
          />
          )}
          {superAdmin && (
            <ListRow
              icon="shield"
              iconTone="lime"
              title="פאנל ניהול על"
              subtitle="מנהלי מערכת בלבד: נתוני ההתאחדות ומועדונים"
              onClick={() => (window.location.hash = 'admin')}
            />
          )}
        </Card>
      </section>
      )}
    </>
  );
}
