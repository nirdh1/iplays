import { supabase } from '../../lib/supabase';
import { parseDiagram } from '../pitch/model';
import { fromJson, toSaveJson, type Plan } from './model';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export interface PlanRow {
  id: string;
  title: string;
  goal: string;
  status: 'draft' | 'ready';
  total_min: number;
  blocks: number;
  assigned: number;
  updated_at: string;
}

export async function listPlans(teamId: string): Promise<PlanRow[]> {
  const { data, error } = await db().rpc('team_session_plans', { p_team: teamId });
  if (error) throw error;
  return (data ?? []) as PlanRow[];
}

// diagrams arrive as raw JSON; normalise them like the library does
function fixDiagrams<T>(j: T): T {
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) r[k] = k === 'diagram' ? parseDiagram(v) : walk(v);
      return r;
    }
    return o;
  };
  return walk(j) as T;
}

export async function getPlan(id: string): Promise<Plan | null> {
  const { data, error } = await db().rpc('session_plan_json', { p_plan: id });
  if (error) throw error;
  return data ? fromJson(fixDiagrams(data)) : null;
}

export async function savePlan(p: Plan): Promise<string> {
  const { data, error } = await db().rpc('save_session_plan', { p_id: p.id, p_team: p.team_id, p: toSaveJson(p) });
  if (error) throw error;
  return data as string;
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await db().rpc('delete_session_plan', { p_id: id });
  if (error) throw error;
}

export interface Assignment {
  session_id: string;
  plan_id: string | null;
  snapshot: Parameters<typeof fromJson>[0] & { total_min: number };
  assigned_at: string;
}

export async function getAssignment(sessionId: string): Promise<Assignment | null> {
  const { data, error } = await db().from('session_plan_assignments').select('session_id,plan_id,snapshot,assigned_at').eq('session_id', sessionId).maybeSingle();
  if (error) throw error;
  return data ? (fixDiagrams(data) as Assignment) : null;
}

/** session ids (of the given list) that have a plan assigned */
export async function assignedSessions(sessionIds: string[]): Promise<Set<string>> {
  if (!sessionIds.length) return new Set();
  const { data, error } = await db().from('session_plan_assignments').select('session_id').in('session_id', sessionIds);
  if (error) throw error;
  return new Set(((data ?? []) as { session_id: string }[]).map((r) => r.session_id));
}

export async function assignPlan(sessionId: string, planId: string): Promise<void> {
  const { error } = await db().rpc('assign_session_plan', { p_session: sessionId, p_plan: planId });
  if (error) throw error;
}

export async function unassignPlan(sessionId: string): Promise<void> {
  const { error } = await db().rpc('unassign_session_plan', { p_session: sessionId });
  if (error) throw error;
}

export type BlockStatus = 'done' | 'skipped' | 'changed';
export interface TrainingReport {
  session_id: string;
  blocks: { ord: number; status: BlockStatus; note?: string }[];
  rating: number | null;
  note: string;
  submitted_at: string;
  updated_at: string;
}

export async function getReport(sessionId: string): Promise<TrainingReport | null> {
  const { data, error } = await db().from('training_reports').select('session_id,blocks,rating,note,submitted_at,updated_at').eq('session_id', sessionId).maybeSingle();
  if (error) throw error;
  return (data as TrainingReport) ?? null;
}

export async function submitReport(sessionId: string, r: { blocks: TrainingReport['blocks']; rating: number | null; note: string }): Promise<void> {
  const { error } = await db().rpc('submit_training_report', { p_session: sessionId, p: r });
  if (error) throw error;
}
