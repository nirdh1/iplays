/**
 * Team contacts directory ("אלפון הקבוצה") and a child's "אנשי קשר".
 * Server side: supabase/migrations/20261103500000_team_contacts.sql
 *
 * The server decides what each viewer gets: a detail a family did not share
 * comes back as null (it never reaches the app). Managers (team admin /
 * coach / team manager, club owner / admin, platform admin) get everything.
 * Nothing is sent from iplays: the buttons open the phone's own dialer,
 * WhatsApp, mail app, Waze or Google Maps.
 */
import { supabase } from './supabase';
import { isMissing } from './coachApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export type ShareField = 'phone' | 'whatsapp' | 'email' | 'address';
export type Sharing = Record<ShareField, boolean>;

export interface Address {
  street: string;
  house_number: string;
  city: string;
}

export interface ContactPerson {
  kind: 'parent' | 'family' | 'extra';
  /** app user (parent / family member); null for an extra contact */
  user_id: string | null;
  /** extra contact id */
  id: string | null;
  name: string;
  kinship: string;
  is_me: boolean;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: Address | null;
  /** own switches (or, for the child's family, an extra contact's switches) */
  sharing: Partial<Sharing> | null;
}

export interface DirectoryPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  shirt_number: number | null;
  mine: boolean;
  phone: string | null;
  contacts: ContactPerson[];
}

export interface TeamDirectory {
  full_access: boolean;
  players: DirectoryPlayer[];
  without_family: number;
}

export interface ContactBook {
  player_id: string;
  full_access: boolean;
  mine: boolean;
  can_edit: boolean;
  phone: string;
  share_phone: boolean | null;
  contacts: ContactPerson[];
}

export interface MyCard {
  full_name: string;
  phone: string;
  login_email: string;
  whatsapp_phone: string;
  contact_email: string;
  street: string;
  house_number: string;
  city: string;
  sharing: Sharing;
}

export const SHARE_LABELS: { key: ShareField; label: string }[] = [
  { key: 'phone', label: 'מספר טלפון' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'דוא״ל' },
  { key: 'address', label: 'כתובת מגורים' },
];

/** Hebrew message for a server error, or null to fall back to the generic one. */
export function contactsError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? '';
  if (isMissing(e)) return 'האלפון מחכה לעדכון מסד הנתונים (iplays-team-contacts.sql).';
  if (msg.includes('not allowed')) return 'אין לך הרשאה לפעולה הזו.';
  if (msg.includes('bad phone')) return 'מספר הטלפון לא תקין. ספרות בלבד, אפשר עם + בהתחלה.';
  if (msg.includes('bad email')) return 'כתובת הדוא״ל לא תקינה.';
  if (msg.includes('name required')) return 'צריך למלא שם.';
  if (msg.includes('too long')) return 'אחד השדות ארוך מדי.';
  return null;
}

export async function teamDirectory(teamId: string): Promise<TeamDirectory> {
  const { data, error } = await db().rpc('team_directory', { p_team: teamId });
  if (error) throw error;
  return data as TeamDirectory;
}

/** null: not this child's family nor a manager (the area is not shown). */
export async function playerContactBook(playerId: string): Promise<ContactBook | null> {
  const { data, error } = await db().rpc('player_contact_book', { p_player: playerId });
  if (error) throw error;
  return (data as ContactBook | null) ?? null;
}

export async function myContactCard(): Promise<MyCard | null> {
  const { data, error } = await db().rpc('my_contact_card');
  if (error) throw error;
  return (data as MyCard | null) ?? null;
}

export async function saveMyContactCard(c: Pick<MyCard, 'full_name' | 'phone' | 'whatsapp_phone' | 'contact_email' | 'street' | 'house_number' | 'city'>) {
  const { error } = await db().rpc('save_my_contact_card', {
    p_full_name: c.full_name,
    p_phone: c.phone,
    p_whatsapp: c.whatsapp_phone,
    p_email: c.contact_email,
    p_street: c.street,
    p_house: c.house_number,
    p_city: c.city,
  });
  if (error) throw error;
}

export async function setMyShare(field: ShareField, on: boolean) {
  const { error } = await db().rpc('set_my_contact_share', { p_field: field, p_on: on });
  if (error) throw error;
}

export async function savePlayerPhone(playerId: string, phone: string) {
  const { error } = await db().rpc('save_player_phone', { p_player: playerId, p_phone: phone });
  if (error) throw error;
}

export async function setPlayerPhoneShare(playerId: string, on: boolean) {
  const { error } = await db().rpc('set_player_phone_share', { p_player: playerId, p_on: on });
  if (error) throw error;
}

export interface ExtraInput {
  id: string | null;
  name: string;
  kinship: string;
  phone: string;
  email: string;
  share_phone: boolean;
  share_whatsapp: boolean;
  share_email: boolean;
}

export async function saveExtraContact(playerId: string, x: ExtraInput): Promise<string> {
  const { data, error } = await db().rpc('save_extra_contact', {
    p_id: x.id,
    p_player: playerId,
    p_name: x.name,
    p_kinship: x.kinship,
    p_phone: x.phone,
    p_email: x.email,
    p_share_phone: x.share_phone,
    p_share_whatsapp: x.share_whatsapp,
    p_share_email: x.share_email,
  });
  if (error) throw error;
  return data as string;
}

export async function removeExtraContact(id: string) {
  const { error } = await db().rpc('remove_extra_contact', { p_id: id });
  if (error) throw error;
}

/* ------------------------------------------------------------ links */

/** Same rule as the server: digits, optional leading +, spaces / dashes inside. */
export const phoneOk = (p: string) => p.trim() === '' || /^\+?[0-9][0-9 -]{5,18}[0-9]$/.test(p.trim());
export const emailOk = (e: string) => e.trim() === '' || /^[^@\s<>"'(),;:\\]+@[^@\s<>"'(),;:\\]+\.[^@\s<>"'(),;:\\]+$/.test(e.trim());

/** tel: link: + and digits only. */
export function telHref(phone: string): string {
  const p = phone.trim();
  return `tel:${p.startsWith('+') ? '+' : ''}${p.replace(/\D/g, '')}`;
}

/** International digits for WhatsApp: Israeli 05x-... becomes 9725x... */
export function waDigits(phone: string): string {
  const p = phone.trim();
  const digits = p.replace(/\D/g, '');
  if (p.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

/** Opens a chat with the number, without saving it as a contact. */
export const waHref = (phone: string) => `https://wa.me/${waDigits(phone)}`;

export const mailHref = (email: string) => `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, '@')}`;

export function addressText(a: Address): string {
  return [[a.street, a.house_number].filter(Boolean).join(' '), a.city].filter(Boolean).join(', ');
}

export const wazeHref = (a: Address) => `https://waze.com/ul?q=${encodeURIComponent(addressText(a))}&navigate=yes`;
export const mapsHref = (a: Address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText(a))}`;

/** "אמא" / "הורה" / the kinship of a family member. */
export function personRole(c: ContactPerson): string {
  if (c.kinship) return c.kinship;
  return c.kind === 'parent' ? 'הורה' : c.kind === 'family' ? 'בן/בת משפחה' : 'איש/אשת קשר';
}

/** Lower-case, no niqqud / punctuation: for the search box. */
export const searchKey = (s: string) => s.toLocaleLowerCase('he').replace(/[֑-ׇ'"׳״.\-]/g, '').trim();
