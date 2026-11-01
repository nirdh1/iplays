/**
 * Family members of a child (parents, grandparents, ...), their permissions
 * and one-time family invite links.
 * Server side: supabase/migrations/20261101970000_family_members.sql
 */
import { supabase } from './supabase';
import type { Relation } from './joinApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export interface FamilyMember {
  player_id: string;
  child_name: string;
  user_id: string;
  member_name: string;
  relation: Relation;
  kinship: string;
  can_report: boolean;
  can_rides: boolean;
  can_pay: boolean;
  is_me: boolean;
  since: string;
}

export interface FamilyPerms {
  report: boolean;
  rides: boolean;
  pay: boolean;
}

export interface FamilyInvite {
  id: string;
  code: string;
  player_ids: string[];
  relation: Relation;
  kinship: string;
  can_report: boolean;
  can_rides: boolean;
  can_pay: boolean;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export interface FamilyInviteInfo {
  inviter: string;
  relation: Relation;
  kinship: string;
  children: string[];
  can_report: boolean;
  can_rides: boolean;
  can_pay: boolean;
  status: 'valid' | 'accepted' | 'used' | 'expired' | 'revoked';
}

/** Suggested labels; any short text is allowed. */
export const KINSHIPS = ['אמא', 'אבא', 'סבתא', 'סבא', 'דודה', 'דוד', 'אחות', 'אח', 'בייביסיטר'];
export const PARENT_KINSHIPS = ['אמא', 'אבא', 'אפוטרופוס/ית'];

export const PERM_LABELS: { key: keyof FamilyPerms; label: string; hint: string }[] = [
  { key: 'report', label: 'דיווח היעדרות', hint: 'מדווח/ת שהילד לא מגיע לאימון או למשחק' },
  { key: 'rides', label: 'הסעות', hint: 'משתתף/ת בהסעות של הילד' },
  { key: 'pay', label: 'תשלומים', hint: 'משלם/ת תשלומי קבוצה עבור הילד' },
];

export function permsSummary(m: { relation: Relation; can_report: boolean; can_rides: boolean; can_pay: boolean }): string {
  if (m.relation === 'parent') return 'הורה · כל ההרשאות';
  const on = [m.can_report && 'היעדרויות', m.can_rides && 'הסעות', m.can_pay && 'תשלומים'].filter(Boolean);
  return on.length ? `צפייה, ${on.join(', ')}` : 'צפייה בלבד · הילד, הלו"ז והמשחקים';
}

export async function myFamily(): Promise<FamilyMember[]> {
  const { data, error } = await db().rpc('my_family');
  if (error) throw error;
  return (data ?? []) as FamilyMember[];
}

export async function updateFamilyMember(playerId: string, userId: string, kinship: string | null, perms?: Partial<FamilyPerms>) {
  const { error } = await db().rpc('update_family_member', {
    p_player: playerId,
    p_user: userId,
    p_kinship: kinship,
    p_report: perms?.report ?? null,
    p_rides: perms?.rides ?? null,
    p_pay: perms?.pay ?? null,
  });
  if (error) throw error;
}

export async function removeFamilyMember(playerId: string, userId: string) {
  const { error } = await db().rpc('remove_family_member', { p_player: playerId, p_user: userId });
  if (error) throw error;
}

/** Leave a child's family (any member, parents included). */
export async function leaveChild(playerId: string, userId: string) {
  const { error } = await db().from('player_guardians').delete().eq('player_id', playerId).eq('user_id', userId);
  if (error) throw error;
}

export async function createFamilyInvite(playerIds: string[], relation: Relation, kinship: string, perms: FamilyPerms): Promise<string> {
  const { data, error } = await db().rpc('create_family_invite', {
    p_players: playerIds,
    p_relation: relation,
    p_kinship: kinship,
    p_report: perms.report,
    p_rides: perms.rides,
    p_pay: perms.pay,
  });
  if (error) throw error;
  return data as string;
}

export async function myFamilyInvites(): Promise<FamilyInvite[]> {
  const { data, error } = await db()
    .from('family_invites')
    .select('id, code, player_ids, relation, kinship, can_report, can_rides, can_pay, expires_at, used_at, revoked_at')
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FamilyInvite[];
}

export async function revokeFamilyInvite(id: string) {
  const { error } = await db().rpc('revoke_family_invite', { p_id: id });
  if (error) throw error;
}

export async function familyInviteInfo(code: string): Promise<FamilyInviteInfo | null> {
  const { data, error } = await db().rpc('family_invite_info', { p_code: code });
  if (error) throw error;
  return ((data ?? []) as FamilyInviteInfo[])[0] ?? null;
}

export async function acceptFamilyInvite(code: string): Promise<string[]> {
  const { data, error } = await db().rpc('accept_family_invite', { p_code: code });
  if (error) throw error;
  return (data ?? []) as string[];
}

export function familyInviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}#fam/${code}`;
}

/** Hebrew messages for the errors these functions raise (null = use the generic one). */
export function familyError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('only the child')) return 'רק הורה של הילד יכול לעשות את זה.';
  if (msg.includes('a parent can')) return 'אי אפשר להסיר הורה. כל הורה יכול לעזוב בעצמו.';
  if (msg.includes('choose at least one child')) return 'צריך לבחור לפחות ילד אחד.';
  if (msg.includes('too many invites')) return 'יצרת היום יותר מדי הזמנות. נסו שוב מחר.';
  if (msg.includes('invite already used')) return 'מישהו אחר כבר השתמש בהזמנה הזו. בקשו מההורה הזמנה חדשה.';
  if (msg.includes('invite not found or expired')) return 'ההזמנה לא בתוקף (פג תוקפה או בוטלה). בקשו מההורה הזמנה חדשה.';
  if (msg.includes('this is your own invite')) return 'זו הזמנה שיצרת בעצמך. שלחו אותה לבן המשפחה.';
  if (msg.includes('family member not found')) return 'בן המשפחה כבר לא מחובר לילד.';
  return null;
}
