/**
 * Supabase client. When the two env vars are missing the app runs in demo
 * mode (fictional data, no login) — that's how the static preview works.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
export const backendEnabled = supabase !== null;

/** Israeli mobile numbers: "050-123-4567" / "0501234567" / "+972501234567" → "+972501234567". */
export function normalizeIlPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let local: string;
  if (digits.startsWith('+972')) local = digits.slice(4);
  else if (digits.startsWith('972')) local = digits.slice(3);
  else if (digits.startsWith('0')) local = digits.slice(1);
  else return null;
  return /^5\d{8}$/.test(local) ? `+972${local}` : null;
}
