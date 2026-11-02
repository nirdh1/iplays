/**
 * The child's private area: body measurements, BMI, personal goals and
 * nutrition. Only the child's parents see or edit it (not coaches, team or
 * club admins, platform admins or family followers); the server enforces
 * that with RLS and parent checks in every RPC.
 * Server side: supabase/migrations/20261102500000_body_goals_nutrition.sql
 */
import { supabase } from './supabase';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v));

/* ------------------------------------------------------------ measurements */

export type BodyKey = 'height_cm' | 'weight_kg' | 'waist_cm' | 'thigh_cm' | 'chest_cm' | 'arm_cm' | 'calf_cm';

export const bodyFields: { key: BodyKey; label: string; unit: string }[] = [
  { key: 'height_cm', label: 'גובה', unit: 'ס״מ' },
  { key: 'weight_kg', label: 'משקל', unit: 'ק״ג' },
  { key: 'waist_cm', label: 'היקף מותן', unit: 'ס״מ' },
  { key: 'thigh_cm', label: 'היקף ירך', unit: 'ס״מ' },
  { key: 'chest_cm', label: 'היקף חזה', unit: 'ס״מ' },
  { key: 'arm_cm', label: 'היקף זרוע', unit: 'ס״מ' },
  { key: 'calf_cm', label: 'היקף שוק', unit: 'ס״מ' },
];

export interface CustomMeasure {
  label: string;
  unit: string;
  value: number;
}

export type BodyMeasurement = { id: string; date: string; note: string; custom: CustomMeasure[] } & Record<BodyKey, number | null>;

/* ------------------------------------------------------------------- goals */

export type GoalCategory = 'speed' | 'endurance' | 'ball_control' | 'weak_foot' | 'shooting' | 'fitness' | 'other';
export type GoalStatus = 'active' | 'achieved' | 'paused' | 'dropped';
export type MetricKind = 'percent' | 'number';

export const goalCategories: { id: GoalCategory; label: string }[] = [
  { id: 'speed', label: 'שיפור מהירות' },
  { id: 'endurance', label: 'שיפור סיבולת' },
  { id: 'ball_control', label: 'שליטה בכדור' },
  { id: 'weak_foot', label: 'שיפור רגל חלשה' },
  { id: 'shooting', label: 'דיוק בעיטות' },
  { id: 'fitness', label: 'כושר גופני' },
  { id: 'other', label: 'אחר' },
];
export const categoryLabel = (c: GoalCategory) => goalCategories.find((x) => x.id === c)?.label ?? 'אחר';

export const goalStatuses: { id: GoalStatus; label: string }[] = [
  { id: 'active', label: 'פעיל' },
  { id: 'achieved', label: 'הושג' },
  { id: 'paused', label: 'מושהה' },
  { id: 'dropped', label: 'בוטל' },
];
export const statusLabel = (s: GoalStatus) => goalStatuses.find((x) => x.id === s)?.label ?? s;

export interface GoalProgress {
  id: string;
  date: string;
  value: number;
  note: string;
}

export interface ChildGoal {
  id: string;
  title: string;
  category: GoalCategory;
  description: string;
  start_on: string;
  target_on: string | null;
  metric_kind: MetricKind;
  metric_label: string;
  unit: string;
  baseline: number | null;
  target_value: number | null;
  status: GoalStatus;
  progress: GoalProgress[];
}

