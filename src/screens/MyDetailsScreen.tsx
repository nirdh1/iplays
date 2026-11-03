/**
 * #me — the signed-in user's own personal details (phone, WhatsApp, email,
 * address) and what other parents in the team may see. Opened from the
 * personal card behind the header avatar.
 */
import { Icon } from '../components/Icon';
import { Button, Card, SectionHeader } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { MyCardEditor } from './ContactsSection';
import '../theme/contacts.css';

export function MyDetailsScreen({ onBack }: { onBack: () => void }) {
  const auth = useAuth();
  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>הפרטים שלי</h1>
        <span />
      </div>
      {auth.session ? (
        <section>
          <SectionHeader title="פרטי קשר וכתובת" icon="user" />
          <Card>
            <MyCardEditor />
          </Card>
        </section>
      ) : (
        <Card>
          <p className="ip-muted">כדי לעדכן פרטים אישיים צריך להיכנס לחשבון.</p>
          {auth.enabled && (
            <Button variant="primary" size="sm" onClick={() => auth.setDemo(false)}>
              כניסה או הרשמה
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
