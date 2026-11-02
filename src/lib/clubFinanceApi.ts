/**
 * Club finances (fee plans, charges, payments, reminders) and club activities
 * with registration (camps, clinics, workshops).
 * RLS and RPCs: supabase/migrations/20261102100000_club_finance_and_activities.sql.
 * No card data is ever stored: a future payment provider keeps only its name
 * and transaction id on club_payments.
 */
import { supabase } from './supabase';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}
const num = (x: unknown) => (x == null ? 0 : Number(x));

/* ---------------------------------------------------------------- types */

export type PlanKind = 'membership' | 'monthly' | 'periodic' | 'one_time';
export type ChargeState = 'open' | 'overdue' | 'partial' | 'paid' | 'waived' | 'cancelled';
export type ClubPayMethod = 'cash' | 'transfer' | 'bit' | 'paybox' | 'check' | 'card_external' | 'provider' | 'other';
export type ClubPayStatus = 'reported' | 'confirmed' | 'rejected' | 'refunded';
export type ActivityKind = 'summer_camp' | 'day_camp' | 'gk_camp' | 'special_training' | 'workshop' | 'other';
export type ActivityStatus = 'draft' | 'open' | 'closed' | 'cancelled';
export type RegStatus = 'registered' | 'waitlist' | 'cancelled';

export const planKindLabel: Record<PlanKind, string> = {
  membership: 'דמי חבר לעונה',
  monthly: 'תשלום חודשי',
  periodic: 'תשלום תקופתי',
  one_time: 'תשלום חד־פעמי',
};
export const chargeStateLabel: Record<ChargeState, string> = {
  open: 'פתוח',
  overdue: 'באיחור',
  partial: 'שולם חלקית',
  paid: 'שולם',
  waived: 'פטור',
  cancelled: 'בוטל',
};
export const clubMethodLabel: Record<ClubPayMethod, string> = {
  cash: 'מזומן',
  transfer: 'העברה בנקאית',
  bit: 'ביט',
  paybox: 'פייבוקס',
  check: 'צ׳ק',
  card_external: 'אשראי (מחוץ לאפליקציה)',
  provider: 'ספק סליקה',
  other: 'אחר',
};
export const activityKindLabel: Record<ActivityKind, string> = {
  summer_camp: 'מחנה קיץ',
  day_camp: 'קייטנת כדורגל',
  gk_camp: 'מחנה שוערים',
  special_training: 'אימון מיוחד',
  workshop: 'סדנה',
  other: 'פעילות אחרת',
};
export const activityStatusLabel: Record<ActivityStatus, string> = {
  draft: 'טיוטה',
  open: 'ההרשמה פתוחה',
  closed: 'ההרשמה סגורה',
  cancelled: 'בוטלה',
};
export const regStatusLabel: Record<RegStatus, string> = {
  registered: 'רשום/ה',
  waitlist: 'ברשימת המתנה',
  cancelled: 'בוטל',
};

export interface FeePlan {
  id: string;
  club_id: string;
  program_id: string | null;
  team_id: string | null;
  title: string;
  kind: PlanKind;
  amount: number;
  installments: number;
  interval_months: number;
  first_due_on: string;
  season: string;
  notes: string;
  archived_at: string | null;
}

export interface Charge {
  id: string;
  club_id: string;
  player_id: string;
  team_id: string | null;
  plan_id: string | null;
  activity_id: string | null;
  installment_no: number | null;
  title: string;
  amount: number;
  due_on: string;
  status: 'open' | 'waived' | 'cancelled';
  paid: number;
  reported: number;
  balance: number;
  state: ChargeState;
}

export interface ClubPayment {
  id: string;
  charge_id: string;
  player_id: string;
  amount: number;
  method: ClubPayMethod;
  status: ClubPayStatus;
  paid_on: string;
  note: string;
  created_at: string;
}

export interface Person {
  player_id: string;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  parents: string;
}

export interface Activity {
  id: string;
  club_id: string;
  kind: ActivityKind;
  title: string;
  description: string;
  starts_on: string;
  ends_on: string;
  daily_hours: string;
  location: string;
  birth_year_min: number | null;
  birth_year_max: number | null;
  capacity: number | null;
  price: number;
  status: ActivityStatus;
  registration_closes_on: string | null;
  visibility: 'public' | 'club';
  clubs?: { name: string; city: string } | null;
}

export interface Registration {
  id: string;
  activity_id: string;
  player_id: string;
  status: RegStatus;
  note: string;
  charge_id: string | null;
  created_at: string;
}

export interface Counts {
  registered: number;
  waitlist: number;
  club_name: string;
}

/* ------------------------------------------------------- club (staff) */

export interface ClubFinance {
  plans: FeePlan[];
  charges: Charge[];
  payments: ClubPayment[];
  people: Map<string, Person>;
  lastReminder: Map<string, string>;
}

