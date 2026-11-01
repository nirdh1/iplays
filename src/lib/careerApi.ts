/**
 * Player career: stats, monthly trend and athletic progress, all computed on
 * the server from real data (matches, lineups, attendance, live goals,
 * coach assessments, fitness tests).
 * Server side: supabase/migrations/20261101985000_player_career.sql
 */
import { supabase } from './supabase';
import type { Sport } from './api';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export interface CareerTotals {
  appearances: number;
  starts: number;
  goals: number;
  points: number;
  trainings: number;
  trainings_attended: number;
}

export interface CareerMonth {
  month: string; // YYYY-MM
  appearances: number;
  goals: number;
  points: number;
  trainings: number;
  trainings_attended: number;
}

export interface CareerSeason {
  season: string;
  team_id: string;
  team_name: string;
  appearances: number;
  starts: number;
  goals: number;
  points: number;
}

export interface Assessment {
  id: string;
  date: string;
  team_id: string;
  speed: number | null;
  stamina: number | null;
  technique: number | null;
  vision: number | null;
  note: string;
}

export interface FitnessResult {
  id: string;
  test: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  value: number;
  date: string;
  team_id: string;
}

export interface Career {
  player: {
    id: string;
    first_name: string;
    last_name: string;
    birth_year: number | null;
    shirt_number: number | null;
    position: string;
    team_id: string | null;
    team_name: string | null;
    club: string | null;
    sport: Sport | null;
    strong_foot: StrongFoot | null;
  };
  sport: Sport | null;
  totals: CareerTotals;
  seasons: CareerSeason[];
  monthly: CareerMonth[];
  goal_matches: { date: string; opponent: string; goals: number; points: number; team: string }[];
  /** null: the caller is not the child's parent or team staff. */
  assessments: Assessment[] | null;
  fitness: FitnessResult[] | null;
  /** The team through which the caller may add assessments / tests; null = read only. */
  edit_team_id: string | null;
  /** null: the caller may not see body measurements (parents + metrics staff only). */
  measurements: Measurement[] | null;
  /** null: the caller may not see medical data (parents + medical staff only). */
  medical: MedicalClearance[] | null;
  can_edit_profile: boolean;
  can_edit_measurements: boolean;
  can_edit_medical: boolean;
}

export type StrongFoot = 'right' | 'left' | 'both';
export const footLabel: Record<StrongFoot, string> = { right: 'ימין', left: 'שמאל', both: 'שתי הרגליים' };

export const positionsBySport: Record<string, string[]> = {
  football: ['שוער', 'בלם', 'מגן ימני', 'מגן שמאלי', 'קשר אחורי', 'קשר', 'קשר התקפי', 'כנף ימין', 'כנף שמאל', 'חלוץ'],
  basketball: ['רכז', 'קלע', 'סמול פורוורד', 'פאוור פורוורד', 'סנטר'],
};

export interface Measurement {
  id: string;
  date: string;
  height_cm: number | null;
  weight_kg: number | null;
  thigh_cm: number | null;
  calf_cm: number | null;
  arm_cm: number | null;
  note: string;
}

export const measurementFields: { key: 'height_cm' | 'weight_kg' | 'thigh_cm' | 'calf_cm' | 'arm_cm'; label: string; unit: string }[] = [
  { key: 'height_cm', label: 'גובה', unit: 'ס״מ' },
  { key: 'weight_kg', label: 'משקל', unit: 'ק״ג' },
  { key: 'thigh_cm', label: 'היקף ירך', unit: 'ס״מ' },
  { key: 'calf_cm', label: 'היקף שוק', unit: 'ס״מ' },
  { key: 'arm_cm', label: 'היקף זרוע', unit: 'ס״מ' },
];

export interface MedicalClearance {
  id: string;
  issued_on: string;
  valid_until: string;
  issuer: string;
  note: string;
}

export async function getCareer(playerId: string): Promise<Career | null> {
  const { data, error } = await db().rpc('player_career', { p_player: playerId });
  if (error) throw error;
  if (!data || !(data as Career).player) return null;
  const c = data as Career;
  return {
    ...c,
    fitness: c.fitness ? c.fitness.map((f) => ({ ...f, value: Number(f.value) })) : null,
    measurements: c.measurements
      ? c.measurements.map((m) => {
          const n = (v: unknown) => (v == null ? null : Number(v));
          return { ...m, height_cm: n(m.height_cm), weight_kg: n(m.weight_kg), thigh_cm: n(m.thigh_cm), calf_cm: n(m.calf_cm), arm_cm: n(m.arm_cm) };
        })
      : c.measurements ?? null,
    medical: c.medical ?? null,
  };
}

