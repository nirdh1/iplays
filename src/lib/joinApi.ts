/**
 * Open search, team pages, join / follow requests, shirt numbers and kit.
 * Server side: supabase/migrations/20261101400000_search_and_join_requests.sql
 */
import { supabase } from './supabase';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export type ProgramKind = 'league' | 'academy';
export type Relation = 'parent' | 'family';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const PARENT_DECLARATION = 'אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה';

export interface PlayerHit {
  player_id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  team_id: string;
  team_name: string;
  club_id: string | null;
  club_name: string | null;
  program_kind: ProgramKind | null;
}

export interface ClubHit {
  club_id: string;
  name: string;
  city: string;
  status: string;
  teams: number;
}

export interface PublicTeam {
  team_id: string;
  name: string;
  season: string;
  sport: string;
  club_id: string | null;
  club_name: string | null;
  club_status: string | null;
  program_kind: ProgramKind | null;
  players: number;
  is_member: boolean;
}

export interface ClubTeamRow {
  team_id: string;
  name: string;
  program_kind: ProgramKind | null;
  program_name: string | null;
  season: string;
  players: number;
}

export interface RosterName {
  player_id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  has_parent: boolean;
  linked: boolean;
}

export interface MyRequest {
  id: string;
  team_id: string;
  team_name: string;
  club_name: string | null;
  child_name: string;
  relation: Relation;
  status: RequestStatus;
  created_at: string;
}

export interface PendingRequest {
  id: string;
  user_id: string;
  requester: string;
  player_id: string | null;
  child_name: string;
  birth_year: number | null;
  message: string;
  created_at: string;
}

export interface FollowRequest {
  id: string;
  requester: string;
  player_id: string;
  child_name: string;
  message: string;
  created_at: string;
}

export interface Kit {
  summer_sets: number;
  winter_sets: number;
  home_sets: number;
  away_sets: number;
  socks: number;
  shirt_size: string;
  pants_size: string;
  shoe_size: string;
  notes: string;
}

export const emptyKit: Kit = {
  summer_sets: 0,
  winter_sets: 0,
  home_sets: 0,
  away_sets: 0,
  socks: 0,
  shirt_size: '',
  pants_size: '',
  shoe_size: '',
  notes: '',
};

export const programLabel: Record<ProgramKind, string> = { league: 'ליגה', academy: 'אקדמיה' };

/** Hebrew messages for the errors these functions raise (null = use the generic one). */
export function joinError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('parent declaration required')) return 'צריך לאשר את ההצהרה שאת/ה ההורה של הילד/ה.';
  if (msg.includes('child has no parent yet')) return 'לילד הזה עוד אין הורה רשום שיכול לאשר מעקב. אם את/ה ההורה, בקשו להצטרף כהורה.';
  if (msg.includes('join_requests_pending_idx')) return 'כבר שלחת בקשה כזו. היא ממתינה לאישור.';
  if (msg.includes('already linked')) return 'הילד כבר מקושר אליך בקבוצה הזו.';
  if (msg.includes('child already has a parent')) return 'לילד כבר יש הורה רשום. אפשר לבקש לעקוב, וההורה יאשר.';
  if (msg.includes('only the child')) return 'רק ההורה של הילד יכול לאשר מעקב.';
  if (msg.includes('not allowed')) return 'אין לך הרשאה לפעולה הזו.';
  if (msg.includes('player_assignments_shirt_idx')) return 'מספר החולצה הזה כבר תפוס בקבוצה.';
  if (msg.includes('shirt number must be')) return 'מספר חולצה בין 0 ל-99.';
  if (msg.includes('request not found')) return 'הבקשה כבר טופלה.';
  if (msg.includes('team not found')) return 'הקבוצה לא נמצאה.';
  return null;
}

export async function searchPlayers(query: string, birthYear?: number | null): Promise<PlayerHit[]> {
  const { data, error } = await db().rpc('search_players', { p_query: query, p_birth_year: birthYear ?? null });
  if (error) throw error;
  return (data ?? []) as PlayerHit[];
}

