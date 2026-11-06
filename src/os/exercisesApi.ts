import { supabase } from '../lib/supabase';
import { parseDiagram, type Diagram, type PitchPreset } from './pitch/model';

function db() {
  if (!supabase) throw new Error('backend not configured');
  return supabase;
}

export type ExerciseScope = 'iplays' | 'club' | 'personal';
export type ReviewStatus = 'not_needed' | 'pending_review' | 'approved';

export interface Category {
  code: string;
  label: string;
  sort: number;
  approved: boolean;
}

export interface Exercise {
  id: string;
  scope: ExerciseScope;
  owner_id: string | null;
  club_id: string | null;
  status: 'draft' | 'active' | 'archived';
  review_status: ReviewStatus;
  title: string;
  description: string;
  coaching_points: string;
  category: string;
  difficulty: number;
  age_from: number;
  age_to: number;
  players_min: number;
  players_max: number;
  duration_min: number;
  pitch_preset: PitchPreset;
  area_w_m: number | null;
  area_l_m: number | null;
  equipment: string[];
  diagram: Diagram;
  copied_from: string | null;
  updated_at: string;
}

export interface ExerciseClub {
  club_id: string;
  name: string;
  can_write: boolean;
}

export type ExerciseInput = Omit<Exercise, 'id' | 'scope' | 'owner_id' | 'club_id' | 'review_status' | 'copied_from' | 'updated_at'>;

const cols =
  'id,scope,owner_id,club_id,status,review_status,title,description,coaching_points,category,difficulty,age_from,age_to,players_min,players_max,duration_min,pitch_preset,area_w_m,area_l_m,equipment,diagram,copied_from,updated_at';

const fix = (r: Exercise): Exercise => ({ ...r, diagram: parseDiagram(r.diagram), equipment: r.equipment ?? [] });

/** Every exercise this account may read (RLS decides): base library, my clubs, mine. */
export async function listExercises(): Promise<Exercise[]> {
  const { data, error } = await db().from('exercises').select(cols).neq('status', 'archived').order('title').limit(500);
  if (error) throw error;
  return ((data ?? []) as Exercise[]).map(fix);
}

export async function getExercise(id: string): Promise<Exercise | null> {
  const { data, error } = await db().from('exercises').select(cols).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fix(data as Exercise) : null;
}

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await db().from('exercise_categories').select('code,label,sort,approved').order('sort');
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function myExerciseClubs(): Promise<ExerciseClub[]> {
  const { data, error } = await db().rpc('my_exercise_clubs');
  if (error) throw error;
  return (data ?? []) as ExerciseClub[];
}

export async function saveExercise(id: string | null, scope: 'club' | 'personal', clubId: string | null, input: ExerciseInput): Promise<string> {
  const { data, error } = await db().rpc('save_exercise', { p_id: id, p_scope: scope, p_club: clubId, p: input });
  if (error) throw error;
  return data as string;
}

export async function copyExercise(id: string, scope: 'club' | 'personal', clubId: string | null): Promise<string> {
  const { data, error } = await db().rpc('copy_exercise', { p_id: id, p_scope: scope, p_club: clubId });
  if (error) throw error;
  return data as string;
}

export async function archiveExercise(id: string, archived = true): Promise<void> {
  const { error } = await db().rpc('archive_exercise', { p_id: id, p_archived: archived });
  if (error) throw error;
}

export const scopeLabel: Record<ExerciseScope, string> = { iplays: 'ספריית iPlays', club: 'ספריית המועדון', personal: 'התרגילים שלי' };
export const difficultyLabel = ['', 'קל', 'בינוני', 'מאתגר', 'מתקדם'];

export const blankExercise = (category: string): ExerciseInput => ({
  status: 'active',
  title: '',
  description: '',
  coaching_points: '',
  category,
  difficulty: 2,
  age_from: 8,
  age_to: 14,
  players_min: 4,
  players_max: 12,
  duration_min: 15,
  pitch_preset: 'custom',
  area_w_m: 20,
  area_l_m: 25,
  equipment: [],
  diagram: { v: 1, elements: [], lines: [] },
});
