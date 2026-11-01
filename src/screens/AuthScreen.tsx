/**
 * Login / sign-up in one flow: email, then either the link in the email (signs
 * in directly) or the one-time code from the same email. No passwords. This
 * happens once per device: afterwards the session is remembered and renewed.
 * Phone (SMS) login needs a paid SMS provider in Supabase; it is hidden until
 * VITE_ENABLE_SMS=true is set at build time.
 */
import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { Icon } from '../components/Icon';
import { Button, Segmented } from '../components/ui';
import { normalizeIlPhone, supabase } from '../lib/supabase';
import { friendlyError } from '../lib/api';
import { readPendingInvite, useAuth } from '../auth/AuthContext';
import {
  emailRedirectUrl,
  forgetEmail,
  isStandaloneApp,
  passwordError,
  preferPassword,
  prefersPassword,
  rememberEmail,
  rememberedEmail,
} from '../auth/remember';

const smsEnabled = import.meta.env.VITE_ENABLE_SMS === 'true';

type Method = 'phone' | 'email';

export function AuthScreen() {
  const { setDemo, linkError } = useAuth();
  const [method, setMethod] = useState<Method>(smsEnabled && !rememberedEmail() ? 'phone' : 'email');
  const [known, setKnown] = useState<string | null>(rememberedEmail);
  const [value, setValue] = useState(known ?? '');
  const [target, setTarget] = useState<string | null>(null); // normalized phone / email the code was sent to
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkError);
  const standalone = isStandaloneApp();
  // Email: the main path is the link in the email. Code entry is a fallback,
  // shown up front only in the home-screen app (where the link opens Safari).
  const [showCode, setShowCode] = useState(standalone);
  // Password sign-in (for parents who set one in their account). Remembered per device.
  const [usePassword, setUsePassword] = useState(prefersPassword);
  const [password, setPassword] = useState('');
  const invite = readPendingInvite();

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const email = value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('כתובת המייל לא תקינה');
    if (!password) return setError('הקלידו סיסמה');
    setBusy(true);
    const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) return setError(passwordError(err));
    rememberEmail(email);
    preferPassword(true);
    // AuthContext picks up the session.
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const t = method === 'phone' ? normalizeIlPhone(value) : value.trim().toLowerCase();
    if (!t || (method === 'email' && !/^\S+@\S+\.\S+$/.test(t))) {
      setError(method === 'phone' ? 'מספר הטלפון לא תקין. לדוגמה: 050-1234567' : 'כתובת המייל לא תקינה');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase!.auth.signInWithOtp(
      method === 'phone' ? { phone: t } : { email: t, options: { shouldCreateUser: true, emailRedirectTo: emailRedirectUrl() } },
    );
    setBusy(false);
    if (err) return setError(friendlyError(err));
    if (method === 'email') rememberEmail(t);
    setTarget(t);
    setCode('');
    setShowCode(method === 'phone' || standalone);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    setBusy(true);
    const { error: err } =
      method === 'phone'
        ? await supabase!.auth.verifyOtp({ phone: target, token: code, type: 'sms' })
        : await supabase!.auth.verifyOtp({ email: target, token: code, type: 'email' });
    setBusy(false);
    if (err) setError(friendlyError(err));
    // On success AuthContext picks up the session and the app moves on.
  }

  return (
    <div className="ip-auth">
      <div className="ip-auth-hero">
        <Logo height={44} tone="white" />
        <p className="ip-auth-tagline">המשחק שלהם. העולם שלך.</p>
        {invite && (
          <p className="ip-auth-invite">
            <Icon name="team" size={18} /> הוזמנתם להצטרף לקבוצה. התחברו כדי להמשיך.
          </p>
        )}
      </div>

      <div className="ip-auth-card">
        {!target ? (
          <form onSubmit={usePassword && method === 'email' ? signInWithPassword : sendCode} className="ip-form" noValidate>
            <h1>{known ? 'ברוכים השבים' : 'כניסה או הרשמה'}</h1>
            <p className="ip-muted">
              {usePassword
                ? 'כניסה עם המייל והסיסמה שהגדרתם בחשבון.'
                : known
                  ? 'נשלח לכם מייל עם כפתור כניסה. מתחברים פעם אחת, ומאז המכשיר זוכר אתכם.'
                  : 'נשלח מייל עם כפתור כניסה (וגם קוד). מתחברים רק פעם אחת בכל מכשיר.'}
            </p>
            {smsEnabled && !usePassword && (
              <Segmented
                items={[
                  { id: 'phone', label: 'טלפון' },
                  { id: 'email', label: 'אימייל' },
                ]}
                value={method}
                onChange={(m) => {
                  setMethod(m);
                  setValue('');
                  setError(null);
                }}
                label="שיטת כניסה"
              />
            )}
            <label className="ip-field">
              <span>{method === 'phone' ? 'מספר נייד' : 'כתובת אימייל'}</span>
              <input
                id="auth-identifier"
                className="ip-input"
                type={method === 'phone' ? 'tel' : 'email'}
                inputMode={method === 'phone' ? 'tel' : 'email'}
                autoComplete={method === 'phone' ? 'tel' : 'email'}
                dir="ltr"
                placeholder={method === 'phone' ? '050-1234567' : 'name@example.com'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </label>
            {usePassword && method === 'email' && (
              <label className="ip-field">
                <span>סיסמה</span>
                <input
                  id="auth-password"
                  className="ip-input"
                  type="password"
                  autoComplete="current-password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {error && <p className="ip-error" role="alert">{error}</p>}
            <Button type="submit" variant="primary" block disabled={busy || !value.trim() || (usePassword && !password)}>
              {usePassword && method === 'email'
                ? busy
                  ? 'נכנסים…'
                  : 'כניסה'
                : busy
                  ? 'שולחים…'
                  : method === 'email'
                    ? 'שליחת לינק כניסה'
                    : 'שליחת קוד'}
            </Button>
            <div className="ip-form-links">
              {method === 'email' && (
                <button
                  type="button"
                  className="ip-link"
                  onClick={() => {
                    setUsePassword(!usePassword);
                    preferPassword(!usePassword);
                    setError(null);
                  }}
                >
                  {usePassword ? 'שכחתי סיסמה / כניסה עם לינק למייל' : 'יש לי סיסמה'}
                </button>
              )}
            </div>
            {known && (
              <div className="ip-form-links">
                <button
                  type="button"
                  className="ip-link"
                  onClick={() => {
                    forgetEmail();
                    setKnown(null);
                    setValue('');
                  }}
                >
                  כניסה עם מייל אחר
                </button>
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={verify} className="ip-form" noValidate>
            <h1>{method === 'email' ? 'המשיכו מהמייל' : 'הזינו את הקוד'}</h1>
            {method === 'email' ? (
              <p className="ip-muted">
                שלחנו מייל ל-<bdi dir="ltr">{target}</bdi>.{' '}
                {standalone
                  ? 'הכפתור במייל נפתח בדפדפן ולא באפליקציה שבמסך הבית, לכן כאן הקלידו את הקוד שמופיע במייל.'
                  : 'פתחו אותו ולחצו על "כניסה ל-iplays". תיכנסו מיד, ומעכשיו המכשיר יזכור אתכם. אפשר לסגור את המסך הזה.'}
              </p>
            ) : (
              <p className="ip-muted">
                שלחנו קוד למספר <bdi dir="ltr">{target}</bdi>
              </p>
            )}
            {showCode && (
              <label className="ip-field">
                <span>קוד אימות</span>
                <input
                  id="auth-code"
                  className="ip-input ip-input--otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={8}
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  autoFocus
                />
              </label>
            )}
            {error && <p className="ip-error" role="alert">{error}</p>}
            {showCode && (
              <Button type="submit" variant="primary" block disabled={busy || code.length < 6}>
                {busy ? 'בודקים…' : 'כניסה'}
              </Button>
            )}
            <div className="ip-form-links">
              {!showCode && (
                <button type="button" className="ip-link" onClick={() => setShowCode(true)}>
                  יש לי קוד מהמייל
                </button>
              )}
              <button type="button" className="ip-link" onClick={() => sendCode()} disabled={busy}>
                {method === 'email' ? 'שליחת מייל חדש' : 'שליחת קוד חדש'}
              </button>
              <button type="button" className="ip-link" onClick={() => setTarget(null)}>
                {method === 'phone' ? 'שינוי מספר' : 'שינוי כתובת'}
              </button>
            </div>
          </form>
        )}
      </div>

      <button type="button" className="ip-auth-demo" onClick={() => setDemo(true)}>
        רק רוצים להציץ? <strong>לצפייה בהדגמה</strong>
      </button>
    </div>
  );
}
