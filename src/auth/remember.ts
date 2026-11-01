/**
 * "Sign up once, stay signed in" helpers.
 *
 * - The login email is remembered on the device, so if a session ever ends the
 *   login screen says "welcome back" with the address already filled in.
 * - After login we ask the browser to keep our storage (navigator.storage.persist),
 *   so it is not cleared under storage pressure.
 * - The email contains a link of the form <site>/?token_hash=…&type=email.
 *   Opening it signs the parent in directly, in any browser (no code to type).
 */
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const EMAIL_KEY = 'iplays.lastEmail';

export function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
  } catch {
    /* storage unavailable */
  }
}

export function rememberedEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function forgetEmail() {
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

/** Ask the browser not to evict our storage (and with it the login). Best effort. */
export function requestPersistentStorage() {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    /* unsupported */
  }
}

/** Running as an installed home-screen app (its storage is separate from the browser's on iPhone). */
export function isStandaloneApp(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Where the email link should bring the parent back to (this site, whichever host it runs on). */
export function emailRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

const LINK_TYPES: EmailOtpType[] = ['email', 'magiclink', 'signup', 'invite'];

/**
 * If the page was opened from the login email, sign in with its token and
 * strip it from the address bar. Returns an error message for an expired or
 * already-used link, otherwise null.
 */
export async function consumeEmailLink(): Promise<string | null> {
  if (!supabase) return null;
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  if (!tokenHash) return null;
  const rawType = params.get('type') as EmailOtpType | null;
  const type: EmailOtpType = rawType && LINK_TYPES.includes(rawType) ? rawType : 'email';
  params.delete('token_hash');
  params.delete('type');
  const q = params.toString();
  history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    // Already signed in on this device (e.g. the link was opened twice): nothing to report.
    const { data: s } = await supabase.auth.getSession();
    return s.session ? null : 'הלינק כבר נוצל או שפג תוקפו. שלחו לעצמכם לינק חדש.';
  }
  if (data.user?.email) rememberEmail(data.user.email);
  return null;
}

/* Password sign-in: optional, set from the account screen. Lets a parent sign
 * in from another computer (or the iPhone home-screen app) without an email. */
const METHOD_KEY = 'iplays.loginMethod';
export function preferPassword(on: boolean) {
  try {
    if (on) localStorage.setItem(METHOD_KEY, 'password');
    else localStorage.removeItem(METHOD_KEY);
  } catch {
    /* ignore */
  }
}
export function prefersPassword(): boolean {
  try {
    return localStorage.getItem(METHOD_KEY) === 'password';
  } catch {
    return false;
  }
}

/** Hebrew message for password errors from Supabase. */
export function passwordError(e: unknown): string {
  const msg = ((e as { message?: string })?.message ?? String(e)).toLowerCase();
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
    return 'המייל או הסיסמה לא נכונים. אפשר גם לבקש לינק כניסה למייל.';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'צריך קודם להיכנס פעם אחת עם הלינק מהמייל.';
  if (code === 'same_password' || msg.includes('different from the old')) return 'זו כבר הסיסמה שלכם.';
  if (code === 'weak_password' || msg.includes('password should')) return 'הסיסמה חלשה מדי. בחרו לפחות 8 תווים, עם אותיות ומספרים.';
  if (code === 'reauthentication_needed' || msg.includes('reauthentication'))
    return 'מטעמי אבטחה צריך להיכנס מחדש עם לינק מהמייל, ואז להגדיר סיסמה.';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'יותר מדי ניסיונות. נסו שוב בעוד דקה.';
  if (msg.includes('failed to fetch')) return 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.';
  return 'משהו השתבש. נסו שוב.';
}
