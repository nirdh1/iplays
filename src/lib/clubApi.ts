/**
 * Club management: clubs, programs (league / academy), the club's teams,
 * player assignments and transfers between programs.
 * Everything goes through RLS and the SECURITY DEFINER functions in
 * supabase/migrations/20261101200000_clubs_and_assignments.sql.
 */
import { supabase } from './supabase';

export type ClubStatus = 'catalog' | 'draft' | 'pending_verification' | 'verified' | 'suspended';
export type ClubKind = 'club' | 'academy';
export type ClubRole = 'owner' | 'admin' | 'staff';
export type ProgramKind = 'league' | 'academy';
export type TransferKind = 'move' | 'add' | 'end';

export interface Club {
  id: string;
  name: string;
  city: string;
  status: ClubStatus;
  role: ClubRole;
  kind?: ClubKind;
  /** names of the custom club roles the user holds here */
  roles?: string[];
}

export interface Program {
  id: string;
  club_id: string;
  kind: ProgramKind;
  name: string;
}

export interface ClubTeam {
  id: string;
  name: string;
  season: string;
  age_group: string;
  program_id: string | null;
  archived_at: string | null;
}

export interface Assignment {
  id: string;
  player_id: string;
  team_id: string;
  shirt_number: number | null;
  is_primary: boolean;
  started_on: string;
  player: { first_name: string; last_name: string; birth_year: number | null };
}

export interface Transfer {
  id: string;
  player_id: string;
  kind: TransferKind;
  from_team_id: string | null;
  to_team_id: string | null;
  reason: string;
  effective_on: string;
  player_name: string;
}

export const clubStatusLabel: Record<ClubStatus, string> = {
  catalog: 'במאגר, ללא מנהל',
  draft: 'טיוטה',
  pending_verification: 'ממתין לאימות',
  verified: 'מאומת',
  suspended: 'מושהה',
};
export const clubRoleLabel: Record<ClubRole, string> = { owner: 'בעלים', admin: 'מנהל/ת מועדון', staff: 'צוות' };
export const programKindLabel: Record<ProgramKind, string> = { league: 'ליגה', academy: 'אקדמיה' };
export const transferKindLabel: Record<TransferKind, string> = { move: 'מעבר', add: 'הצטרפות במקביל', end: 'סיום שיוך' };

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/** Hebrew messages for errors raised by the club functions. */
export function clubError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('already in this team')) return 'השחקן כבר בקבוצה הזו.';
  if (msg.includes('no current team to move from')) return 'לשחקן אין קבוצה נוכחית שממנה אפשר להעביר.';
  if (msg.includes('target team is archived')) return 'קבוצת היעד בארכיון.';
  if (msg.includes('player_assignments_shirt_idx')) return 'מספר החולצה הזה תפוס בקבוצת היעד.';
  if (msg.includes('not allowed') || msg.includes('only a club admin') || msg.includes('only the team admin')) return 'אין לך הרשאה לפעולה הזו.';
  if (msg.includes('clubs_verified_name_idx')) return 'כבר קיים מועדון מאומת בשם הזה.';
  if (msg.includes('invalid or expired invite')) return 'קישור ההזמנה לא תקין, כבר נוצל או שפג תוקפו. בקשו קישור חדש ממנהל המועדון.';
  if (msg.includes('only the club owner')) return 'רק בעלי המועדון יכולים להזמין מנהלי מועדון.';
  if (msg.includes('team already has staff')) return 'לקבוצה הזו כבר יש מאמן או מועדון.';
  if (msg.includes('not on the club staff')) return 'אפשר לתת הרשאות רק לאנשי צוות של המועדון.';
  if (msg.includes('club already exists in this city')) return 'מועדון בשם הזה כבר קיים בעיר. חפשו אותו ברשימה ושלחו בקשה לנהל אותו.';
  if (msg.includes('pick at least one team')) return 'בחרו לפחות קבוצה אחת בכל מועדון שסימנתם.';
  if (msg.includes('pick between 1 and 20 clubs')) return 'בחרו בין מועדון אחד ל-20 מועדונים.';
  if (msg.includes('city is required')) return 'נא למלא עיר.';
  if (msg.includes('review your own request')) return 'אי אפשר לאשר בקשה של עצמך.';
  if (msg.includes('not allowed to review')) return 'אין לך הרשאה לאשר בקשות במועדון הזה.';
  if (msg.includes('not allowed to manage roles')) return 'אין לך הרשאה לנהל תפקידים במועדון הזה.';
  if (msg.includes('permissions domain') || msg.includes('change this role')) return 'רק בעלי המועדון ומנהליו יכולים לתת או לשנות הרשאת ניהול הרשאות.';
  if (msg.includes('roles to themselves')) return 'אי אפשר לתת תפקיד לעצמך. בקשו ממנהל המועדון.';
  if (msg.includes('club_roles_name_idx')) return 'כבר יש תפקיד בשם הזה במועדון.';
  if (msg.includes('notes for this player') || msg.includes('this note')) return 'אין לך הרשאה להערות המקצועיות של השחקן הזה.';
  if (msg.includes('player is not in this club')) return 'השחקן לא משויך למועדון הזה.';
  return null;
}

