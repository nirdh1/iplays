/** Pure helpers for the league comparison (LeagueRivals). */
export interface LeagueRow {
  pos: number;
  name: string;
  played: number;
  points: number;
  goal_diff?: number;
  form?: string;
  is_us?: boolean;
}
export interface LeagueTable {
  league_name?: string | null;
  has_results?: boolean;
  rows: LeagueRow[];
}

/** Our row with up to `around` rivals on each side (more below when we are top, more above when last). */
export function windowAround(rows: LeagueRow[], around = 2): LeagueRow[] {
  const i = rows.findIndex((r) => r.is_us);
  if (i < 0) return [];
  const size = Math.min(rows.length, around * 2 + 1);
  const start = Math.max(0, Math.min(i - around, rows.length - size));
  return rows.slice(start, start + size);
}

export interface Standing {
  pos: number;
  of: number;
  /** points behind the team directly above (0 when level or top) */
  gapUp: number | null;
  /** points ahead of the team directly below */
  gapDown: number | null;
  leader: string | null;
}
export function standing(rows: LeagueRow[]): Standing | null {
  const i = rows.findIndex((r) => r.is_us);
  if (i < 0) return null;
  const us = rows[i];
  return {
    pos: us.pos,
    of: rows.length,
    gapUp: i > 0 ? rows[i - 1].points - us.points : null,
    gapDown: i < rows.length - 1 ? us.points - rows[i + 1].points : null,
    leader: i > 0 ? rows[0].name : null,
  };
}

/** Club summary: how many teams are in the top half of their league. */
export function topHalf(tables: LeagueTable[]): { top: number; ranked: number } {
  let top = 0;
  let ranked = 0;
  for (const t of tables) {
    const s = t.has_results ? standing(t.rows) : null;
    if (!s) continue;
    ranked++;
    if (s.pos <= Math.ceil(s.of / 2)) top++;
  }
  return { top, ranked };
}
