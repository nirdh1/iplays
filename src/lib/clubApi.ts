/**
 * Club management: clubs, programs (league / academy), the club's teams,
 * player assignments and transfers between programs.
 * Everything goes through RLS and the SECURITY DEFINER functions in
 * supabase/migrations/20261101200000_clubs_and_assignments.sql.
 */
import { supabase } from './supabase';

export type ClubStatus = 'draft' | 'pending_verification' | 'verified' | 'suspended';
export type ClubRole = 'owner' | 'admin' | 'staff';
export type ProgramKind = 'league' | 'academy';
export type TransferKind = 'move' | 'add' | 'end';

export interface Club {
  id: string;
  name: string;
  city: string;
  status: ClubStatus;
  role: ClubRole;
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
  return null;
}

export async function getMyClubs(userId: string): Promise<Club[]> {
  const { data, error } = await db()
    .from('club_staff')
    .select('role, clubs (id, name, city, status)')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const c = row.clubs as unknown as Omit<Club, 'role'> | null;
    return c ? [{ ...c, role: row.role as ClubRole }] : [];
  });
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
