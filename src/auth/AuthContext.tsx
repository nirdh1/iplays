import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { backendEnabled, supabase } from '../lib/supabase';
import { getMyProfile, getMyTeams, type MyTeam, type Profile } from '../lib/api';
import { consumeEmailLink, rememberEmail, requestPersistentStorage } from './remember';

interface AuthState {
  /** false when no backend is configured: the app runs on demo data only */
  enabled: boolean;
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  teams: MyTeam[];
  /** The user chose "browse the demo" on the login screen */
  demo: boolean;
  setDemo: (v: boolean) => void;
  /** The login email link could not be used (expired / already used) */
  linkError: string | null;
  /** Profile + teams were fetched successfully for the current session. Until
   *  then the app must not treat the user as new (that sent returning parents
   *  back to sign-up on a weak connection). */
  loaded: boolean;
  /** The last profile/teams fetch failed; it is retried automatically. */
  loadFailed: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [teams, setTeams] = useState<MyTeam[]>([]);
  const [loading, setLoading] = useState(backendEnabled);
  const [demo, setDemo] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null); // user id whose data is loaded
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setTeams([]);
      setLoadedFor(null);
      setLoadFailed(false);
      return;
    }
    try {
      const [p, t] = await Promise.all([getMyProfile(s.user.id), getMyTeams(s.user.id)]);
      setProfile(p);
      setTeams(t);
      setLoadedFor(s.user.id);
      setLoadFailed(false);
    } catch (e) {
      // Keep whatever was loaded before; never fall back to "new user".
      setLoadFailed(true);
      throw e;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const client = supabase;
    (async () => {
      // Opened from the login email: sign in with its token first.
      const err = await consumeEmailLink().catch(() => null);
      if (!alive) return;
      setLinkError(err);
      const { data } = await client.auth.getSession();
      if (!alive) return;
      setSession(data.session);
      if (data.session) requestPersistentStorage();
      try {
        await load(data.session);
      } catch {
        /* screens show their own errors; keep the session */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' && s) {
        if (s.user.email) rememberEmail(s.user.email);
        requestPersistentStorage();
        setLinkError(null);
      }
      // Defer the fetch: Supabase warns against awaiting inside this callback.
      setTimeout(() => void load(s).catch(() => undefined), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const refresh = useCallback(() => load(session), [load, session]);
  const loaded = !!session && loadedFor === session.user.id;

  // A failed fetch (weak signal, server waking up) is retried: on a timer with
  // backoff, when the connection comes back, and when the app is reopened.
  useEffect(() => {
    if (!session || loaded || !loadFailed) return;
    let tries = 0;
    let timer = 0;
    const retry = () => void load(session).catch(() => undefined);
    const schedule = () => {
      timer = window.setTimeout(() => {
        tries += 1;
        load(session).catch(() => {
          if (tries < 6) schedule();
        });
      }, Math.min(2000 * 2 ** tries, 30000));
    };
    schedule();
    const onVisible = () => document.visibilityState === 'visible' && retry();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session, loaded, loadFailed, load]);
  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setDemo(false);
  }, []);

  return (
    <Ctx.Provider value={{ enabled: backendEnabled, loading, session, profile, teams, demo, setDemo, linkError, loaded, loadFailed, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/*
 * Invite codes arrive before login and are kept until the user is signed in.
 * They live in localStorage (not sessionStorage) because the login email link
 * opens a new tab, and expire after two days.
 */
const INVITE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
function saveCode(key: string, code: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
  } catch {
    /* storage unavailable — the user can still type the code */
  }
}
function readCode(key: string): string | null {
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (!raw) return null;
    if (!raw.startsWith('{')) return raw; // saved by an older version
    const { code, at } = JSON.parse(raw) as { code: string; at: number };
    if (Date.now() - at > INVITE_TTL_MS) {
      clearCode(key);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}
function clearCode(key: string) {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Team invites: #join/CODE */
const PENDING_KEY = 'iplays.pendingInvite';
export const savePendingInvite = (code: string) => saveCode(PENDING_KEY, code);
export const readPendingInvite = () => readCode(PENDING_KEY);
export const clearPendingInvite = () => clearCode(PENDING_KEY);

/** Club staff invites: #staff/CODE8 */
const STAFF_KEY = 'iplays.pendingStaffInvite';
export const saveStaffInvite = (code: string) => saveCode(STAFF_KEY, code);
export function takeStaffInvite(): string | null {
  const code = readCode(STAFF_KEY);
  clearCode(STAFF_KEY);
  return code;
}

/** Family invites (second parent, grandparents, ...): #fam/CODE10 */
const FAMILY_KEY = 'iplays.pendingFamilyInvite';
export const saveFamilyInvite = (code: string) => saveCode(FAMILY_KEY, code);
export const readFamilyInvite = () => readCode(FAMILY_KEY);
export const clearFamilyInvite = () => clearCode(FAMILY_KEY);
