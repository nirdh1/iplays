/**
 * Player career: stats, monthly trend and athletic progress, all computed on
 * the server from real data (matches, lineups, attendance, live goals,
 * coach assessments, fitness tests).
 * Server side: supabase/migrations/20261101980000_player_career.sql
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
}

export async function getCareer(playerId: string): Promise<Career | null> {
  const { data, error } = await db().rpc('player_career', { p_player: playerId });
  if (error) throw error;
  if (!data || !(data as Career).player) return null;
  const c = data as Career;
  return {
    ...c,
    fitness: c.fitness ? c.fitness.map((f) => ({ ...f, value: Number(f.value) })) : null,
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
