/**
 * Parent carpools for trainings and matches (incl. IFA league games).
 * Every write is a database function that checks the caller: only team
 * members see rides, only a child's parent can seat them or ask for a ride.
 */
import { supabase } from './supabase';
import type { EventKind } from './matchApi';

export type RideDirection = 'to' | 'from' | 'both';

export const directionLabel: Record<RideDirection, string> = {
  to: 'הלוך',
  from: 'חזור',
  both: 'הלוך וחזור',
};

export interface RidePassenger {
  player_id: string;
  first_name: string;
  added_by: string | null;
}

export interface Ride {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  direction: RideDirection;
  seats: number;
  leaves_at: string | null;
  meet_point: string;
  note: string;
  passengers: RidePassenger[];
}

export interface RideNeed {
  player_id: string;
  first_name: string;
  direction: RideDirection;
  note: string;
}

export interface EventRides {
  rides: Ride[];
  needs: RideNeed[];
}

export interface RideSummary {
  kind: EventKind;
  event_id: string;
  drivers: number;
  free_seats: number;
  needs: number;
}

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/** Before the rides SQL is run, the functions don't exist yet. */
export function ridesMissing(e: unknown): boolean {
  const x = e as { code?: string; message?: string };
  return x?.code === 'PGRST202' || x?.code === '42883' || /event_rides|rides_summary|could not find the function/i.test(x?.message ?? '');
}

export function rideError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (ridesMissing(e)) return 'ההסעות עוד לא הופעלו בשרת.';
  if (msg.includes('ride is full')) return 'אין יותר מקומות פנויים בהסעה הזו.';
  if (msg.includes('already has a ride')) return 'הילד כבר רשום להסעה אחרת לאותו כיוון.';
  if (msg.includes('more children are already seated')) return 'כבר יושבים בהסעה יותר ילדים ממספר המקומות.';
  if (msg.includes("child's parent")) return 'רק הורה רשום של הילד יכול לעשות את זה.';
  if (msg.includes('not in this team')) return 'הילד לא בסגל של הקבוצה הזו.';
  if (msg.includes('only the driver')) return 'רק הנהג יכול לבטל את ההסעה.';
  if (msg.includes('only team members')) return 'רק חברי הקבוצה רואים את ההסעות.';
  if (msg.includes('event not found')) return 'האימון או המשחק לא נמצאו.';
  if (msg.includes('not allowed')) return 'אין לך הרשאה לפעולה הזו.';
  return null;
}

export async function getEventRides(kind: EventKind, eventId: string): Promise<EventRides> {
  const { data, error } = await db().rpc('event_rides', { p_kind: kind, p_event: eventId });
  if (error) throw error;
  const d = (data ?? {}) as Partial<EventRides>;
  return { rides: d.rides ?? [], needs: d.needs ?? [] };
}

/** Upcoming-event summaries of one team; empty if rides aren't set up yet. */
export async function getRidesSummary(teamId: string): Promise<RideSummary[]> {
  const { data, error } = await db().rpc('rides_summary', { p_team: teamId });
  if (error) {
    if (ridesMissing(error)) return [];
    throw error;
  }
  return (data ?? []) as RideSummary[];
}

export async function offerRide(
  kind: EventKind,
  eventId: string,
  r: { direction: RideDirection; seats: number; leavesAt: string | null; meetPoint: string; note: string },
): Promise<string> {
  const { data, error } = await db().rpc('offer_ride', {
    p_kind: kind,
    p_event: eventId,
    p_direction: r.direction,
    p_seats: r.seats,
    p_leaves_at: r.leavesAt || null,
    p_meet_point: r.meetPoint,
    p_note: r.note,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelRide(rideId: string) {
  const { error } = await db().rpc('cancel_ride', { p_ride: rideId });
  if (error) throw error;
}

export async function joinRide(rideId: string, playerId: string) {
  const { error } = await db().rpc('join_ride', { p_ride: rideId, p_player: playerId });
  if (error) throw error;
}

export async function leaveRide(rideId: string, playerId: string) {
  const { error } = await db().rpc('leave_ride', { p_ride: rideId, p_player: playerId });
  if (error) throw error;
}

/** Mark that my child needs a ride (direction), or clear it (null). */
export async function setRideNeed(kind: EventKind, eventId: string, playerId: string, direction: RideDirection | null, note = '') {
  const { error } = await db().rpc('set_ride_need', { p_kind: kind, p_event: eventId, p_player: playerId, p_direction: direction, p_note: note });
  if (error) throw error;
}

/** "2 נהגים · 3 מקומות פנויים · 1 צריך הסעה" */
export function summaryLabel(s: Pick<RideSummary, 'drivers' | 'free_seats' | 'needs'> | undefined): string | null {
  if (!s || (!s.drivers && !s.needs)) return null;
  const parts: string[] = [];
  if (s.drivers) parts.push(s.drivers === 1 ? 'נהג אחד' : `${s.drivers} נהגים`);
  if (s.drivers) parts.push(s.free_seats === 0 ? 'אין מקומות פנויים' : s.free_seats === 1 ? 'מקום פנוי אחד' : `${s.free_seats} מקומות פנויים`);
  if (s.needs) parts.push(s.needs === 1 ? 'ילד אחד צריך הסעה' : `${s.needs} ילדים צריכים הסעה`);
  return parts.join(' · ');
}
