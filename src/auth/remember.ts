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
