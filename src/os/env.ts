/**
 * iPlays 2.0 (Club OS) switches. V2 lives under #os/... and is OFF unless the
 * build sets VITE_V2_OS=1 (Staging only). It also refuses to open against the
 * Production Supabase project, so turning the flag on by mistake in a
 * Production build does not expose unfinished screens to real families.
 */
const PRODUCTION_REF = 'niqgnexxkkiyxgccbrct';
const backendUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';

const rawFlag = String(import.meta.env.VITE_V2_OS ?? '').trim().toLowerCase();
export const v2Flag = rawFlag === '1' || rawFlag === 'true';
export const onProductionBackend = backendUrl.includes(PRODUCTION_REF);
/** Label shown in the fixed top banner, e.g. "STAGING". */
export const envLabel = ((import.meta.env.VITE_ENV_LABEL as string | undefined) ?? '').trim();

export function isOsHash(hash = window.location.hash): boolean {
  return hash === '#os' || hash.startsWith('#os/');
}

/** Club OS may open in this build (flag on, not the Production backend). */
export const v2Enabled = v2Flag && !onProductionBackend;

/** Why Club OS is off in this build, for the #os notice (no secrets: host only). */
export function v2OffReason(): string {
  if (onProductionBackend) return 'הבנייה הזאת מחוברת ל-Supabase של Production, ולכן Club OS חסום בה.';
  if (!v2Flag) return `המשתנה VITE_V2_OS לא הגיע לבנייה (ערך שהתקבל: "${rawFlag || 'ריק'}"). צריך להגדיר VITE_V2_OS=1 בסביבת Preview ולבנות מחדש.`;
  return '';
}
export const backendHost = (() => {
  try {
    return backendUrl ? new URL(backendUrl).host : '';
  } catch {
    return '';
  }
})();
