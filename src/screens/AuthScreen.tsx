/** Login / sign-up in one flow: phone (SMS) or email, then a one-time code. No passwords. */
import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { Icon } from '../components/Icon';
import { Button, Segmented } from '../components/ui';
import { normalizeIlPhone, supabase } from '../lib/supabase';
import { friendlyError } from '../lib/api';
import { readPendingInvite, useAuth } from '../auth/AuthContext';

type Method = 'phone' | 'email';

export function AuthScreen() {
  const { setDemo } = useAuth();
  const [method, setMethod] = useState<Method>('phone');
  const [value, setValue] = useState('');
  const [target, setTarget] = useState<string | null>(null); // normalized phone / email the code was sent to
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = readPendingInvite();

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const t = method === 'phone' ? normalizeIlPhone(value) : value.trim().toLowerCase();
    if (!t || (method === 'email' && !/^\S+@\S+\.\S+$/.test(t))) {
      setError(method === 'phone' ? 'מספר הטלפון לא תקין. לדוגמה: 050-1234567' : 'כתובת המייל לא תקינה');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase!.auth.signInWithOtp(method === 'phone' ? { phone: t } : { email: t, options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setTarget(t);
    setCode('');
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
          <form onSubmit={sendCode} className="ip-form" noValidate>
            <h1>כניסה או הרשמה</h1>
            <p className="ip-muted">נשלח אליכם קוד חד-פעמי. אין צורך בסיסמה.</p>
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
            {error && <p className="ip-error" role="alert">{error}</p>}
            <Button type="submit" variant="primary" block disabled={busy || !value.trim()}>
              {busy ? 'שולחים…' : 'שליחת קוד'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="ip-form" noValidate>
            <h1>הזינו את הקוד</h1>
            <p className="ip-muted">
              שלחנו קוד בן 6 ספרות אל <bdi dir="ltr">{target}</bdi>
            </p>
            <label className="ip-field">
              <span>קוד אימות</span>
              <input
                id="auth-code"
                className="ip-input ip-input--otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </label>
            {error && <p className="ip-error" role="alert">{error}</p>}
            <Button type="submit" variant="primary" block disabled={busy || code.length !== 6}>
              {busy ? 'בודקים…' : 'כניסה'}
            </Button>
            <div className="ip-form-links">
              <button type="button" className="ip-link" onClick={() => sendCode()} disabled={busy}>
                שליחת קוד חדש
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