/** Every club the user works in: owner / admin / staff, coach of a club team, or holder of a club role. */
export async function getMyClubs(_userId?: string): Promise<Club[]> {
  const { data, error } = await db().rpc('my_workspaces');
  if (error) throw error;
  return ((data ?? []) as { club_id: string; name: string; city: string; status: ClubStatus; kind: ClubKind; club_role: ClubRole; roles: string[] }[]).map(
    (r) => ({ id: r.club_id, name: r.name, city: r.city, status: r.status, kind: r.kind, role: r.club_role, roles: r.roles ?? [] }),
  );
}

export async function createClub(name: string, city: string): Promise<string> {
  const { data, error } = await db().rpc('create_club', { p_name: name, p_city: city });
  if (error) throw error;
  return data as string;
}

export async function requestVerification(clubId: string, message: string) {
  const { error } = await db().rpc('request_club_verification', { p_club: clubId, p_message: message });
  if (error) throw error;
}

export async function addProgram(clubId: string, kind: ProgramKind, name: string) {
  const { error } = await db().rpc('add_program', { p_club: clubId, p_kind: kind, p_name: name });
  if (error) throw error;
}

/** A club admin takes a team that parents opened (no coach, no club) into the club. */
export async function adoptTeam(teamId: string, clubId: string, programId: string | null) {
  const { error } = await db().rpc('adopt_team', { p_team: teamId, p_club: clubId, p_program: programId });
  if (error) throw error;
}

export async function setTeamProgram(teamId: string, programId: string | null) {
  const { error } = await db().rpc('set_team_program', { p_team: teamId, p_program: programId });
  if (error) throw error;
}

export interface ClubData {
  programs: Program[];
  teams: ClubTeam[];
  assignments: Assignment[];
  transfers: Transfer[];
}

