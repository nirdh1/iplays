/** Top of the Family tab: the signed-in account, its teams, and sign-in/out. */
import { Button, Card, ListRow, SectionHeader, Tag } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { useAuth } from '../auth/AuthContext';
import { friendlyError, roleLabel, sportLabel } from '../lib/api';
import { useEffect, useState } from 'react';
import { joinError, myFollowRequests, myJoinRequests, reviewJoinRequest, type FollowRequest, type MyRequest } from '../lib/joinApi';

/** Follow requests waiting for me (as the child's parent) and my own pending requests. */
function RequestsSection() {
  const [follow, setFollow] = useState<FollowRequest[]>([]);
  const [mine, setMine] = useState<MyRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Both lists need the search migration; before it they stay empty.
  const load = () =>
    Promise.all([myFollowRequests().catch(() => []), myJoinRequests().catch(() => [])]).then(([f, m]) => {
      setFollow(f);
      setMine(m.filter((r) => r.status === 'pending'));
    });
  useEffect(() => {
    void load();
  }, []);
  const review = (id: string, ok: boolean) =>
    reviewJoinRequest(id, ok)
      .then(load)
      .catch((e) => setError(joinError(e) ?? friendlyError(e)));

  if (!follow.length && !mine.length) return null;
  return (
    <>
      {follow.length > 0 && (
        <section>
          <SectionHeader title={`בקשות מעקב לאישורך · ${follow.length}`} icon="bell" />
          <Card padded={false}>
            {follow.map((r) => (
              <div key={r.id} className="ip-member ip-request">
                <InitialsAvatar name={r.requester || 'בן משפחה'} size={40} tone="blue" />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {r.requester || 'בן משפחה'} רוצה לעקוב אחרי {r.child_name}
                  </span>
                  <span className="ip-list-row-sub">{r.message || 'צפייה בילד ובלוח הקבוצה, בלי עריכה'}</span>
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
                subtitle={r.relation === 'parent' ? 'ממתין לאישור צוות הקבוצה' : 'ממתין לאישור ההורה'}
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
      <RequestsSection />
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
        <SectionHeader title="מועדון" icon="shield" />
        <Card padded={false}>
          <ListRow
            icon="shield"
            iconTone="navy"
            title="ניהול מועדון"
            subtitle="קבוצות ליגה ואקדמיה, שחקנים ומעברים"
            onClick={() => (window.location.hash = 'club')}
          />
        </Card>
      </section>
    </>
  );
}