export interface FitnessTestType {
  code: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
}

export async function getFitnessTestTypes(): Promise<FitnessTestType[]> {
  const { data, error } = await db().from('fitness_test_types').select('code, label, unit, lower_is_better').order('sort');
  if (error) throw error;
  return (data ?? []) as FitnessTestType[];
}

export async function saveAssessment(input: {
  playerId: string;
  teamId: string;
  date: string;
  speed: number | null;
  stamina: number | null;
  technique: number | null;
  vision: number | null;
  note: string;
}) {
  const { error } = await db().rpc('save_player_assessment', {
    p_player: input.playerId,
    p_team: input.teamId,
    p_on: input.date,
    p_speed: input.speed,
    p_stamina: input.stamina,
    p_technique: input.technique,
    p_vision: input.vision,
    p_note: input.note,
  });
  if (error) throw error;
}

export async function addFitnessTest(input: { playerId: string; teamId: string; test: string; value: number; date: string; note: string }) {
  const { error } = await db().rpc('add_fitness_test', {
    p_player: input.playerId,
    p_team: input.teamId,
    p_test: input.test,
    p_value: input.value,
    p_on: input.date,
    p_note: input.note,
  });
  if (error) throw error;
}

export async function removeMetric(kind: 'assessment' | 'fitness', id: string) {
  const { error } = await db().rpc('remove_player_metric', { p_kind: kind, p_id: id });
  if (error) throw error;
}

export const attributeLabels: { key: 'speed' | 'stamina' | 'technique' | 'vision'; label: string }[] = [
  { key: 'speed', label: 'מהירות' },
  { key: 'stamina', label: 'סיבולת' },
  { key: 'technique', label: 'טכניקה' },
  { key: 'vision', label: 'ראיית משחק' },
];

/** Latest value of each attribute and its change since the previous assessment that rated it. */
export function latestAttributes(list: Assessment[]) {
  return attributeLabels
    .map(({ key, label }) => {
      const rated = list.filter((a) => a[key] != null);
      if (!rated.length) return null;
      const last = rated[rated.length - 1];
      const prev = rated.length > 1 ? rated[rated.length - 2] : null;
      return { key, label, value: last[key] as number, delta: prev ? (last[key] as number) - (prev[key] as number) : null, date: last.date };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Per test: latest result, change from the previous one ("better" respects lower_is_better), personal best. */
export function fitnessSummary(list: FitnessResult[]) {
  const byTest = new Map<string, FitnessResult[]>();
  for (const f of list) byTest.set(f.test, [...(byTest.get(f.test) ?? []), f]);
  return [...byTest.values()].map((rows) => {
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const best = rows.reduce((b, r) => (last.lower_is_better ? (r.value < b.value ? r : b) : r.value > b.value ? r : b), rows[0]);
    const change = prev ? last.value - prev.value : null;
    const better = change == null || change === 0 ? null : last.lower_is_better ? change < 0 : change > 0;
    return { ...last, change, better, best, isBest: rows.length > 1 && best.id === last.id, count: rows.length };
  });
}

const monthNames = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export const monthLabel = (ym: string) => monthNames[Number(ym.slice(5, 7)) - 1] ?? ym;
export const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;

export async function setPlayerProfile(playerId: string, position: string, strongFoot: StrongFoot | null) {
  const { error } = await db().from('players').update({ position: position.slice(0, 30), strong_foot: strongFoot }).eq('id', playerId);
  if (error) throw error;
}

export async function addMeasurement(input: { playerId: string; date: string; values: Partial<Record<(typeof measurementFields)[number]['key'], number | null>>; note: string }) {
  const v = input.values;
  const { error } = await db().rpc('add_player_measurement', {
    p_player: input.playerId,
    p_on: input.date,
    p_height: v.height_cm ?? null,
    p_weight: v.weight_kg ?? null,
    p_thigh: v.thigh_cm ?? null,
    p_calf: v.calf_cm ?? null,
    p_arm: v.arm_cm ?? null,
    p_note: input.note,
  });
  if (error) throw error;
}

export async function addMedicalClearance(input: { playerId: string; issued: string; validUntil: string; issuer: string }) {
  const { error } = await db().rpc('add_medical_clearance', {
    p_player: input.playerId,
    p_issued: input.issued,
    p_valid_until: input.validUntil,
    p_issuer: input.issuer,
    p_note: '',
  });
  if (error) throw error;
}

export async function removeRecord(kind: 'measurement' | 'medical', id: string) {
  const { error } = await db().rpc('remove_player_record', { p_kind: kind, p_id: id });
  if (error) throw error;
}

/** Days from today (Israel) to a date; negative = past. */
export function daysUntil(d: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  return Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
}
