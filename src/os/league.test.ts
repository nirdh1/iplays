// Unit tests for the league comparison. Run: node scripts/run-os-tests.mjs
import { standing, topHalf, windowAround, type LeagueRow } from './league';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const rows = (n: number, us: number): LeagueRow[] =>
  Array.from({ length: n }, (_, i) => ({ pos: i + 1, name: `T${i + 1}`, played: 10, points: 30 - i * 2, is_us: i + 1 === us }));

eq('window middle', windowAround(rows(10, 5)).map((r) => r.pos), [3, 4, 5, 6, 7]);
eq('window top', windowAround(rows(10, 1)).map((r) => r.pos), [1, 2, 3, 4, 5]);
eq('window bottom', windowAround(rows(10, 10)).map((r) => r.pos), [6, 7, 8, 9, 10]);
eq('window small league', windowAround(rows(3, 2)).map((r) => r.pos), [1, 2, 3]);
eq('window not in table', windowAround(rows(5, 0)), []);
eq('standing middle', standing(rows(10, 5)), { pos: 5, of: 10, gapUp: 2, gapDown: 2, leader: 'T1' });
eq('standing top', standing(rows(10, 1)), { pos: 1, of: 10, gapUp: null, gapDown: 2, leader: null });
eq('top half counts only tables with results', topHalf([
  { has_results: true, rows: rows(10, 3) },
  { has_results: true, rows: rows(10, 8) },
  { has_results: false, rows: rows(10, 1) },
  { has_results: true, rows: rows(10, 0) },
]), { top: 1, ranked: 2 });
eq('odd league: middle counts as top half', topHalf([{ has_results: true, rows: rows(9, 5) }]), { top: 1, ranked: 1 });

if (failed) process.exit(1);
