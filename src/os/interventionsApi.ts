/**
 * Management interventions (phase A). Thin wrappers over the RPCs in
 * supabase/migrations/20261111100000_club_interventions.sql. All reads and
 * writes go through security-definer functions that check permissions.
 */
import { supabase } from '../lib/supabase';
import type { InsightKind } from './insights';

export type InterventionStatus = 'open' | 'in_progress' | 'checking' | 'closed' | 'canceled';
export type Outcome = 'improved' | 'no_change' | 'worse' | 'inconclusive';
export type Metric = 'marked_pct' | 'attendance_pct' | 'form_ppg' | 'report_pct' | 'plan_pct' | 'drills_adopted';

export interface Intervention {
  id: string;
  club_id: string;
  club_name: string | null;
  team_id: string | null;
  team_name: string | null;
  insight_key: string;
  kind: InsightKind;
  metric: Metric;
  context: Record<string, unknown>;
  title: string;
  why: string;
  action_plan: string;
  owner_id: string | null;
  owner_name: string | null;
  status: InterventionStatus;
  due_on: string | null;
  baseline_value: number | null;
  baseline_at: string;
  current_value: number | null;
  current_at: string | null;
  outcome: Outcome | null;
  conclusion: string | null;
  created_at: string;
  closed_at: string | null;
  can_manage: boolean;
  can_work: boolean;
  overdue: boolean;
}
export interface LogEntry {
  at: string;
  action: 'opened' | 'status' | 'note' | 'owner' | 'due' | 'plan' | 'measured' | 'closed' | 'canceled';
  note: string | null;
  value: number | null;
  data: Record<string, unknown>;
  actor_name: string | null;
}
export interface InterventionDetail extends Intervention {
  log: LogEntry[];
}
export interface OwnerOption {
  user_id: string;
  name: string;
  role: string;
}
export interface TodaySession {
  session_id: string;
  team_id: string;
  team_name: string;
  starts_at: string;
  duration_min: number;
  location: string;
  has_plan: boolean;
}

export const OPEN_STATUSES: InterventionStatus[] = ['open', 'in_progress', 'checking'];
export const isOpen = (s: InterventionStatus) => OPEN_STATUSES.includes(s);

export const STATUS_HE: Record<InterventionStatus, string> = {
  open: 'הוחלט, טרם התחיל',
  in_progress: 'בביצוע',
  checking: 'בבדיקת תוצאה',
  closed: 'נסגר',
  canceled: 'בוטל',
};
export const OUTCOME_HE: Record<Outcome, string> = {
  improved: 'השתפר',
  no_change: 'ללא שינוי',
  worse: 'החמיר',
  inconclusive: 'לא ניתן לקבוע',
};
/** What each metric measures, and its unit. */
export const METRIC_HE: Record<Metric, { label: string; unit: string; higherIsBetter: boolean }> = {
  marked_pct: { label: 'אימונים עם סימון נוכחות (14 ימים)', unit: '%', higherIsBetter: true },
  attendance_pct: { label: 'נוכחות מסימוני צוות (14 ימים)', unit: '%', higherIsBetter: true },
  form_ppg: { label: 'נקודות למשחק ב־5 האחרונים (טבלת ההתאחדות)', unit: '', higherIsBetter: true },
  report_pct: { label: 'אימונים עם דוח (14 ימים)', unit: '%', higherIsBetter: true },
  plan_pct: { label: 'אימונים עם מערך (14 ימים אחורה ו־7 קדימה)', unit: '%', higherIsBetter: true },
  drills_adopted: { label: 'מהתרגילים שהוצעו, כמה שולבו באימונים (30 ימים)', unit: '', higherIsBetter: true },
};

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const listInterventions = (club: string | null) => call<Intervention[]>('club_interventions_list', { p_club: club });
export const getIntervention = (id: string) => call<InterventionDetail | null>('intervention_detail', { p_id: id });
export const ownerOptions = (club: string, team: string | null) =>
  call<OwnerOption[]>('intervention_owner_options', { p_club: club, p_team: team });
export const todaySessions = (club: string) => call<TodaySession[] | null>('club_today_sessions', { p_club: club });

export function openIntervention(a: {
  club: string;
  team: string | null;
  kind: InsightKind;
  title: string;
  why: string;
  plan: string;
  owner: string | null;
  due: string | null;
  context?: Record<string, unknown>;
}) {
  return call<{ id: string; existing: boolean }>('open_intervention', {
    p_club: a.club,
    p_team: a.team,
    p_kind: a.kind,
    p_title: a.title,
    p_why: a.why,
    p_plan: a.plan,
    p_owner: a.owner,
    p_due: a.due,
    p_context: a.context ?? {},
  });
}
export const measureIntervention = (id: string) => call<number | null>('measure_intervention', { p_id: id });
export const actOnIntervention = (id: string, action: 'note' | 'status' | 'owner' | 'due' | 'plan', value: string) =>
  call<void>('intervention_act', { p_id: id, p_action: action, p_value: value });
export const closeIntervention = (id: string, outcome: Outcome, conclusion: string) =>
  call<void>('close_intervention', { p_id: id, p_outcome: outcome, p_conclusion: conclusion });
export const cancelIntervention = (id: string, reason: string) => call<void>('cancel_intervention', { p_id: id, p_reason: reason });

/** A metric value for people: "72%", "1.4", or "אין נתון". */
export function fmtMetric(m: Metric, v: number | null | undefined) {
  if (v === null || v === undefined) return 'אין נתון';
  const u = METRIC_HE[m].unit;
  return m === 'form_ppg' ? Number(v).toFixed(1) : `${Math.round(Number(v))}${u}`;
}
/** Today in Israel, yyyy-mm-dd, plus n days. */
export function israelDate(plusDays = 0) {
  const d = new Date(Date.now() + plusDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
}
