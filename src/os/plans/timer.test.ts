// Unit tests for the training-day timer. Run: node scripts/run-os-tests.mjs
import { clock, stationFor, stationPhase } from './timer';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
// 4 rounds × 12 min + 3 × 2 min transitions = 54 min
eq('start: round 1 station', stationPhase(0, 4, 12, 2), { round: 1, transition: false, remainingSec: 720, done: false });
eq('12:00 → first transition', stationPhase(720, 4, 12, 2), { round: 1, transition: true, remainingSec: 120, done: false });
eq('14:00 → round 2', stationPhase(840, 4, 12, 2), { round: 2, transition: false, remainingSec: 720, done: false });
eq('last round has no transition after it', stationPhase(54 * 60 - 1, 4, 12, 2), { round: 4, transition: false, remainingSec: 1, done: false });
eq('54:00 → done', stationPhase(54 * 60, 4, 12, 2).done, true);
eq('zero transition skips straight on', stationPhase(600, 3, 10, 0), { round: 2, transition: false, remainingSec: 600, done: false });
eq('group 0 round 1 → station 0', stationFor(0, 1, 4), 0);
eq('group 3 round 2 → station 0 (wraps)', stationFor(3, 2, 4), 0);
eq('every group visits every station once', [0, 1, 2, 3].map((g) => [1, 2, 3, 4].map((r) => stationFor(g, r, 4)).sort().join('')), ['0123', '0123', '0123', '0123']);
eq('clock 125s', clock(125), '2:05');
eq('clock never negative', clock(-3), '0:00');
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