const fixCharge = (c: Charge): Charge => ({ ...c, amount: num(c.amount), paid: num(c.paid), reported: num(c.reported), balance: num(c.balance) });
const fixPayment = (p: ClubPayment): ClubPayment => ({ ...p, amount: num(p.amount) });

export async function canClubFinance(clubId: string, level = 1): Promise<boolean> {
  const { data, error } = await db().rpc('can_club_finance', { p_club: clubId, p_team: null, p_level: level });
  if (error) throw error;
  return !!data;
}

export async function canClubActivities(clubId: string, level = 1): Promise<boolean> {
  const { data, error } = await db().rpc('can_club_activities', { p_club: clubId, p_level: level });
  if (error) throw error;
  return !!data;
}

export async function clubPeople(clubId: string, ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await db().rpc('club_finance_people', { p_club: clubId, p_players: unique });
  if (error) throw error;
  return new Map(((data ?? []) as Person[]).map((p) => [p.player_id, p]));
}

export async function loadClubFinance(clubId: string): Promise<ClubFinance> {
  const [plans, charges, payments, reminders] = await Promise.all([
    db().from('club_fee_plans').select('*').eq('club_id', clubId).is('archived_at', null).order('created_at', { ascending: false }),
    db().from('club_charge_balances').select('*').eq('club_id', clubId).order('due_on'),
    db().from('club_payments').select('id, charge_id, player_id, amount, method, status, paid_on, note, created_at').eq('club_id', clubId).order('created_at', { ascending: false }),
    db().from('club_reminders').select('charge_id, sent_at').eq('club_id', clubId).order('sent_at', { ascending: false }),
  ]);
  for (const r of [plans, charges, payments, reminders]) if (r.error) throw r.error;
  const ch = ((charges.data ?? []) as Charge[]).map(fixCharge);
  const lastReminder = new Map<string, string>();
  for (const r of reminders.data ?? []) if (!lastReminder.has(r.charge_id)) lastReminder.set(r.charge_id, r.sent_at);
  return {
    plans: ((plans.data ?? []) as FeePlan[]).map((p) => ({ ...p, amount: num(p.amount) })),
    charges: ch,
    payments: ((payments.data ?? []) as ClubPayment[]).map(fixPayment),
    people: await clubPeople(clubId, ch.map((c) => c.player_id)),
    lastReminder,
  };
}

export type PlanInput = Omit<FeePlan, 'id' | 'club_id' | 'archived_at'>;

