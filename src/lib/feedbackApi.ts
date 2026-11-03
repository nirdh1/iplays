/**
 * "צור קשר / דיווח על תקלה / הצעת ייעול": messages from users to the platform
 * admins. Server side: supabase/migrations/20261103600000_app_feedback.sql
 * Nothing is emailed: admins get a bell notification and answer in #adminfeedback.
 */
import { supabase } from './supabase';
import { isMissing } from './coachApi';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export type FeedbackKind = 'bug' | 'suggestion' | 'contact';
export type FeedbackStatus = 'new' | 'in_progress' | 'done';

export const kindLabel: Record<FeedbackKind, string> = {
  bug: 'דיווח על תקלה',
  suggestion: 'הצעת ייעול',
  contact: 'צור קשר',
};

export const statusLabel: Record<FeedbackStatus, string> = {
  new: 'חדשה',
  in_progress: 'בטיפול',
  done: 'טופלה',
};

/** Optional public address for a mailto fallback (build-time VITE_SUPPORT_EMAIL). */
export const supportEmail = ((import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? '').trim();

export interface MyFeedback {
  id: string;
  kind: FeedbackKind;
  message: string;
  link: string | null;
  status: FeedbackStatus;
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface AdminFeedback extends MyFeedback {
  user_id: string;
  sender: string;
  contact_email: string | null;
  page: string | null;
  user_agent: string | null;
  updated_at: string;
}

/* The page the user was on before opening the form, attached to the message. */
let lastPage = '';
export function rememberPage(hash: string) {
  if (!/^#?(feedback|adminfeedback)\b/.test(hash)) lastPage = hash.slice(0, 200);
}
export function lastVisitedPage(): string {
  return lastPage;
}

/** Feedback errors in Hebrew, or null when the error is something else. */
export function feedbackError(e: unknown): string | null {
  if (isMissing(e)) return 'הטופס עוד לא הופעל בשרת. נסו שוב בקרוב.';
  const m = (e as { message?: string } | null)?.message ?? '';
  if (/too many messages/.test(m)) return 'שלחתם הרבה פניות היום. נסו שוב מחר.';
  if (/bad link/.test(m)) return 'הקישור צריך להתחיל ב-https://';
  if (/empty message/.test(m)) return 'כתבו כמה מילים על הפנייה.';
  if (/not allowed/.test(m)) return 'אין הרשאה לפעולה הזו.';
  return null;
}

export async function submitFeedback(input: { kind: FeedbackKind; message: string; link?: string }): Promise<string> {
  const { data, error } = await db().rpc('submit_feedback', {
    p_kind: input.kind,
    p_message: input.message,
    p_link: input.link?.trim() || null,
    p_page: lastVisitedPage() || null,
    p_user_agent: `${navigator.userAgent} · ${window.innerWidth}x${window.innerHeight}`.slice(0, 400),
  });
  if (error) throw error;
  return data as string;
}

/** My own messages (RLS: own rows only), newest first. Empty before the migration. */
export async function myFeedback(): Promise<MyFeedback[]> {
  const { data, error } = await db()
    .from('app_feedback')
    .select('id, kind, message, link, status, admin_reply, replied_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return (data ?? []) as MyFeedback[];
}

export async function adminFeedbackList(status: FeedbackStatus | null): Promise<AdminFeedback[]> {
  const { data, error } = await db().rpc('admin_feedback_list', { p_status: status });
  if (error) throw error;
  return (data ?? []) as AdminFeedback[];
}

export async function adminUpdateFeedback(id: string, status: FeedbackStatus, reply: string): Promise<void> {
  const { error } = await db().rpc('admin_update_feedback', { p_id: id, p_status: status, p_reply: reply.trim() || null });
  if (error) throw error;
}
