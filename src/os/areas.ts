/** Area of a club team, from the area word in its name (north/south derby, user 2026-11-09). */
export const AREAS = ['צפון', 'דרום', 'מרכז', 'מזרח', 'מערב'];
/** The area word in a team name ("הפועל רמת גן צפון · ילדים א'" -> צפון), or null. */
export function areaOf(name: string): string | null {
  for (const a of AREAS) if (new RegExp(`(^|[\\s\\-–·(])${a}($|[\\s\\-–·)])`).test(name)) return a;
  return null;
}

