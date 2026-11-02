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
/** 'self' = the player themselves (owns their profile). */
export type Relation = 'parent' | 'family' | 'self';
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

/** find_players(): supabase/migrations/20261102710000_find_players_by_name.sql */
export interface FoundPlayer extends PlayerHit {
  /** estimated from the IFA league's age group; only when no exact year was entered */
  birth_year_est: number | null;
  /** e.g. "נערים ג׳" */
  age_group: string | null;
  from_ifa: boolean;
  /** imported child with no parent yet, seen from outside the team: first name + initial only */
  name_hidden: boolean;
  /** how many hits show this same name */
  same_name: number;
}

/** "שנתון 2012", "נערים ג׳ (2012 משוער)", "נערים ג׳" or null */
export function foundBirthLabel(p: FoundPlayer): string | null {
  if (p.birth_year) return `שנתון ${p.birth_year}`;
  if (p.birth_year_est) return p.age_group ? `${p.age_group} (${p.birth_year_est} משוער)` : `${p.birth_year_est} משוער`;
  return p.age_group || null;
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
  /** someone manages the team (coach / club). false = parents join right away */
  has_staff: boolean;
  birth_year_from: number | null;
  birth_year_to: number | null;
}

export interface TeamHit {
  team_id: string;
  name: string;
  club_id: string | null;
  club_name: string | null;
  city: string | null;
  program_kind: ProgramKind | null;
  sport: string;
  season: string;
  age_group: string;
  birth_year_from: number | null;
  birth_year_to: number | null;
  players: number;
  has_staff: boolean;
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
  /** 'parent': someone else declared they are a parent (team with no staff). Missing before the migration. */
  relation?: Relation;
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
  if (msg.includes('this profile already has its player')) return 'לפרופיל הזה כבר יש שחקן שמחובר אליו. אם זו טעות, פנו להורה או למאמן.';
  if (msg.includes('you already own a player profile') || msg.includes('this user already owns a player profile')) return 'כבר יש לך פרופיל שחקן. אפשר להיות בעלים של פרופיל אחד.';
  if (msg.includes('a parent cannot claim')) return 'את/ה רשום/ה כהורה של הילד הזה, ולכן אי אפשר לסמן "זה אני".';
  if (msg.includes('player_self_claims_one_pending') || msg.includes('already requested')) return 'כבר שלחת בקשה כזו. היא ממתינה לאישור.';
  if (msg.includes('not allowed to approve this request')) return 'אין לך הרשאה לאשר את הבקשה הזו.';
  if (msg.includes('only the child\'s parent or the player')) return 'רק ההורה או השחקן עצמו יכולים לעשות את זה.';
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
  if (msg.includes('team_claims_pending_idx')) return 'כבר שלחת בקשה לנהל את הקבוצה. היא ממתינה לאישור.';
  if (msg.includes('already staff')) return 'את/ה כבר בצוות של הקבוצה.';
  if (msg.includes('not allowed to approve coaches')) return 'רק מנהל המועדון או מנהל המערכת מאשרים מאמנים.';
  if (msg.includes('team already exists')) return 'קבוצה עם אותו שם, מועדון ושנתון כבר קיימת. חפשו אותה ובקשו להצטרף.';
  if (msg.includes('birth year required')) return 'צריך לבחור שנתון.';
  if (msg.includes('team name must be')) return 'שם הקבוצה צריך להיות בין 2 ל-60 תווים.';
  if (msg.includes('child name required')) return 'צריך למלא את שם הילד/ה.';
  return null;
}

export async function searchPlayers(query: string, birthYear?: number | null): Promise<PlayerHit[]> {
  const { data, error } = await db().rpc('search_players', { p_query: query, p_birth_year: birthYear ?? null });
  if (error) throw error;
  return (data ?? []) as PlayerHit[];
}

export async function findPlayers(query: string, birthYear?: number | null): Promise<FoundPlayer[]> {
  const { data, error } = await db().rpc('find_players', { p_query: query, p_birth_year: birthYear ?? null });
  if (error) throw error;
  return (data ?? []) as FoundPlayer[];
}

/** find_teams(): supabase/migrations/20261102720000_smarter_search.sql */
export interface FoundTeam extends TeamHit {
  /** estimated from the age group, only when the team has no exact birth years */
  birth_year_est: number | null;
}

/** "נערים א׳ · שנתון 2010 (משוער)", "שנתון 2012", or null */
export function teamYearLabel(t: FoundTeam): string | null {
  const exact = birthYearsLabel(t.birth_year_from, t.birth_year_to);
  const year = exact ?? (t.birth_year_est ? `שנתון ${t.birth_year_est} (משוער)` : null);
  return [t.age_group && !t.name.includes(t.age_group) ? t.age_group : null, year].filter(Boolean).join(' · ') || null;
}

/** Words in any order, ת"א = תל אביב etc., a year in the text filters by birth year. */
export async function findTeams(query: string, birthYear?: number | null, sport?: string | null): Promise<FoundTeam[]> {
  const { data, error } = await db().rpc('find_teams', { p_query: query, p_birth_year: birthYear ?? null, p_sport: sport ?? null });
  if (error) throw error;
  return (data ?? []) as FoundTeam[];
}

