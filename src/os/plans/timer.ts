/**
 * Training-day timer maths, pure so it can be unit tested.
 * A stations block runs: station, transition, station, ..., station
 * (rounds stations and rounds − 1 transitions, as in blockMinutes()).
 */
export interface StationPhase {
  round: number; // 1-based
  transition: boolean;
  remainingSec: number; // in the current phase
  done: boolean;
}

export function stationPhase(elapsedSec: number, rounds: number, stationMin: number, transitionMin: number): StationPhase {
  const st = stationMin * 60;
  const tr = transitionMin * 60;
  let t = Math.max(0, elapsedSec);
  for (let r = 1; r <= rounds; r++) {
    if (t < st) return { round: r, transition: false, remainingSec: st - t, done: false };
    t -= st;
    if (r === rounds) break;
    if (t < tr) return { round: r, transition: true, remainingSec: tr - t, done: false };
    t -= tr;
  }
  return { round: rounds, transition: false, remainingSec: 0, done: true };
}

/** Station (0-based) that work group `group` (0-based) is at in round `round` (1-based). */
export const stationFor = (group: number, round: number, stations: number) => (group + round - 1) % stations;

export function clock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