/** 0-100: the last percent entry, or how far the last value moved from baseline to target. */
export function goalPercent(g: ChildGoal): number {
  const last = g.progress[g.progress.length - 1];
  if (g.status === 'achieved') return 100;
  if (!last) return 0;
  if (g.metric_kind === 'percent') return Math.max(0, Math.min(100, Math.round(last.value)));
  if (g.baseline == null || g.target_value == null || g.baseline === g.target_value) return 0;
  const p = ((last.value - g.baseline) / (g.target_value - g.baseline)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/* --------------------------------------------------------------- nutrition */

export type Allergy = 'milk' | 'eggs' | 'peanuts' | 'tree_nuts' | 'sesame' | 'gluten' | 'soy' | 'fish';
export type Restriction = 'kosher' | 'vegetarian' | 'vegan' | 'gluten_free' | 'lactose_free';

export const allergyOptions: { id: Allergy; label: string }[] = [
  { id: 'milk', label: 'חלב' },
  { id: 'eggs', label: 'ביצים' },
  { id: 'peanuts', label: 'בוטנים' },
  { id: 'tree_nuts', label: 'אגוזים' },
  { id: 'sesame', label: 'שומשום' },
  { id: 'gluten', label: 'גלוטן' },
  { id: 'soy', label: 'סויה' },
  { id: 'fish', label: 'דגים' },
];
export const restrictionOptions: { id: Restriction; label: string }[] = [
  { id: 'kosher', label: 'כשרות' },
  { id: 'vegetarian', label: 'צמחוני' },
  { id: 'vegan', label: 'טבעוני' },
  { id: 'gluten_free', label: 'ללא גלוטן' },
  { id: 'lactose_free', label: 'ללא לקטוז' },
];

export interface Nutrition {
  preferences: string;
  allergies: Allergy[];
  allergy_other: string;
  restrictions: Restriction[];
  restriction_other: string;
  training_times: string;
  sport_needs: string;
  updated_at?: string;
}

export const emptyNutrition: Nutrition = {
  preferences: '',
  allergies: [],
  allergy_other: '',
  restrictions: [],
  restriction_other: '',
  training_times: '',
  sport_needs: '',
};

/* -------------------------------------------------------------------- read */

export interface PrivateProfile {
  measurements: BodyMeasurement[];
  goals: ChildGoal[];
  nutrition: Nutrition | null;
}

/** null: the caller is not a parent of the child (the area is not shown at all). */
export async function getPrivateProfile(playerId: string): Promise<PrivateProfile | null> {
  const { data, error } = await db().rpc('child_private_profile', { p_player: playerId });
  if (error) {
    // before the migration runs the function doesn't exist: hide the area
    if (error.code === 'PGRST202' || /child_private_profile/.test(error.message ?? '')) return null;
    throw error;
  }
  if (!data) return null;
  const d = data as PrivateProfile;
  return {
    measurements: (d.measurements ?? []).map((m) => ({
      ...m,
      height_cm: n(m.height_cm),
      weight_kg: n(m.weight_kg),
      waist_cm: n(m.waist_cm),
      thigh_cm: n(m.thigh_cm),
      chest_cm: n(m.chest_cm),
      arm_cm: n(m.arm_cm),
      calf_cm: n(m.calf_cm),
      custom: (m.custom ?? []).map((c) => ({ ...c, value: Number(c.value) })),
    })),
    goals: (d.goals ?? []).map((g) => ({
      ...g,
      baseline: n(g.baseline),
      target_value: n(g.target_value),
      progress: (g.progress ?? []).map((p) => ({ ...p, value: Number(p.value) })),
    })),
    nutrition: d.nutrition ?? null,
  };
}

/* ------------------------------------------------------------------- write */

export async function addBodyMeasurement(input: { playerId: string; date: string; values: Partial<Record<BodyKey, number | null>>; custom: CustomMeasure[]; note: string }) {
  const { error } = await db().rpc('add_body_measurement', {
    p_player: input.playerId,
    p_on: input.date,
    p_values: input.values,
    p_custom: input.custom,
    p_note: input.note,
  });
  if (error) throw error;
}

export async function removeBodyMeasurement(id: string) {
  const { error } = await db().rpc('remove_player_record', { p_kind: 'measurement', p_id: id });
  if (error) throw error;
}

export interface GoalInput {
  playerId: string;
  id: string | null;
  title: string;
  category: GoalCategory;
  description: string;
  start: string;
  targetOn: string | null;
  kind: MetricKind;
  metricLabel: string;
  unit: string;
  baseline: number | null;
  targetValue: number | null;
  status: GoalStatus;
}

export async function saveGoal(g: GoalInput) {
  const { error } = await db().rpc('save_child_goal', {
    p_player: g.playerId,
    p_id: g.id,
    p_title: g.title,
    p_category: g.category,
    p_description: g.description,
    p_start: g.start,
    p_target_on: g.targetOn,
    p_metric_kind: g.kind,
    p_metric_label: g.metricLabel,
    p_unit: g.unit,
    p_baseline: g.baseline,
    p_target_value: g.targetValue,
    p_status: g.status,
  });
  if (error) throw error;
}

export async function setGoalStatus(goalId: string, status: GoalStatus) {
  const { error } = await db().rpc('set_child_goal_status', { p_goal: goalId, p_status: status });
  if (error) throw error;
}

export async function addGoalProgress(goalId: string, date: string, value: number, note: string) {
  const { error } = await db().rpc('add_child_goal_progress', { p_goal: goalId, p_on: date, p_value: value, p_note: note });
  if (error) throw error;
}

export async function removeGoalRecord(kind: 'goal' | 'progress', id: string) {
  const { error } = await db().rpc('remove_child_goal_record', { p_kind: kind, p_id: id });
  if (error) throw error;
}

export async function saveNutrition(playerId: string, v: Nutrition) {
  const { error } = await db().rpc('save_child_nutrition', {
    p_player: playerId,
    p_preferences: v.preferences,
    p_allergies: v.allergies,
    p_allergy_other: v.allergy_other,
    p_restrictions: v.restrictions,
    p_restriction_other: v.restriction_other,
    p_training_times: v.training_times,
    p_sport_needs: v.sport_needs,
  });
  if (error) throw error;
}

/* --------------------------------------------------------------------- BMI */

/**
 * BMI = weight (kg) / height (m)². Uses the height from the same measurement,
 * or the latest earlier one. Raw number only: for children BMI is read on
 * age- and sex-specific percentile charts, so no adult category is shown.
 */
export function bmiSeries(list: BodyMeasurement[]): { date: string; value: number }[] {
  let height: number | null = null;
  const out: { date: string; value: number }[] = [];
  for (const m of list) {
    if (m.height_cm != null) height = m.height_cm;
    if (m.weight_kg != null && height) {
      const h = height / 100;
      out.push({ date: m.date, value: Math.round((m.weight_kg / (h * h)) * 10) / 10 });
    }
  }
  return out;
}
