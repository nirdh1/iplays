/**
 * Super Admin growth metrics (#adminmetrics) + the activity heartbeat.
 * Server side: supabase/migrations/20261103700000_admin_growth_metrics.sql
 * The heartbeat stores only a user id, a time and the day; the report is
 * returned to platform admins only.
 */
import { supabase } from './supabase';

export interface DailyPoint {
  day: string;
  new_users: number;
  users: number;
  new_parents: number;
  parents: number;
  new_linked_players: number;
  linked_players: number;
  active: number;
}

export interface GrowthMetrics {
  generated_at: string;
  today: string;
  days: number;
  tracking_since: string | null;
  totals: {
    users: number;
    parents: number;
    staff: number;
    self_players: number;
    players: number;
    players_imported: number;
    players_imported_linked: number;
    players_added_in_app: number;
    players_linked: number;
    teams: number;
    teams_with_parent: number;
    teams_with_active_parent_7d: number;
    teams_with_staff: number;
    clubs: number;
    clubs_verified: number;
    clubs_with_admin: number;
    clubs_with_teams: number;
  };
  activity: {
    online_now: number;
    dau: number;
    dau_yesterday: number;
    wau: number;
    wau_prev: number;
    mau: number;
    signed_in_today: number;
    signed_in_7d: number;
  };
  daily: DailyPoint[];
  retention: { w1_cohort: number; w1_returned: number; w4_cohort: number; w4_returned: number };
  funnel: {
    signed_up: number;
    joined_team: number;
    linked_child: number;
    active_7d: number;
    team_invites_created: number | null;
    family_invites_created: number | null;
    family_invites_used: number | null;
  };
  features: Record<'contacts' | 'gallery' | 'feedback' | 'rides' | 'trainings' | 'absences' | 'self_stats', number | null>;
  top_teams: { id: string; name: string; club: string | null; parents: number; active_7d: number; players: number; players_linked: number }[];
  clubs: { id: string; name: string; city: string; status: string; admins: number; teams: number; parents: number; created_at: string }[];
  recent_users: { id: string; name: string; email: string | null; created_at: string; last_sign_in_at: string | null; last_seen: string | null; kids: number; is_staff: boolean }[];
}

export interface MultiChildUser {
  user_id: string;
  name: string;
  email: string | null;
  last_sign_in_at: string | null;
  kids_count: number;
  kids: { player_id: string; name: string; birth_year: number | null; relation: 'parent' | 'family'; kinship: string; team: string | null; club: string | null; imported: boolean; linked_at: string }[];
}

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export async function getGrowthMetrics(days = 30): Promise<GrowthMetrics> {
  const { data, error } = await db().rpc('admin_growth_metrics', { p_days: days });
  if (error) throw error;
  return data as GrowthMetrics;
}

export async function getMultiChildUsers(): Promise<MultiChildUser[]> {
  const { data, error } = await db().rpc('admin_multi_child_users');
  if (error) throw error;
  return (data ?? []) as MultiChildUser[];
}

/** Percent change from `prev` to `cur`; null when there is no base to compare to. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

/** Share as a whole percent; null when the base is 0. */
export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
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
