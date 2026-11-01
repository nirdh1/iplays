/**
 * Sign-in / sign-up with email + password, password-manager friendly
 * (iCloud Keychain / Google Password Manager offer to save and autofill it,
 * also in the home-screen app). The session is then kept on the device and
 * renewed automatically, so a parent signs in once per device.
 *
 * Fallback for parents without a password (or who forgot it): a one-time code
 * by email, typed here; right after it the app asks them to choose a password.
 */
import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { Icon } from '../components/Icon';
import { Button, Segmented } from '../components/ui';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/api';
import { readPendingInvite, useAuth } from '../auth/AuthContext';
import { askForPasswordNext, emailRedirectUrl, passwordError, preferPassword, rememberEmail, rememberedEmail, storeCredential } from '../auth/remember';

type Mode = 'signin' | 'signup' | 'code';
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function AuthScreen() {
  const { setDemo, linkError } = useAuth();
  const known = rememberedEmail();
  const [mode, setMode] = useState<Mode>(known ? 'signin' : 'signup');
  const [email, setEmail] = useState(known ?? '');
  const [password, setPassword] = useState('');
  // Set when a code was emailed: sign-up confirmation or a code sign-in.
  const [codeFor, setCodeFor] = useState<{ email: string; type: 'signup' | 'email' } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkError);
  const [info, setInfo] = useState<string | null>(null);
  const invite = readPendingInvite();

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  function cleanEmail(): string | null {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setError('כתובת המייל לא תקינה');
      return null;
    }
    return e;
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const em = cleanEmail();
    if (!em) return;
    if (!password) return setError('הקלידו סיסמה');
    setBusy(true);
    const { error: err } = await supabase!.auth.signInWithPassword({ email: em, password });
    setBusy(false);
    if (err) return setError(passwordError(err));
    rememberEmail(em);
    preferPassword(true);
    storeCredential(em, password);
    // AuthContext picks up the session and the app moves on.
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const em = cleanEmail();
    if (!em) return;
    if (password.length < 8) return setError('בחרו סיסמה של 8 תווים לפחות.');
    setBusy(true);
    const { data, error: err } = await supabase!.auth.signUp({
      email: em,
      password,
      options: { emailRedirectTo: emailRedirectUrl(), data: { has_password: true } },
    });
    setBusy(false);
    if (err) {
      if (/already registered|already exists/i.test(err.message)) {
        setMode('signin');
        return setInfo('המייל הזה כבר רשום. היכנסו עם הסיסמה, או "שכחתי סיסמה" אם עוד לא הגדרתם.');
      }
      return setError(passwordError(err));
    }
    rememberEmail(em);
    preferPassword(true);
    storeCredential(em, password);
    // With email confirmation on, Supabase returns no session (and, for an
    // address that is already registered, a user without identities).
    if (!data.session) {
      if (data.user && data.user.identities?.length === 0) {
        setMode('signin');
        return setInfo('המייל הזה כבר רשום. היכנסו עם הסיסמה, או "שכחתי סיסמה" אם עוד לא הגדרתם.');
      }
      setCodeFor({ email: em, type: 'signup' });
      setCode('');
    }
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const em = codeFor?.email ?? cleanEmail();
    if (!em) return;
    setBusy(true);
    const { error: err } =
      codeFor?.type === 'signup'
        ? await supabase!.auth.resend({ type: 'signup', email: em, options: { emailRedirectTo: emailRedirectUrl() } })
        : await supabase!.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true, emailRedirectTo: emailRedirectUrl() } });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    rememberEmail(em);
    if (!codeFor) setCodeFor({ email: em, type: 'email' });
    setCode('');
    setInfo('שלחנו קוד חדש.');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!codeFor) return;
    setError(null);
    setBusy(true);
    // Signed in with a code (no password yet / forgot it): ask for a password right after.
    if (codeFor.type === 'email') askForPasswordNext(true);
    const { error: err } = await supabase!.auth.verifyOtp({ email: codeFor.email, token: code, type: codeFor.type });
    setBusy(false);
    if (err) {
      askForPasswordNext(false);
      setError(friendlyError(err));
    }
  }

  const emailField = (
    <label className="ip-field">
      <span>כתובת אימייל</span>
      <input
        id="auth-identifier"
        name="email"
        className="ip-input"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        dir="ltr"
        placeholder="name@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
    </label>
  );

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
        {codeFor ? (
          <form onSubmit={verify} className="ip-form" noValidate>
            <h1>{codeFor.type === 'signup' ? 'אישור המייל' : 'הקלידו את הקוד'}</h1>
            <p className="ip-muted">
              שלחנו קוד ל-<bdi dir="ltr">{codeFor.email}</bdi>. הקלידו אותו כאן
              {codeFor.type === 'signup' ? ' (רק הפעם, כדי לאשר שהמייל שלכם).' : '.'}
            </p>
            <label className="ip-field">
              <span>קוד מהמייל</span>
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
            {info && <p className="ip-muted">{info}</p>}
            {error && (
              <p className="ip-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" block disabled={busy || code.length < 6}>
              {busy ? 'בודקים…' : 'המשך'}
            </Button>
            <div className="ip-form-links">
              <button type="button" className="ip-link" onClick={() => sendCode()} disabled={busy}>
                שליחת קוד חדש
              </button>
              <button
                type="button"
                className="ip-link"
                onClick={() => {
                  setCodeFor(null);
                  setInfo(null);
                  setError(null);
                }}
              >
                חזרה
              </button>
            </div>
          </form>
        ) : mode === 'code' ? (
          <form onSubmit={sendCode} className="ip-form" noValidate>
            <h1>כניסה עם קוד למייל</h1>
            <p className="ip-muted">שכחתם סיסמה, או שעוד לא הגדרתם? נשלח קוד למייל, ומיד אחרי הכניסה תבחרו סיסמה.</p>
            {emailField}
            {error && (
              <p className="ip-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" block disabled={busy || !email.trim()}>
              {busy ? 'שולחים…' : 'שליחת קוד'}
            </Button>
            <div className="ip-form-links">
              <button type="button" className="ip-link" onClick={() => switchMode('signin')}>
                חזרה לכניסה עם סיסמה
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={mode === 'signin' ? signIn : signUp} className="ip-form" noValidate>
            <Segmented
              items={[
                { id: 'signin', label: 'כניסה' },
                { id: 'signup', label: 'הרשמה' },
              ]}
              value={mode}
              onChange={(m) => switchMode(m as Mode)}
              label="כניסה או הרשמה"
            />
            <h1>{mode === 'signin' ? (known ? 'ברוכים השבים' : 'כניסה') : 'הרשמה ל-iplays'}</h1>
            <p className="ip-muted">
              {mode === 'signin'
                ? 'מייל וסיסמה. המכשיר יכול לשמור את הסיסמה ולמלא אותה בשבילכם.'
                : 'בוחרים מייל וסיסמה. מתחברים פעם אחת, והמכשיר זוכר אתכם.'}
            </p>
            {emailField}
            <label className="ip-field">
              <span>{mode === 'signin' ? 'סיסמה' : 'סיסמה (8 תווים לפחות)'}</span>
              <input
                id="auth-password"
                name="password"
                className="ip-input"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                dir="ltr"
                minLength={mode === 'signup' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {info && <p className="ip-muted">{info}</p>}
            {error && (
              <p className="ip-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" block disabled={busy || !email.trim() || !password}>
              {busy ? (mode === 'signin' ? 'נכנסים…' : 'נרשמים…') : mode === 'signin' ? 'כניסה' : 'הרשמה'}
            </Button>
            <div className="ip-form-links">
              <button type="button" className="ip-link" onClick={() => switchMode('code')}>
                {mode === 'signin' ? 'שכחתי סיסמה / אין לי סיסמה' : 'כניסה עם קוד למייל'}
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