export async function searchClubs(query: string): Promise<ClubHit[]> {
  const { data, error } = await db().rpc('search_clubs', { p_query: query });
  if (error) throw error;
  return (data ?? []) as ClubHit[];
}

export async function clubTeamsPublic(clubId: string, birthYear?: number | null): Promise<ClubTeamRow[]> {
  const { data, error } = await db().rpc('club_teams_public', { p_club: clubId, p_birth_year: birthYear ?? null });
  if (error) throw error;
  return (data ?? []) as ClubTeamRow[];
}

export async function teamPublic(teamId: string): Promise<PublicTeam | null> {
  const { data, error } = await db().rpc('team_public', { p_team: teamId });
  if (error) throw error;
  return ((data ?? []) as PublicTeam[])[0] ?? null;
}

export async function teamRosterPublic(teamId: string): Promise<RosterName[]> {
  const { data, error } = await db().rpc('team_roster_public', { p_team: teamId });
  if (error) throw error;
  return (data ?? []) as RosterName[];
}

export async function requestJoin(input: {
  teamId: string;
  playerId?: string | null;
  first?: string;
  last?: string;
  birthYear?: number | null;
  message?: string;
  relation: Relation;
  declareParent?: boolean;
}): Promise<string> {
  const { data, error } = await db().rpc('request_join', {
    p_team: input.teamId,
    p_player: input.playerId ?? null,
    p_first: input.first ?? '',
    p_last: input.last ?? '',
    p_birth_year: input.birthYear ?? null,
    p_message: input.message ?? '',
    p_relation: input.relation,
    p_declare_parent: !!input.declareParent,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelJoinRequest(id: string) {
  const { error } = await db().rpc('cancel_join_request', { p_id: id });
  if (error) throw error;
}

export async function reviewJoinRequest(id: string, approve: boolean) {
  const { error } = await db().rpc('review_join_request', { p_id: id, p_approve: approve });
  if (error) throw error;
}

export async function myJoinRequests(): Promise<MyRequest[]> {
  const { data, error } = await db().rpc('my_join_requests');
  if (error) throw error;
  return (data ?? []) as MyRequest[];
}

export async function pendingJoinRequests(teamId: string): Promise<PendingRequest[]> {
  const { data, error } = await db().rpc('pending_join_requests', { p_team: teamId });
  if (error) throw error;
  return (data ?? []) as PendingRequest[];
}

export async function myFollowRequests(): Promise<FollowRequest[]> {
  const { data, error } = await db().rpc('my_follow_requests');
  if (error) throw error;
  return (data ?? []) as FollowRequest[];
}

export async function setShirtNumber(playerId: string, teamId: string, number: number | null) {
  const { error } = await db().rpc('set_shirt_number', { p_player: playerId, p_team: teamId, p_number: number });
  if (error) throw error;
}

export async function getKit(playerId: string): Promise<Kit | null> {
  const { data, error } = await db()
    .from('player_kit')
    .select('summer_sets, winter_sets, home_sets, away_sets, socks, shirt_size, pants_size, shoe_size, notes')
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data as Kit | null;
}

export async function setKit(playerId: string, k: Kit) {
  const { error } = await db().rpc('set_player_kit', {
    p_player: playerId,
    p_summer: k.summer_sets,
    p_winter: k.winter_sets,
    p_home: k.home_sets,
    p_away: k.away_sets,
    p_socks: k.socks,
    p_shirt_size: k.shirt_size,
    p_pants_size: k.pants_size,
    p_shoe_size: k.shoe_size,
    p_notes: k.notes,
  });
  if (error) throw error;
}

/** Link to a team's page, for sharing with other parents. */
export function teamLink(teamId: string) {
  return `${window.location.origin}${window.location.pathname}#t/${teamId}`;
}

/** Set once the user has finished (or skipped) the first-run team step. */
const ONBOARDED_KEY = 'iplays.onboarded';
export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}
export function wasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}
