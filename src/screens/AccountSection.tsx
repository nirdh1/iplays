/** Top of the Family tab: the signed-in account, its teams, and sign-in/out. */
import { Button, Card, ListRow, SectionHeader, Tag } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { useAuth } from '../auth/AuthContext';
import { roleLabel, sportLabel } from '../lib/api';

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