export async function getClubData(clubId: string): Promise<ClubData> {
  const [programs, teams] = await Promise.all([
    db().from('club_programs').select('id, club_id, kind, name').eq('club_id', clubId).is('archived_at', null).order('created_at'),
    db().from('teams').select('id, name, season, age_group, program_id, archived_at').eq('club_id', clubId).order('name'),
  ]);
  if (programs.error) throw programs.error;
  if (teams.error) throw teams.error;
  const teamIds = (teams.data ?? []).map((t) => t.id);
  if (teamIds.length === 0) return { programs: programs.data ?? [], teams: [], assignments: [], transfers: [] };

  const list = teamIds.join(',');
  const [assignments, transfers] = await Promise.all([
    db()
      .from('player_assignments')
      .select('id, player_id, team_id, shirt_number, is_primary, started_on, players (first_name, last_name, birth_year)')
      .in('team_id', teamIds)
      .is('ended_on', null),
    db()
      .from('player_transfers')
      .select('id, player_id, kind, from_team_id, to_team_id, reason, effective_on, created_at, players (first_name, last_name)')
      .or(`to_team_id.in.(${list}),from_team_id.in.(${list})`)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  if (assignments.error) throw assignments.error;
  if (transfers.error) throw transfers.error;

  return {
    programs: programs.data ?? [],
    teams: teams.data ?? [],
    assignments: (assignments.data ?? []).map(({ players, ...a }) => ({
      ...a,
      player: (players as unknown as Assignment['player']) ?? { first_name: '', last_name: '', birth_year: null },
    })),
    transfers: (transfers.data ?? []).map(({ players, created_at: _c, ...t }) => {
      const p = players as unknown as { first_name: string; last_name: string } | null;
      return { ...t, kind: t.kind as TransferKind, player_name: p ? `${p.first_name} ${p.last_name}`.trim() : 'שחקן' };
    }),
  };
}

export async function transferPlayer(input: {
  playerId: string;
  toTeamId: string;
  mode: 'move' | 'add';
  fromTeamId?: string | null;
  reason?: string;
  shirt?: number | null;
}): Promise<string> {
  const { data, error } = await db().rpc('transfer_player', {
    p_player: input.playerId,
    p_to_team: input.toTeamId,
    p_mode: input.mode,
    p_from_team: input.fromTeamId ?? null,
    p_reason: input.reason ?? '',
    p_shirt: input.shirt ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function endAssignment(playerId: string, teamId: string, reason: string) {
  const { error } = await db().rpc('end_player_assignment', { p_player: playerId, p_team: teamId, p_reason: reason });
  if (error) throw error;
}

/* ------------------------------------------------------------ permissions */

export type TeamRole = 'admin' | 'coach' | 'assistant_coach' | 'instructor' | 'team_manager' | 'parent';
export type StaffTeamRole = Exclude<TeamRole, 'admin' | 'parent'>;

export const teamRoleLabel: Record<TeamRole, string> = {
  admin: 'מנהל/ת קבוצה',
  coach: 'מאמן/ת',
  assistant_coach: 'עוזר/ת מאמן',
  instructor: 'מדריך/ה',
  team_manager: 'מנהל/ת אדמיניסטרטיבי',
  parent: 'הורה',
};

export const levelLabel: Record<number, string> = { 1: 'צפייה', 2: 'יצירה', 3: 'עריכה', 4: 'ניהול' };

export interface Domain {
  domain: string;
  label: string;
}

export interface ClubPerson {
  user_id: string;
  full_name: string;
  club_role: ClubRole | null;
  team_roles: { team_id: string; role: TeamRole }[];
}

export interface Grant {
  id: string;
  user_id: string;
  program_id: string | null;
  team_id: string | null;
  domain: string;
  level: number;
}

export async function getDomains(): Promise<Domain[]> {
  const { data, error } = await db().from('permission_domains').select('domain, label').order('sort');
  if (error) throw error;
  return data ?? [];
}

export async function getClubPeople(clubId: string): Promise<ClubPerson[]> {
  const { data, error } = await db().rpc('club_people', { p_club: clubId });
  if (error) throw error;
  return (data ?? []) as ClubPerson[];
}

export async function getGrants(clubId: string): Promise<Grant[]> {
  const { data, error } = await db()
    .from('permission_grants')
    .select('id, user_id, program_id, team_id, domain, level')
    .eq('club_id', clubId);
  if (error) throw error;
  return data ?? [];
}

export async function setPermission(input: {
  clubId: string;
  userId: string;
  domain: string;
  level: number;
  programId?: string | null;
  teamId?: string | null;
}) {
  const { error } = await db().rpc('set_permission', {
    p_club: input.clubId,
    p_user: input.userId,
    p_domain: input.domain,
    p_level: input.level,
    p_program: input.programId ?? null,
    p_team: input.teamId ?? null,
  });
  if (error) throw error;
}

export async function setTeamRole(teamId: string, userId: string, role: TeamRole) {
  const { error } = await db().rpc('set_team_role', { p_team: teamId, p_user: userId, p_role: role });
  if (error) throw error;
}

export async function createClubInvite(input: {
  clubId: string;
  clubRole: 'admin' | 'staff';
  teamId?: string | null;
  teamRole?: StaffTeamRole | null;
  note?: string;
}): Promise<string> {
  const { data, error } = await db().rpc('create_club_invite', {
    p_club: input.clubId,
    p_club_role: input.clubRole,
    p_team: input.teamId ?? null,
    p_team_role: input.teamId ? input.teamRole ?? 'coach' : null,
    p_note: input.note ?? '',
  });
  if (error) throw error;
  return data as string;
}

export async function acceptClubInvite(code: string): Promise<string> {
  const { data, error } = await db().rpc('accept_club_invite', { p_code: code });
  if (error) throw error;
  return data as string;
}

export function staffInviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}#staff/${code}`;
}

/* ------------------------------------------------- sign-up (spec section 3) */

export interface CityClub {
  club_id: string;
  name: string;
  city: string;
  kind: ClubKind;
  status: ClubStatus;
  ifa_registered: boolean;
  teams: number;
  managed: boolean;
  my_status: 'staff' | 'pending' | null;
}

export interface SignupTeam {
  club_id: string;
  team_id: string;
  name: string;
  age_group: string;
  league: string;
  program_kind: ProgramKind | null;
  has_staff: boolean;
  from_ifa: boolean;
}

export type AccessKind = 'club_admin' | 'team_staff';

export interface AccessRequest {
  id: string;
  club_id: string;
  club_name: string;
  club_city: string;
  club_status: ClubStatus;
  managed: boolean;
  user_id: string;
  requester: string;
  kind: AccessKind;
  teams: { id: string; name: string }[];
  team_role: StaffTeamRole;
  role_title: string;
  message: string;
  contact_phone: string;
  created_at: string;
}

export interface MyAccessRequest {
  id: string;
  club_id: string;
  club_name: string;
  kind: AccessKind;
  teams: { id: string; name: string }[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_note: string;
  created_at: string;
}

export async function searchClubsByCity(city: string): Promise<CityClub[]> {
  const { data, error } = await db().rpc('search_clubs_by_city', { p_city: city });
  if (error) throw error;
  return (data ?? []) as CityClub[];
}

export async function signupClubTeams(clubIds: string[]): Promise<SignupTeam[]> {
  if (clubIds.length === 0) return [];
  const { data, error } = await db().rpc('signup_club_teams', { p_clubs: clubIds });
  if (error) throw error;
  return (data ?? []) as SignupTeam[];
}

export async function requestClubAccess(input: {
  clubIds: string[];
  teamIds: string[];
  kind: AccessKind;
  teamRole: StaffTeamRole;
  roleTitle: string;
  message: string;
  phone: string;
}): Promise<number> {
  const { data, error } = await db().rpc('request_club_access', {
    p_clubs: input.clubIds,
    p_teams: input.teamIds,
    p_kind: input.kind,
    p_team_role: input.teamRole,
    p_role_title: input.roleTitle,
    p_message: input.message,
    p_phone: input.phone,
  });
  if (error) throw error;
  return data as number;
}

export async function myClubAccessRequests(): Promise<MyAccessRequest[]> {
  const { data, error } = await db().rpc('my_club_access_requests');
  if (error) throw error;
  return (data ?? []) as MyAccessRequest[];
}

export async function cancelClubAccess(id: string) {
  const { error } = await db().rpc('cancel_club_access', { p_id: id });
  if (error) throw error;
}

export async function pendingClubAccessRequests(): Promise<AccessRequest[]> {
  const { data, error } = await db().rpc('pending_club_access_requests');
  if (error) throw error;
  return (data ?? []) as AccessRequest[];
}

export async function reviewClubAccess(id: string, approve: boolean, note = '') {
  const { error } = await db().rpc('review_club_access', { p_id: id, p_approve: approve, p_note: note });
  if (error) throw error;
}

export async function createClubManual(input: { name: string; city: string; kind: ClubKind; ifaRegistered: boolean }): Promise<string> {
  const { data, error } = await db().rpc('create_club_manual', {
    p_name: input.name,
    p_city: input.city,
    p_kind: input.kind,
    p_ifa_registered: input.ifaRegistered,
  });
  if (error) throw error;
  return data as string;
}

export interface IfaClubSuggestion {
  base_name: string;
  venue_hint: string | null;
  team_ids: string[];
  team_names: string[];
  existing_club: string | null;
}

export async function ifaClubSuggestions(): Promise<IfaClubSuggestion[]> {
  const { data, error } = await db().rpc('ifa_club_suggestions');
  if (error) throw error;
  return (data ?? []) as IfaClubSuggestion[];
}

/** Platform admin: put IFA teams into a club (clubId null = new catalog club with no owner). */
export async function catalogClubTeams(input: { clubId: string | null; name: string; city: string; teamIds: string[]; kind?: ClubKind }) {
  const { data, error } = await db().rpc('catalog_club_teams', {
    p_club: input.clubId,
    p_name: input.name,
    p_city: input.city,
    p_team_ids: input.teamIds,
    p_kind: input.kind ?? 'club',
  });
  if (error) throw error;
  return data as string;
}

/* ------------------------------------------------- roles (spec section 4) */

export interface ClubRoleDef {
  id: string;
  name: string;
  description: string;
  is_template: boolean;
  perms: Record<string, number>;
  holders: number;
  sensitive: boolean;
}

export interface RoleAssignment {
  id: string;
  role_id: string;
  role_name: string;
  user_id: string;
  full_name: string;
  program_id: string | null;
  team_id: string | null;
  scope_label: string;
}

export interface ClubAccess {
  is_admin: boolean;
  manage_roles: boolean;
  domains: Record<string, number | null>;
}

export async function myClubAccess(clubId: string): Promise<ClubAccess> {
  const { data, error } = await db().rpc('my_club_access', { p_club: clubId });
  if (error) throw error;
  return data as ClubAccess;
}

export async function listClubRoles(clubId: string): Promise<ClubRoleDef[]> {
  const { data, error } = await db().rpc('club_roles_list', { p_club: clubId });
  if (error) throw error;
  return (data ?? []) as ClubRoleDef[];
}

export async function listRoleAssignments(clubId: string): Promise<RoleAssignment[]> {
  const { data, error } = await db().rpc('club_role_assignment_list', { p_club: clubId });
  if (error) throw error;
  return (data ?? []) as RoleAssignment[];
}

export async function saveClubRole(input: { clubId: string; roleId: string | null; name: string; description: string; perms: Record<string, number> }) {
  const { data, error } = await db().rpc('save_club_role', {
    p_club: input.clubId,
    p_role: input.roleId,
    p_name: input.name,
    p_description: input.description,
    p_perms: input.perms,
  });
  if (error) throw error;
  return data as string;
}

export async function archiveClubRole(roleId: string) {
  const { error } = await db().rpc('archive_club_role', { p_role: roleId });
  if (error) throw error;
}

export async function assignClubRole(input: { clubId: string; roleId: string; userId: string; programId?: string | null; teamId?: string | null }) {
  const { error } = await db().rpc('assign_club_role', {
    p_club: input.clubId,
    p_role: input.roleId,
    p_user: input.userId,
    p_program: input.programId ?? null,
    p_team: input.teamId ?? null,
  });
  if (error) throw error;
}

export async function unassignClubRole(assignmentId: string) {
  const { error } = await db().rpc('unassign_club_role', { p_assignment: assignmentId });
  if (error) throw error;
}

export async function createRoleInvite(input: { clubId: string; roleId: string; programId?: string | null; teamId?: string | null }): Promise<string> {
  const { data, error } = await db().rpc('create_club_role_invite', {
    p_club: input.clubId,
    p_role: input.roleId,
    p_program: input.programId ?? null,
    p_team: input.teamId ?? null,
    p_note: '',
  });
  if (error) throw error;
  return data as string;
}

/* ------------------------------------- confidential coach notes (section 9) */

export type ProNoteKind = 'note' | 'improvement' | 'progress' | 'training_summary' | 'performance';

export const proNoteKindLabel: Record<ProNoteKind, string> = {
  note: 'הערה מקצועית',
  improvement: 'נקודה לשיפור',
  progress: 'הערכת התקדמות',
  training_summary: 'סיכום אימון',
  performance: 'ביצועים במשחק',
};

export interface ProNote {
  id: string;
  team_id: string | null;
  kind: ProNoteKind;
  body: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
  updated_at: string | null;
}

export async function proNotesLevel(clubId: string, playerId: string): Promise<number> {
  const { data, error } = await db().rpc('pro_notes_level', { p_club: clubId, p_player: playerId });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function listProNotes(clubId: string, playerId: string): Promise<ProNote[]> {
  const { data, error } = await db()
    .from('player_pro_notes')
    .select('id, team_id, kind, body, author_id, author_name, created_at, updated_at')
    .eq('club_id', clubId)
    .eq('player_id', playerId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProNote[];
}

export async function addProNote(input: { clubId: string; playerId: string; kind: ProNoteKind; body: string; teamId?: string | null }) {
  const { error } = await db().rpc('add_pro_note', {
    p_club: input.clubId,
    p_player: input.playerId,
    p_kind: input.kind,
    p_body: input.body,
    p_team: input.teamId ?? null,
  });
  if (error) throw error;
}

export async function updateProNote(id: string, kind: ProNoteKind, body: string) {
  const { error } = await db().rpc('update_pro_note', { p_id: id, p_kind: kind, p_body: body });
  if (error) throw error;
}

export async function archiveProNote(id: string) {
  const { error } = await db().rpc('archive_pro_note', { p_id: id });
  if (error) throw error;
}
