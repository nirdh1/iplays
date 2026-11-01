/**
 * Team fund: collections (גביות), each family's payment status, expenses and
 * treasurers. RLS and RPCs: supabase/migrations/20261101970000_team_fund.sql.
 * Money never moves through iplays; parents pay by the link the treasurer
 * gave and the app tracks who paid.
 */
import { supabase } from './supabase';

export type PayMethod = 'bit' | 'paybox' | 'transfer' | 'cash' | 'other';
export type PayStatus = 'reported' | 'confirmed' | 'rejected' | 'exempt';
export type CollectionStatus = 'open' | 'closed' | 'cancelled';

export const methodLabel: Record<PayMethod, string> = {
  bit: 'ביט',
  paybox: 'פייבוקס',
  transfer: 'העברה בנקאית',
  cash: 'מזומן',
  other: 'אחר',
};

export const statusLabel: Record<PayStatus, string> = {
  reported: 'ממתין לאישור',
  confirmed: 'שולם',
  rejected: 'לא נמצא תשלום',
  exempt: 'פטור',
};

export interface Collection {
  id: string;
  team_id: string;
  title: string;
  details: string;
  amount_per_child: number;
  goal: number | null;
  due_on: string | null;
  pay_link: string;
  status: CollectionStatus;
  created_at: string;
}

export interface Payment {
  id: string;
  collection_id: string;
  player_id: string;
  amount: number;
  method: PayMethod;
  status: PayStatus;
  note: string;
  reported_at: string | null;
}

export interface Expense {
  id: string;
  collection_id: string | null;
  title: string;
  amount: number;
  spent_on: string;
}

export interface Summary {
  collection_id: string;
  children: number;
  paid: number;
  reported: number;
  raised: number;
  spent: number;
}

export interface FundData {
  collections: Collection[];
  payments: Payment[]; // my children only, or everyone's for a fund manager
  expenses: Expense[];
  summary: Map<string, Summary>;
  treasurers: string[]; // user ids
  canManage: boolean;
  hasManager: boolean;
}

export interface CollectionInput {
  title: string;
  details: string;
  amount_per_child: number;
  goal: number | null;
  due_on: string | null;
  pay_link: string;
}

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

const num = (x: unknown) => (x == null ? 0 : Number(x));

export async function loadFund(teamId: string): Promise<FundData> {
  const [cols, exps, sum, trs, can, has] = await Promise.all([
    db().from('fund_collections').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
    db().from('fund_expenses').select('id, collection_id, title, amount, spent_on').eq('team_id', teamId).order('spent_on', { ascending: false }),
    db().rpc('fund_summary', { p_team: teamId }),
    db().from('fund_treasurers').select('user_id').eq('team_id', teamId),
    db().rpc('can_manage_fund', { p_team: teamId }),
    db().rpc('team_has_fund_manager', { p_team: teamId }),
  ]);
  for (const r of [cols, exps, sum, trs, can, has]) if (r.error) throw r.error;
  const collections = ((cols.data ?? []) as Collection[]).map((c) => ({ ...c, amount_per_child: num(c.amount_per_child), goal: c.goal == null ? null : num(c.goal) }));
  const ids = collections.map((c) => c.id);
  let payments: Payment[] = [];
  if (ids.length) {
    const p = await db().from('fund_payments').select('id, collection_id, player_id, amount, method, status, note, reported_at').in('collection_id', ids);
    if (p.error) throw p.error;
    payments = ((p.data ?? []) as Payment[]).map((x) => ({ ...x, amount: num(x.amount) }));
  }
  const summary = new Map<string, Summary>(
    ((sum.data ?? []) as Summary[]).map((s) => [s.collection_id, { ...s, raised: num(s.raised), spent: num(s.spent) }]),
  );
  return {
    collections,
    payments,
    expenses: ((exps.data ?? []) as Expense[]).map((e) => ({ ...e, amount: num(e.amount) })),
    summary,
    treasurers: (trs.data ?? []).map((t) => t.user_id as string),
    canManage: !!can.data,
    hasManager: !!has.data,
  };
}

export async function createCollection(teamId: string, userId: string, c: CollectionInput) {
  const { error } = await db().from('fund_collections').insert({ team_id: teamId, created_by: userId, ...c });
  if (error) throw error;
}

export async function setCollectionStatus(id: string, status: CollectionStatus) {
  const { error } = await db()
    .from('fund_collections')
    .update({ status, closed_at: status === 'open' ? null : new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function reportPayment(collectionId: string, playerId: string, method: PayMethod, note: string) {
  const { error } = await db().rpc('report_payment', { p_collection: collectionId, p_player: playerId, p_method: method, p_note: note });
  if (error) throw error;
}

export async function setPaymentStatus(collectionId: string, playerId: string, status: Exclude<PayStatus, 'reported'>, method?: PayMethod) {
  const { error } = await db().rpc('set_payment_status', {
    p_collection: collectionId,
    p_player: playerId,
    p_status: status,
    p_method: method ?? null,
    p_amount: null,
  });
  if (error) throw error;
}

export async function addExpense(teamId: string, userId: string, e: { title: string; amount: number; spent_on: string; collection_id: string | null }) {
  const { error } = await db().from('fund_expenses').insert({ team_id: teamId, created_by: userId, ...e });
  if (error) throw error;
}

export async function deleteExpense(id: string) {
  const { error } = await db().from('fund_expenses').delete().eq('id', id);
  if (error) throw error;
}

export async function appointTreasurer(teamId: string, userId?: string) {
  const { error } = await db().rpc('appoint_treasurer', { p_team: teamId, p_user: userId ?? null });
  if (error) throw error;
}

export async function removeTreasurer(teamId: string, userId: string) {
  const { error } = await db().rpc('remove_treasurer', { p_team: teamId, p_user: userId });
  if (error) throw error;
}

export function fundError(e: unknown): string | null {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/fund_collections|fund_summary|can_manage_fund|PGRST202|PGRST205|42P01/.test(msg)) return 'הקופה עוד לא הופעלה בשרת. צריך להריץ את קובץ ה-SQL של הקופה ב-Supabase.';
  if (msg.includes('collection_closed')) return 'הגבייה הזו כבר נסגרה.';
  if (msg.includes('not_your_child')) return 'אפשר לדווח תשלום רק על הילדים שלך.';
  if (msg.includes('not_in_team')) return 'הילד לא בסגל הקבוצה.';
  if (msg.includes('not_a_member')) return 'רק חברי הקבוצה יכולים להיות גזברים.';
  if (msg.includes('not_allowed') || msg.includes('row-level security')) return 'אין לך הרשאה לפעולה הזו.';
  return null;
}

export const shekel = (n: number) => `₪${n.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

/** What a collection aims to raise: its goal, or amount × children in the team. */
export const collectionTarget = (c: Collection, s?: Summary) => c.goal ?? c.amount_per_child * (s?.children ?? 0);
