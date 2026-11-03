/**
 * The personal card behind the avatar in the header: who is signed in, and
 * one tap to personal details, the account, club/admin panels, help and sign-out.
 */
import { useEffect, useState } from 'react';
import { BottomSheet } from './shell';
import { InitialsAvatar } from './Avatar';
import { Button, Card, ListRow } from './ui';
import { useAuth } from '../auth/AuthContext';
import { isPlatformAdmin } from '../lib/ifaApi';
import type { AccountType } from '../lib/api';

const kindLabel: Record<AccountType, string> = { parent: 'הורה', player: 'שחקן/ית', club: 'מנהל/ת מועדון' };

export function UserMenuSheet({ open, onClose, name }: { open: boolean; onClose: () => void; name: string }) {
  const auth = useAuth();
  const signedIn = !!auth.session;
  const [superAdmin, setSuperAdmin] = useState(false);
  useEffect(() => {
    if (open && signedIn) void isPlatformAdmin().then(setSuperAdmin);
  }, [open, signedIn]);

  const go = (hash: string) => {
    onClose();
    window.location.hash = hash;
    window.scrollTo({ top: 0 });
  };

  const kinds: AccountType[] = auth.profile?.account_types?.length ? auth.profile.account_types : ['parent'];
  const roles = [...kinds.map((k) => kindLabel[k]), ...(superAdmin ? ['מנהל/ת מערכת'] : [])].join(' · ');
  const contact = auth.profile?.phone ? `+${auth.profile.phone.replace(/^\+/, '')}` : auth.profile?.email ?? auth.session?.user.email ?? '';

  return (
    <BottomSheet open={open} onClose={onClose} title="החשבון שלי">
      <div className="ip-stack">
        <Card>
          <div className="ip-account">
            <InitialsAvatar name={name} size={56} />
            <span className="ip-list-row-text">
              <span className="ip-list-row-title">{name}</span>
              {signedIn ? (
                <>
                  <span className="ip-list-row-sub">{roles}</span>
                  {contact && (
                    <bdi className="ip-list-row-sub" dir="ltr">
                      {contact}
                    </bdi>
                  )}
                </>
              ) : (
                <span className="ip-list-row-sub">מצב הדגמה</span>
              )}
            </span>
          </div>
        </Card>

        {signedIn ? (
          <Card padded={false}>
            <ListRow icon="user" iconTone="blue" title="הפרטים שלי" subtitle="טלפון, WhatsApp, דוא״ל וכתובת, ומה הורים אחרים רואים" onClick={() => go('me')} />
            <ListRow icon="family" iconTone="blue" title="החשבון והמשפחה" subtitle="ילדים, בני משפחה, קבוצות וסיסמה" onClick={() => go('family')} />
            {kinds.includes('club') && <ListRow icon="shield" iconTone="navy" title="ניהול מועדון" subtitle="קבוצות, שחקנים וצוות" onClick={() => go('club')} />}
            {superAdmin && <ListRow icon="shield" iconTone="lime" title="פאנל ניהול על" subtitle="מנהלי מערכת בלבד" onClick={() => go('admin')} />}
            <ListRow icon="chat" iconTone="lime" title="צור קשר · דיווח על תקלה" subtitle="או הצעת ייעול. התשובה תגיע להתראות" onClick={() => go('feedback')} />
          </Card>
        ) : (
          <Card padded={false}>
            <ListRow icon="chat" iconTone="lime" title="צור קשר · דיווח על תקלה" subtitle="או הצעת ייעול" onClick={() => go('feedback')} />
          </Card>
        )}

        {signedIn ? (
          <Button
            variant="ghost"
            block
            onClick={() => {
              onClose();
              void auth.signOut();
            }}
          >
            יציאה מהחשבון
          </Button>
        ) : (
          auth.enabled && (
            <Button
              variant="primary"
              block
              onClick={() => {
                onClose();
                auth.setDemo(false);
              }}
            >
              כניסה או הרשמה
            </Button>
          )
        )}
      </div>
    </BottomSheet>
  );
}
