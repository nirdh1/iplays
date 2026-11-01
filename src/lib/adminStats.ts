/**
 * Super Admin usage stats + the presence heartbeat behind "online now".
 * Server side: supabase/migrations/20261101998000_admin_stats.sql
 * Aggregate counts only; the heartbeat stores a user id and a time, nothing else.
 */
import { supabase } from './supabase';

export interface AdminStats {
  generated_at: string;
  online_window_minutes: number;
  users_total: number;
  users_new_7d: number;
  signed_in_today: number;
  signed_in_7d: number;
  signed_in_30d: number;
  signed_in_ever: number;
  online_now: number;
  active_today: number;
  active_7d: number;
  teams_total: number;
  teams_with_members: number;
  teams_with_staff: number;
  teams_in_club: number;
  teams_linked_ifa: number | null;
  clubs_total: number;
  clubs_verified: number;
  coaches_total: number;
  coaches_active_7d: number;
  coaches_online_now: number;
  parents_total: number;
  rides_users: number | null;
  rides_drivers: number | null;
  rides_offered: number | null;
  rides_seats_taken: number | null;
  rides_teams: number | null;
}

export async function getAdminStats(): Promise<AdminStats> {
  if (!supabase) throw new Error('backend not configured');
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw error;
  return data as AdminStats;
}

const BEAT_MS = 60_000;

/** While the app is open and visible, tell the server once a minute. Returns a stop function. */
export function startPresence(): () => void {
  const client = supabase;
  if (!client) return () => {};
  let missing = false;
  const beat = () => {
    if (missing || document.visibilityState !== 'visible') return;
    void client.rpc('touch_presence').then(({ error }) => {
      // before the migration runs the function does not exist: stop quietly
      if (error && (error.code === 'PGRST202' || error.code === '42883')) missing = true;
    });
  };
  beat();
  const timer = window.setInterval(beat, BEAT_MS);
  document.addEventListener('visibilitychange', beat);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', beat);
  };
}
