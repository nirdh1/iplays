/**
 * The bell: the signed-in user's notifications. They are the same rows as the
 * Web Push queue (notification_outbox, own rows only by RLS), so every push is
 * also in the bell and nothing is stored twice. Rows are written by the server
 * (IFA sync, team triggers); the app only reads them and marks them read.
 */
import { supabase } from './supabase';
import type { IconName } from '../components/Icon';

export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  created_at: string;
  read_at: string | null;
}

const LIMIT = 50;

export async function listInbox(): Promise<InboxItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('notification_outbox')
    .select('id, kind, title, body, url, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) {
    // before the inbox migration there is no read_at: show the list, nothing unread
    const old = await supabase.from('notification_outbox').select('id, kind, title, body, url, created_at').order('created_at', { ascending: false }).limit(LIMIT);
    return ((old.data ?? []) as Omit<InboxItem, 'read_at'>[]).map((n) => ({ ...n, read_at: n.created_at }));
  }
  return (data ?? []) as InboxItem[];
}

export async function unreadCount(): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase.from('notification_outbox').select('id', { count: 'exact', head: true }).is('read_at', null);
  return error ? 0 : (count ?? 0);
}

export async function markAllRead(): Promise<void> {
  await supabase?.rpc('mark_notifications_read', { p_ids: null });
}

export function inboxIcon(kind: string): IconName {
  switch (kind) {
    case 'match_change':
    case 'match_result':
      return 'ball';
    case 'training':
      return 'calendar';
    case 'announcement':
      return 'chat';
    case 'absence':
      return 'clock';
    case 'join_request':
    case 'join_decision':
      return 'user';
    case 'team_claim':
    case 'team_claim_decision':
      return 'whistle';
    case 'roster_review':
      return 'team';
    default:
      return 'bell';
  }
}

/** "עכשיו", "לפני 5 דק׳", "לפני 3 שעות", "אתמול", or a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  if (d === 1) return 'אתמול';
  if (d < 7) return `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}
