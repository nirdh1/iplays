/**
 * #feedback — "צור קשר / דיווח על תקלה / הצעת ייעול". A short form that goes
 * to the platform admins (bell + Super Admin panel), and the user's own past
 * messages with the admins' replies.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { Field, Err } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import { timeAgo } from '../lib/inbox';
import { feedbackError, kindLabel, myFeedback, statusLabel, submitFeedback, supportEmail, type FeedbackKind, type MyFeedback } from '../lib/feedbackApi';
import '../theme/coach.css';
import '../theme/club.css';

const kinds: { id: FeedbackKind; label: string }[] = [
  { id: 'bug', label: 'תקלה' },
  { id: 'suggestion', label: 'הצעת ייעול' },
  { id: 'contact', label: 'צור קשר' },
];

const placeholder: Record<FeedbackKind, string> = {
  bug: 'מה ניסיתם לעשות, ומה קרה במקום? באיזה מסך?',
  suggestion: 'מה היה עוזר לכם? מה אפשר לעשות פשוט יותר?',
  contact: 'במה אפשר לעזור?',
};

export function FeedbackScreen({ onBack }: { onBack: () => void }) {
  const auth = useAuth();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<MyFeedback[]>([]);

  const load = () => myFeedback().then(setMine, () => setMine([]));
  useEffect(() => {
    if (auth.session) void load();
  }, [auth.session]);

  async function send() {
    setError(null);
    if (!message.trim()) {
      setError('כתבו כמה מילים על הפנייה.');
      return;
    }
    if (link.trim() && !/^https?:\/\//i.test(link.trim())) {
      setError('הקישור צריך להתחיל ב-https://');
      return;
    }
    setBusy(true);
    try {
      await submitFeedback({ kind, message, link });
      setSent(true);
      setMessage('');
      setLink('');
      void load();
    } catch (e) {
      setError(feedbackError(e) ?? friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const mailto = supportEmail ? `mailto:${supportEmail}?subject=${encodeURIComponent(`iplays · ${kindLabel[kind]}`)}` : '';

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>צור קשר</h1>
        <span />
      </div>

      {!auth.session ? (
        <Card>
          <p className="ip-muted">כדי לשלוח פנייה מתוך האפליקציה צריך להיכנס לחשבון.</p>
          <div className="ip-btn-row">
            {auth.enabled && (
              <Button variant="primary" size="sm" onClick={() => auth.setDemo(false)}>
                כניסה או הרשמה
              </Button>
            )}
            {mailto && (
              <a className="ip-btn ip-btn--secondary ip-btn--sm" href={mailto}>
                <span>שליחה במייל</span>
              </a>
            )}
          </div>
        </Card>
      ) : (
        <section>
          <SectionHeader title="פנייה חדשה" icon="chat" />
          <Card>
            {sent ? (
              <div className="ip-form">
                <p className="ip-success" role="status">
                  תודה! הפנייה נשלחה לצוות iplays. התשובה תגיע להתראות (הפעמון למעלה).
                </p>
                <Button variant="secondary" size="sm" onClick={() => setSent(false)}>
                  פנייה נוספת
                </Button>
              </div>
            ) : (
              <div className="ip-form">
                <Segmented items={kinds} value={kind} onChange={setKind} label="סוג הפנייה" />
                <Field label="מה תרצו לספר לנו?">
                  <textarea className="ip-input ip-textarea" rows={5} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={placeholder[kind]} />
                </Field>
                {kind === 'bug' && (
                  <Field label="קישור לצילום מסך (לא חובה)">
                    <input className="ip-input" type="url" dir="ltr" inputMode="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
                  </Field>
                )}
                <p className="ip-footnote">יחד עם הפנייה נשלחים שם החשבון והמייל שלכם, המסך שממנו הגעתם וסוג המכשיר, כדי שנוכל לחזור אליכם ולאתר תקלות.</p>
                <Err error={error} />
                <Button variant="primary" block icon="check" disabled={busy} onClick={() => void send()}>
                  {busy ? 'שולח…' : 'שליחה'}
                </Button>
                {mailto && (
                  <p className="ip-footnote">
                    מעדיפים מייל? <a href={mailto} dir="ltr">{supportEmail}</a>
                  </p>
                )}
              </div>
            )}
          </Card>
        </section>
      )}

      {mine.length > 0 && (
        <section>
          <SectionHeader title="הפניות שלי" icon="clock" />
          <Card padded={false}>
            <ul className="ip-feedback-list">
              {mine.map((f) => (
                <li key={f.id} className="ip-feedback-item">
                  <div className="ip-feedback-head">
                    <Tag tone={f.kind === 'bug' ? 'warning' : f.kind === 'suggestion' ? 'lime' : 'blue'}>{kindLabel[f.kind]}</Tag>
                    <Tag tone={f.status === 'done' ? 'navy' : 'neutral'}>{statusLabel[f.status]}</Tag>
                    <time className="ip-muted" dateTime={f.created_at}>
                      {timeAgo(f.created_at)}
                    </time>
                  </div>
                  <p className="ip-feedback-text">{f.message}</p>
                  {f.admin_reply && (
                    <div className="ip-feedback-reply">
                      <strong>תשובת צוות iplays</strong>
                      <p className="ip-feedback-text">{f.admin_reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
