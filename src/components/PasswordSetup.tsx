/**
 * Optional password, so a parent can sign in from another computer or the
 * iPhone home-screen app with email + password instead of an email link.
 * - <PasswordCard/>: in the account screen (set or change).
 * - <PasswordNudge/>: a one-time popup after sign-in for parents without a password.
 * Whether a password is set is kept in user_metadata.has_password.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { askForPasswordNext, passwordError, passwordNext, preferPassword, prefersPassword, storeCredential } from '../auth/remember';
import { Button, Card, SectionHeader } from './ui';
import { Icon } from './Icon';

function usePasswordForm(onDone: () => void) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('לפחות 8 תווים.');
    if (pw !== pw2) return setError('הסיסמאות לא זהות.');
    setBusy(true);
    const { error: err } = await supabase!.auth.updateUser({ password: pw, data: { has_password: true } });
    setBusy(false);
    if (err) return setError(passwordError(err));
    preferPassword(true);
    const email = (await supabase!.auth.getUser()).data.user?.email;
    if (email) storeCredential(email, pw);
    setPw('');
    setPw2('');
    onDone();
  }

  const fields = (
    <>
      <label className="ip-field">
        <span>סיסמה חדשה</span>
        <input className="ip-input" type="password" autoComplete="new-password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="ip-field">
        <span>שוב, לאימות</span>
        <input className="ip-input" type="password" autoComplete="new-password" dir="ltr" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      {error && (
        <p className="ip-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  return { submit, fields, busy, ready: pw.length > 0 && pw2.length > 0 };
}

export function hasPassword(meta: Record<string, unknown> | undefined) {
  return meta?.has_password === true;
}

export function PasswordCard() {
  const { session } = useAuth();
  const has = hasPassword(session?.user.user_metadata);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const form = usePasswordForm(() => {
    setOpen(false);
    setSaved(true);
  });
  const email = session?.user.email;
  if (!email) return null; // phone accounts have no email to pair a password with

  return (
    <section>
      <SectionHeader title="כניסה עם סיסמה" icon="shield" />
      <Card>
        <p className="ip-muted">
          {has || saved
            ? 'יש לכם סיסמה. ממחשב או טלפון אחר נכנסים עם המייל והסיסמה, בלי לחכות למייל.'
            : 'רוצים להיכנס גם ממחשב או טלפון אחר בלי לחכות למייל? הגדירו סיסמה למייל שלכם.'}
        </p>
        {saved && <p className="ip-pw-saved">הסיסמה נשמרה.</p>}
        {open ? (
          <form className="ip-form" onSubmit={form.submit} noValidate>
            <input type="email" autoComplete="username" value={email} readOnly className="ip-visually-hidden" tabIndex={-1} aria-hidden="true" />
            {form.fields}
            <Button type="submit" variant="primary" block disabled={form.busy || !form.ready}>
              {form.busy ? 'שומרים…' : 'שמירת סיסמה'}
            </Button>
            <button type="button" className="ip-link" onClick={() => setOpen(false)}>
              ביטול
            </button>
          </form>
        ) : (
          <Button variant={has || saved ? 'ghost' : 'primary'} size="sm" onClick={() => setOpen(true)}>
            {has || saved ? 'שינוי סיסמה' : 'הגדרת סיסמה'}
          </Button>
        )}
      </Card>
    </section>
  );
}

const NUDGE_KEY = 'iplays.passwordNudge';

/** One-time popup after sign-up is complete (has a team). Waits until the home-screen popup is gone. */
export function PasswordNudge() {
  const { session, profile, teams } = useAuth();
  const [open, setOpen] = useState(false);
  const userId = session?.user.id;
  // Forced right after a code sign-in ("forgot password"); otherwise once, after sign-up is complete.
  const forced = !!session?.user.email && passwordNext();
  const eligible =
    forced || (!!session?.user.email && !!profile?.full_name && teams.length > 0 && !hasPassword(session?.user.user_metadata) && !prefersPassword());
  const dismissedKey = `${NUDGE_KEY}.${userId}`;

  useEffect(() => {
    if (!eligible || !userId) return;
    try {
      if (!forced && localStorage.getItem(dismissedKey)) return;
    } catch {
      return;
    }
    const t = window.setInterval(() => {
      if (!document.querySelector('.ip-a2hs')) {
        setOpen(true);
        window.clearInterval(t);
      }
    }, forced ? 600 : 3000);
    return () => window.clearInterval(t);
  }, [eligible, forced, userId, dismissedKey]);

  const close = () => {
    askForPasswordNext(false);
    try {
      localStorage.setItem(dismissedKey, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };
  const form = usePasswordForm(close);

  if (!open || !eligible || !session?.user.email) return null;
  return (
    <div className="ip-a2hs ip-a2hs--none" role="dialog" aria-labelledby="ip-pw-title">
      <form className="ip-a2hs-card ip-form" onSubmit={form.submit} noValidate>
        <button type="button" className="ip-a2hs-close" aria-label="סגירה" onClick={close}>
          <Icon name="close" size={16} />
        </button>
        <div className="ip-a2hs-head">
          <div>
            <strong id="ip-pw-title">{forced ? 'בחרו סיסמה' : 'נכנסים גם ממחשב אחר?'}</strong>
            <span>
              {forced
                ? 'כדי שבפעם הבאה תיכנסו עם מייל וסיסמה, והמכשיר יוכל לשמור אותה בשבילכם.'
                : 'במכשיר הזה אתם כבר מחוברים. עם סיסמה תוכלו להיכנס מכל מכשיר אחר עם המייל והסיסמה, בלי לחכות למייל.'}
            </span>
          </div>
        </div>
        <input type="email" autoComplete="username" value={session.user.email} readOnly className="ip-visually-hidden" tabIndex={-1} aria-hidden="true" />
        {form.fields}
        <Button type="submit" variant="primary" block disabled={form.busy || !form.ready}>
          {form.busy ? 'שומרים…' : 'שמירת סיסמה'}
        </Button>
        <button type="button" className="ip-a2hs-later" onClick={close}>
          לא עכשיו (אפשר גם אחר כך, בלשונית החשבון)
        </button>
      </form>
    </div>
  );
}