export async function createPlan(clubId: string, userId: string, p: PlanInput): Promise<string> {
  const { data, error } = await db().from('club_fee_plans').insert({ ...p, club_id: clubId, created_by: userId }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function archivePlan(id: string) {
  const { error } = await db().from('club_fee_plans').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function assignPlan(planId: string, players?: string[]): Promise<number> {
  const { data, error } = await db().rpc('assign_fee_plan', { p_plan: planId, p_players: players ?? null });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function addCharge(clubId: string, c: { player: string; title: string; amount: number; due: string; team: string | null }) {
  const { error } = await db().rpc('add_club_charge', { p_club: clubId, p_player: c.player, p_title: c.title, p_amount: c.amount, p_due: c.due, p_team: c.team });
  if (error) throw error;
}

export async function setChargeStatus(id: string, status: 'open' | 'waived' | 'cancelled') {
  const { error } = await db().rpc('set_charge_status', { p_charge: id, p_status: status });
  if (error) throw error;
}

export async function recordPayment(chargeId: string, amount: number, method: ClubPayMethod, paidOn: string, note: string) {
  const { error } = await db().rpc('record_club_payment', { p_charge: chargeId, p_amount: amount, p_method: method, p_paid_on: paidOn, p_note: note });
  if (error) throw error;
}

export async function reviewPayment(id: string, status: 'confirmed' | 'rejected' | 'refunded') {
  const { error } = await db().rpc('review_club_payment', { p_payment: id, p_status: status });
  if (error) throw error;
}

export async function sendReminders(clubId: string, chargeIds?: string[]): Promise<number> {
  const { data, error } = await db().rpc('send_payment_reminders', { p_club: clubId, p_charges: chargeIds ?? null });
  if (error) throw error;
  return Number(data ?? 0);
}

/* ------------------------------------------------- activities (staff) */

export async function loadClubActivities(clubId: string) {
  const a = await db().from('club_activities').select('*').eq('club_id', clubId).order('starts_on', { ascending: false });
  if (a.error) throw a.error;
  const acts = ((a.data ?? []) as Activity[]).map((x) => ({ ...x, price: num(x.price) }));
  const ids = acts.map((x) => x.id);
  let regs: Registration[] = [];
  if (ids.length) {
    const r = await db().from('activity_registrations').select('id, activity_id, player_id, status, note, charge_id, created_at').in('activity_id', ids).order('created_at');
    if (r.error) throw r.error;
    regs = (r.data ?? []) as Registration[];
  }
  return { activities: acts, registrations: regs, people: await clubPeople(clubId, regs.map((r) => r.player_id)) };
}

export type ActivityInput = Omit<Activity, 'id' | 'club_id' | 'clubs'>;

export async function saveActivity(clubId: string, userId: string, a: ActivityInput, id?: string) {
  const q = id
    ? db().from('club_activities').update(a).eq('id', id)
    : db().from('club_activities').insert({ ...a, club_id: clubId, created_by: userId });
  const { error } = await q;
  if (error) throw error;
}

export async function cancelRegistration(id: string) {
  const { error } = await db().rpc('cancel_registration', { p_reg: id });
  if (error) throw error;
}

/* ---------------------------------------------------------- parent side */

export async function loadMyPayments(playerIds: string[]) {
  if (!playerIds.length) return { charges: [] as (Charge & { club_name: string })[], payments: [] as ClubPayment[] };
  const [c, p] = await Promise.all([
    db().from('club_charge_balances').select('*').in('player_id', playerIds).order('due_on'),
    db().from('club_payments').select('id, charge_id, player_id, amount, method, status, paid_on, note, created_at').in('player_id', playerIds).order('created_at', { ascending: false }),
  ]);
  if (c.error) throw c.error;
  if (p.error) throw p.error;
  const charges = ((c.data ?? []) as Charge[]).map(fixCharge);
  const clubIds = [...new Set(charges.map((x) => x.club_id))];
  const names = new Map<string, string>();
  if (clubIds.length) {
    const cl = await db().from('clubs').select('id, name').in('id', clubIds);
    for (const x of cl.data ?? []) names.set(x.id, x.name);
  }
  return {
    charges: charges.map((x) => ({ ...x, club_name: names.get(x.club_id) ?? '' })),
    payments: ((p.data ?? []) as ClubPayment[]).map(fixPayment),
  };
}

export async function reportPayment(chargeId: string, method: ClubPayMethod, note: string) {
  const { error } = await db().rpc('report_club_payment', { p_charge: chargeId, p_method: method, p_note: note });
  if (error) throw error;
}

/** Open activities a parent can see (public ones and their clubs' ones). */
export async function loadOpenActivities() {
  const today = new Date().toISOString().slice(0, 10);
  const a = await db().from('club_activities').select('*').in('status', ['open', 'closed']).gte('ends_on', today).order('starts_on');
  if (a.error) throw a.error;
  const acts = ((a.data ?? []) as Activity[]).map((x) => ({ ...x, price: num(x.price) }));
  return { activities: acts, counts: await activityCounts(acts.map((x) => x.id)) };
}

export async function activityCounts(ids: string[]): Promise<Map<string, Counts>> {
  if (!ids.length) return new Map();
  const { data, error } = await db().rpc('activity_counts', { p_activities: ids });
  if (error) throw error;
  return new Map(((data ?? []) as (Counts & { activity_id: string })[]).map((r) => [r.activity_id, { registered: r.registered, waitlist: r.waitlist, club_name: r.club_name }]));
}

export async function myRegistrations(playerIds: string[]): Promise<Registration[]> {
  if (!playerIds.length) return [];
  const { data, error } = await db().from('activity_registrations').select('id, activity_id, player_id, status, note, charge_id, created_at').in('player_id', playerIds).neq('status', 'cancelled');
  if (error) throw error;
  return (data ?? []) as Registration[];
}

export async function register(activityId: string, playerId: string, note: string): Promise<RegStatus> {
  const { data, error } = await db().rpc('register_for_activity', { p_activity: activityId, p_player: playerId, p_note: note });
  if (error) throw error;
  return data as RegStatus;
}

/* --------------------------------------------------------------- helpers */

export function clubFinanceError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes('not_allowed') || msg.includes('row-level security')) return 'אין לך הרשאה לפעולה הזו.';
  if (/Could not find the (table|function)|does not exist|PGRST202|PGRST205|42P01/.test(msg)) return 'מודול הכספים והמחנות עוד לא הופעל בשרת. צריך להריץ את קובץ ה-SQL שלו ב-Supabase.';
  if (msg.includes('registration_closed')) return 'ההרשמה לפעילות הזו סגורה.';
  if (msg.includes('wrong_age')) return 'הפעילות לא מיועדת לשנתון של הילד.';
  if (msg.includes('already_registered')) return 'הילד כבר רשום לפעילות הזו.';
  if (msg.includes('not_your_child')) return 'אפשר לפעול רק עבור הילדים שלך.';
  if (msg.includes('not_in_club')) return 'הילד לא משויך למועדון.';
  if (msg.includes('charge_closed')) return 'החיוב הזה כבר סגור.';
  if (msg.includes('nothing_to_pay')) return 'אין יתרה לתשלום בחיוב הזה.';
  return null;
}

export const ils = (n: number) => `₪${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
export const dmy = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
export const personName = (p?: Person) => (p ? `${p.first_name} ${p.last_name}`.trim() : 'ילד/ה');

/** CSV for the treasurer (Excel opens it; BOM keeps Hebrew readable). */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