export async function searchTeams(query: string, birthYear?: number | null, sport?: string | null): Promise<TeamHit[]> {
  const { data, error } = await db().rpc('search_teams', { p_query: query, p_birth_year: birthYear ?? null, p_sport: sport ?? null });
  if (error) throw error;
  return (data ?? []) as TeamHit[];
}

/** A parent opens a team that is not in the app yet, with their child. */
export async function openTeam(input: {
  name: string;
  club: string;
  sport: string;
  birthYear: number;
  childFirst: string;
  childLast: string;
  declareParent: boolean;
}): Promise<string> {
  const { data, error } = await db().rpc('open_team', {
    p_name: input.name,
    p_club: input.club,
    p_sport: input.sport,
    p_birth_year: input.birthYear,
    p_child_first: input.childFirst,
    p_child_last: input.childLast,
    p_declare_parent: input.declareParent,
  });
  if (error) throw error;
  return data as string;
}

export function birthYearsLabel(from: number | null, to: number | null) {
  if (!from) return null;
  return to && to !== from ? `שנתונים ${from}–${to}` : `שנתון ${from}`;
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

/** A child the caller is a declared parent of, also one who is in no team right now. */
export interface MyChild {
  player_id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  team_ids: string[];
  team_names: string[];
  /** The caller's own profile as a player (not a child of theirs). */
  is_self?: boolean;
}

/** The caller's children (empty if the SQL is not installed yet). */
export async function myChildren(): Promise<MyChild[]> {
  const { data, error } = await db().rpc('my_children');
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []) as MyChild[];
}

/** Who approves a player's "this is me": the child's parent, the team's staff, or a platform admin. */
export type SelfApprover = 'parent' | 'staff' | 'admin';

export const selfApproverLabel: Record<SelfApprover, string> = {
  parent: 'ההורה הרשום',
  staff: 'מאמן הקבוצה או מנהל המועדון',
  admin: 'מנהל המערכת',
};

export interface SelfClaim {
  id: string;
  player_id: string;
  player_name: string;
  birth_year: number | null;
  team_names: string[];
  requester: string;
  requester_email: string;
  message: string;
  approver: SelfApprover;
  created_at: string;
}

export interface MySelfClaim {
  id: string;
  player_id: string;
  player_name: string;
  status: 'pending' | 'rejected';
  approver: SelfApprover;
  created_at: string;
}

const missingFn = (error: { code?: string; message: string }) =>
  error.code === 'PGRST202' || /could not find the function/i.test(error.message);

/** A player says "this is me" about a roster profile. */
export async function requestPlayerSelf(playerId: string, message = ''): Promise<string> {
  const { data, error } = await db().rpc('request_player_self', { p_player: playerId, p_message: message });
  if (error) throw error;
  return data as string;
}

export async function cancelPlayerSelf(id: string) {
  const { error } = await db().rpc('cancel_player_self', { p_id: id });
  if (error) throw error;
}

export async function reviewPlayerSelf(id: string, approve: boolean) {
  const { error } = await db().rpc('review_player_self', { p_id: id, p_approve: approve });
  if (error) throw error;
}

/** Requests the caller can approve (empty before the SQL is installed). */
export async function pendingSelfClaims(): Promise<SelfClaim[]> {
  const { data, error } = await db().rpc('pending_self_claims');
  if (error) {
    if (missingFn(error)) return [];
    throw error;
  }
  return (data ?? []) as SelfClaim[];
}

export async function mySelfClaims(): Promise<MySelfClaim[]> {
  const { data, error } = await db().rpc('my_self_claims');
  if (error) {
    if (missingFn(error)) return [];
    throw error;
  }
  return (data ?? []) as MySelfClaim[];
}

/** Ask a team to take the caller's child with the child's existing profile (career and history stay). */
export async function requestJoinWithChild(teamId: string, playerId: string, message: string): Promise<string> {
  const { data, error } = await db().rpc('request_join_with_child', { p_team: teamId, p_player: playerId, p_message: message });
  if (error) throw error;
  return data as string;
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

// ------------------------------------------------ coach asks to manage a team
// Server side: supabase/migrations/20261101700000_team_claims.sql

export interface TeamClaim {
  id: string;
  team_id: string;
  team_name: string;
  club_name: string | null;
  requester: string;
  message: string;
  created_at: string;
}

export async function requestTeamClaim(teamId: string, message: string) {
  const { error } = await db().rpc('request_team_claim', { p_team: teamId, p_message: message });
  if (error) throw error;
}

export async function reviewTeamClaim(id: string, approve: boolean) {
  const { error } = await db().rpc('review_team_claim', { p_id: id, p_approve: approve });
  if (error) throw error;
}

/** Claims the caller can approve (club admin of the team's club, or Super Admin). */
export async function pendingTeamClaims(): Promise<TeamClaim[]> {
  const { data, error } = await db().rpc('pending_team_claims');
  if (error) throw error;
  return (data ?? []) as TeamClaim[];
}

/** My own pending coach request for a team, if any. */
export async function myTeamClaim(teamId: string): Promise<{ id: string; status: string } | null> {
  const { data, error } = await db()
    .from('team_claims')
    .select('id, status')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data;
}
