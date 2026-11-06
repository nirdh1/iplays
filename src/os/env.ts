/**
 * iPlays 2.0 (Club OS) switches. V2 lives under #os/... and is OFF unless the
 * build sets VITE_V2_OS=1 (Staging only). It also refuses to open against the
 * Production Supabase project, so turning the flag on by mistake in a
 * Production build does not expose unfinished screens to real families.
 */
const PRODUCTION_REF = 'niqgnexxkkiyxgccbrct';
const backendUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';

export const v2Flag = import.meta.env.VITE_V2_OS === '1';
export const onProductionBackend = backendUrl.includes(PRODUCTION_REF);
/** Label shown in the fixed top banner, e.g. "STAGING". */
export const envLabel = ((import.meta.env.VITE_ENV_LABEL as string | undefined) ?? '').trim();

export function isOsHash(hash = window.location.hash): boolean {
  return hash === '#os' || hash.startsWith('#os/');
}
