/**
 * Typed data access for accounts, teams, invites and rosters.
 * Every call goes through Row Level Security (see supabase/migrations).
 */
import { supabase } from './supabase';

export type Sport = 'football' | 'basketball' | 'other';
export type Role = 'admin' | 'coach' | 'parent';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export interface Team {
  id: string;
  name: string;
  club: string;
  season: string;
  sport: Sport;
  league: string;
  ifa_team_id: string | null;
}

export interface MyTeam extends Team {
  role: Role;
}

export interface Player {
  id: string;
  team_id: string;
  first_name: string;
  last_name: string;
  shirt_number: number | null;
  position: string;
  birth_year: number | null;
  guardians: string[]; // user ids
}

export interface Member {
  user_id: string;
  role: Role;
  full_name: string;
}

export const sportLabel: Record<Sport, string> = { football: 'כדורגל', basketball: 'כדורסל', other: 'ענף אחר' };
export const roleLabel: Record<Role, string> = { admin: 'מנהל/ת קבוצה', coach: 'מאמן/ת', parent: 'הורה' };

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

/** Turn Postgres / Supabase errors into short Hebrew messages. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('invalid or expired invite')) return 'קוד ההזמנה לא תקין או שפג תוקפו. בקשו קוד חדש מהמאמן.';
  if (msg.includes('players_team_id_shirt_number_key')) return 'מספר החולצה הזה כבר תפוס בקבוצה.';
  if (msg.includes('join the team first')) return 'צריך להצטרף לקבוצה לפני הוספת ילד.';
  if (msg.includes('Token has expired') || msg.includes('otp_expired') || msg.includes('invalid')) return 'הקוד שגוי או שפג תוקפו. נסו לשלוח קוד חדש.';
  if (msg.includes('rate limit') || msg.includes('security purposes')) return 'נשלחו יותר מדי קודים. נסו שוב בעוד דקה.';
  if (msg.includes('not linked to the IFA')) return 'הקבוצה עדיין לא מחוברת לקבוצה בהתאחדות.';
  if (msg.includes('Failed to fetch')) return 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.';
  return 'משהו השתבש. נסו שוב.';
}

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await db().from('profiles').select('id, full_name, phone, email').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyName(userId: string, fullName: string) {
  const { error } = await db().from('profiles').update({ full_name: fullName.trim() }).eq('id', userId);
  if (error) throw error;
}

export async function getMyTeams(userId: string): Promise<MyTeam[]> {
  const { data, error } = await db()
    .from('team_members')
    .select('role, teams (id, name, club, season, sport, league, ifa_team_id)')
    .eq('user_id', userId)
    .order('joined_at');
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const t = row.teams as unknown as Team | null;
    return t ? [{ ...t, role: row.role as Role }] : [];
  });
}

export async function createTeam(input: { name: string; club: string; season: string; sport: Sport }) {
  const { data, error } = await db().rpc('create_team', {
    p_name: input.name,
    p_club: input.club,
    p_season: input.season,
    p_sport: input.sport,
  });
  if (error) throw error;
  const row = (data as { team_id: string; invite_code: string }[])[0];
  return { teamId: row.team_id, inviteCode: row.invite_code };
}

export async function joinTeam(code: string): Promise<string> {
  const { data, error } = await db().rpc('join_team', { p_code: code });
  if (error) throw error;
  return data as string;
}

export async function addMyChild(teamId: string, child: { first: string; last: string; number?: number | null; position?: string; birthYear?: number | null }) {
  const { data, error } = await db().rpc('add_my_child', {
    p_team: teamId,
    p_first: child.first,
    p_last: child.last,
    p_number: child.number ?? null,
    p_position: child.position ?? '',
    p_birth_year: child.birthYear ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function claimPlayer(playerId: string) {
  const { error } = await db().rpc('claim_player', { p_player: playerId });
  if (error) throw error;
}

export async function addPlayer(teamId: string, p: { first: string; last: string; number?: number | null; position?: string }) {
  const { error } = await db()
    .from('players')
    .insert({ team_id: teamId, first_name: p.first.trim(), last_name: p.last.trim(), shirt_number: p.number ?? null, position: p.position ?? '' });
  if (error) throw error;
}

export async function getRoster(teamId: string): Promise<Player[]> {
  const { data, error } = await db()
    .from('players')
    .select('id, team_id, first_name, last_name, shirt_number, position, birth_year, player_guardians (user_id)')
    .eq('team_id', teamId)
    .order('shirt_number', { nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    ...p,
    guardians: ((p.player_guardians as { user_id: string }[] | null) ?? []).map((g) => g.user_id),
  })) as Player[];
}

export async function getMembers(teamId: string): Promise<Member[]> {
  const { data: rows, error } = await db().from('team_members').select('user_id, role').eq('team_id', teamId);
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: profiles, error: e2 } = await db().from('profiles').select('id, full_name').in('id', ids);
  if (e2) throw e2;
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return (rows ?? []).map((r) => ({ user_id: r.user_id, role: r.role as Role, full_name: names.get(r.user_id) || 'ללא שם' }));
}

export async function getInviteCode(teamId: string): Promise<string | null> {
  const { data, error } = await db()
    .from('invites')
    .select('code, expires_at')
    .eq('team_id', teamId)
    .eq('role', 'parent')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.code ?? null;
}

export async function newInviteCode(teamId: string, role: 'parent' | 'coach' = 'parent'): Promise<string> {
  const { data, error } = await db().rpc('create_invite', { p_team: teamId, p_role: role });
  if (error) throw error;
  return data as string;
}

export function inviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}#join/${code}`;
}

// ------------------------------------------------------------ IFA public data
// Filled by the server sync job (supabase/functions/ifa-sync). Read-only here.

export interface IfaLeague {
  id: string;
  season: string;
  age_group: string;
  tier: string;
  district: string;
  name: string;
}

export interface IfaTeam {
  id: string;
  league_id: string | null;
  name: string;
  club: string;
}

export interface IfaMatch {
  id: string;
  league_id: string;
  round: number | null;
  kickoff: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_name: string;
  away_name: string;
  venue: string;
  venue_address: string;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'played' | 'postponed' | 'cancelled';
}

export interface IfaStanding {
  team_id: string;
  team_name: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

export async function getIfaLeagues(season?: string): Promise<IfaLeague[]> {
  let q = db().from('ifa_leagues').select('id, season, age_group, tier, district, name');
  if (season) q = q.eq('season', season);
  const { data, error } = await q.order('age_group').order('tier').order('district').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getIfaTeams(leagueId: string): Promise<IfaTeam[]> {
  const { data, error } = await db().from('ifa_teams').select('id, league_id, name, club').eq('league_id', leagueId).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getIfaTeam(id: string): Promise<IfaTeam | null> {
  const { data, error } = await db().from('ifa_teams').select('id, league_id, name, club').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function linkIfaTeam(teamId: string, ifaTeamId: string | null) {
  const { error } = await db().from('teams').update({ ifa_team_id: ifaTeamId }).eq('id', teamId);
  if (error) throw error;
}

export async function getIfaMatches(ifaTeamId: string): Promise<IfaMatch[]> {
  const { data, error } = await db()
    .from('ifa_matches')
    .select('id, league_id, round, kickoff, home_team_id, away_team_id, home_name, away_name, venue, venue_address, home_score, away_score, status')
    .or(`home_team_id.eq.${ifaTeamId},away_team_id.eq.${ifaTeamId}`)
    .order('kickoff', { nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as IfaMatch[];
}

export async function getIfaStandings(leagueId: string): Promise<IfaStanding[]> {
  const { data, error } = await db()
    .from('ifa_standings')
    .select('team_id, team_name, position, played, won, drawn, lost, goals_for, goals_against, points')
    .eq('league_id', leagueId)
    .order('position');
  if (error) throw error;
  return data ?? [];
}

export async function getIfaRosterCount(ifaTeamId: string): Promise<number> {
  const { count, error } = await db().from('ifa_players').select('player_id', { count: 'exact', head: true }).eq('team_id', ifaTeamId);
  if (error) throw error;
  return count ?? 0;
}

export async function importIfaRoster(teamId: string): Promise<number> {
  const { data, error } = await db().rpc('import_ifa_roster', { p_team: teamId });
  if (error) throw error;
  return data as number;
}
