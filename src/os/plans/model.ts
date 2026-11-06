/**
 * Session plan model (mirrors session_plan_json()). Minutes follow the rule
 * in the migration: a stations block takes rounds × station + (rounds − 1) ×
 * transition, because all groups rotate together (no double counting).
 */
import type { Diagram, PitchPreset } from '../pitch/model';

export interface PlanExercise {
  id: string;
  title: string;
  category: string;
  pitch_preset: PitchPreset;
  area_w_m: number | null;
  area_l_m: number | null;
  diagram: Diagram;
  coaching_points?: string;
  equipment?: string[];
}
export interface PlanStation {
  exercise: PlanExercise | null;
  title: string;
  responsible: string;
}
export type BlockKind = 'exercise' | 'stations' | 'break';
export interface PlanBlock {
  key: string; // client-only id for React lists
  kind: BlockKind;
  title: string;
  goal: string;
  exercise: PlanExercise | null;
  duration_min: number;
  groups: number;
  rounds: number;
  station_min: number;
  transition_min: number;
  stations: PlanStation[];
}
export interface Plan {
  id: string | null;
  team_id: string;
  title: string;
  goal: string;
  notes: string;
  status: 'draft' | 'ready';
  blocks: PlanBlock[];
}

export function blockMinutes(b: Pick<PlanBlock, 'kind' | 'duration_min' | 'rounds' | 'station_min' | 'transition_min'>): number {
  if (b.kind === 'stations') return b.rounds * b.station_min + Math.max(b.rounds - 1, 0) * b.transition_min;
  return b.duration_min;
}
export const planMinutes = (blocks: PlanBlock[]) => blocks.reduce((t, b) => t + blockMinutes(b), 0);

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newBlock(kind: BlockKind, exercise: PlanExercise | null = null, duration = 15): PlanBlock {
  return {
    key: newKey(),
    kind,
    title: kind === 'break' ? 'הפסקת שתייה' : '',
    goal: '',
    exercise,
    duration_min: kind === 'break' ? 3 : duration,
    groups: 4,
    rounds: 4,
    station_min: 10,
    transition_min: 2,
    stations: kind === 'stations' ? Array.from({ length: 4 }, () => ({ exercise: null, title: '', responsible: '' })) : [],
  };
}

/** Problems that block saving, in Hebrew. Empty = OK. */
export function validate(p: Plan): string[] {
  const out: string[] = [];
  if (p.title.trim().length < 2) out.push('צריך שם למערך');
  if (p.blocks.length > 30) out.push('עד 30 שלבים במערך');
  p.blocks.forEach((b, i) => {
    const n = `שלב ${i + 1}`;
    if (b.kind === 'exercise' && !b.exercise && !b.title.trim()) out.push(`${n}: בחר תרגיל או כתוב כותרת`);
    if (b.kind === 'stations') {
      if (b.stations.length < 2 || b.stations.length > 8) out.push(`${n}: 2 עד 8 תחנות`);
      if (b.rounds > b.stations.length) out.push(`${n}: יותר סבבים מתחנות`);
      if (b.stations.some((s) => !s.exercise && !s.title.trim())) out.push(`${n}: לכל תחנה צריך תרגיל או כותרת`);
    }
  });
  return out;
}

/** JSON for save_session_plan(). */
export function toSaveJson(p: Plan) {
  return {
    title: p.title.trim(),
    goal: p.goal.trim(),
    notes: p.notes.trim(),
    status: p.status,
    blocks: p.blocks.map((b) => ({
      kind: b.kind,
      title: b.title.trim(),
      goal: b.goal.trim(),
      exercise_id: b.kind === 'exercise' ? b.exercise?.id ?? null : null,
      duration_min: b.duration_min,
      groups: b.groups,
      rounds: b.rounds,
      station_min: b.station_min,
      transition_min: b.transition_min,
      stations: b.kind === 'stations' ? b.stations.map((s) => ({ exercise_id: s.exercise?.id ?? null, title: s.title.trim(), responsible: s.responsible.trim() })) : [],
    })),
  };
}

interface RawBlock {
  kind: BlockKind;
  title: string;
  goal: string;
  exercise: PlanExercise | null;
  duration_min: number | null;
  groups: number | null;
  rounds: number | null;
  station_min: number | null;
  transition_min: number | null;
  stations: { exercise: PlanExercise | null; title: string; responsible: string }[];
}
/** From session_plan_json() (or an assignment snapshot) to the editor model. */
export function fromJson(j: { id: string; team_id: string; title: string; goal: string; notes: string; status: 'draft' | 'ready'; blocks: RawBlock[] }): Plan {
  return {
    id: j.id,
    team_id: j.team_id,
    title: j.title,
    goal: j.goal,
    notes: j.notes,
    status: j.status,
    blocks: (j.blocks ?? []).map((b) => ({
      key: newKey(),
      kind: b.kind,
      title: b.title ?? '',
      goal: b.goal ?? '',
      exercise: b.exercise ?? null,
      duration_min: b.duration_min ?? 15,
      groups: b.groups ?? 4,
      rounds: b.rounds ?? 4,
      station_min: b.station_min ?? 10,
      transition_min: b.transition_min ?? 2,
      stations: (b.stations ?? []).map((s) => ({ exercise: s.exercise ?? null, title: s.title ?? '', responsible: s.responsible ?? '' })),
    })),
  };
}
