import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { backendEnabled, supabase } from '../lib/supabase';
import { getMyProfile, getMyTeams, type MyTeam, type Profile } from '../lib/api';

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

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setTeams([]);
      return;
    }
    const [p, t] = await Promise.all([getMyProfile(s.user.id), getMyTeams(s.user.id)]);
    setProfile(p);
    setTeams(t);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      try {
        await load(data.session);
      } finally {
        if (alive) setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Defer the fetch: Supabase warns against awaiting inside this callback.
      setTimeout(() => void load(s), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const refresh = useCallback(() => load(session), [load, session]);
  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setDemo(false);
  }, []);

  return (
    <Ctx.Provider value={{ enabled: backendEnabled, loading, session, profile, teams, demo, setDemo, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Invite codes arrive as #join/CODE before login; keep them until the user is signed in. */
const PENDING_KEY = 'iplays.pendingInvite';
export function savePendingInvite(code: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, code.toUpperCase());
  } catch {
    /* storage unavailable — the user can still type the code */
  }
}
export function readPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}
export function clearPendingInvite() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
