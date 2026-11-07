/**
 * Plays a static exercise diagram as movement: the arrows run in the order
 * they were drawn, and the player or ball at the start of each arrow moves
 * along it. No video, nothing stored: it works on every diagram, including the
 * ones coaches draw themselves.
 *
 *   pass / shot   the ball nearest to the arrow's start travels along it
 *   run           the player nearest to the start runs along it
 *   dribble       the nearest player runs along it with the ball at his feet
 *
 * A run followed by a pass that ends where the run ends plays at the same time
 * (the pass is played into the runner's path).
 */
import type { Diagram, DiagramElement, DiagramLine } from './model';

type Pt = [number, number];

export interface Step {
  lines: number[]; // indexes into diagram.lines
  start: number; // seconds
  dur: number;
  movers: { id: string; line: number; lead: number }[];
}

export interface Plan {
  steps: Step[];
  total: number;
  /** a ball added for passes in a diagram that has none; drawn only while playing */
  virtualBall: DiagramElement | null;
}

const GAP = 0.35; // pause between steps
const durOf: Record<DiagramLine['type'], number> = { pass: 0.9, shot: 0.7, run: 1.4, dribble: 1.6 };
const VBALL = '__ball';

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function lengthOf(pts: Pt[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Point at fraction f (0..1) of the polyline's length. */
export function along(pts: Pt[], f: number): Pt {
  const t = Math.min(1, Math.max(0, f));
  const total = lengthOf(pts);
  if (total === 0) return pts[0];
  let left = t * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (left <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, left / seg);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function nearest(pos: Map<string, Pt>, els: DiagramElement[], at: Pt, types: DiagramElement['type'][], within: number): string | null {
  let best: string | null = null;
  let bestD = within;
  for (const e of els) {
    if (!types.includes(e.type)) continue;
    const p = pos.get(e.id);
    if (!p) continue;
    const d = dist(p, at);
    if (d <= bestD) {
      best = e.id;
      bestD = d;
    }
  }
  return best;
}

/** Works out who moves on which arrow, and when. `reach` = how far (metres) an arrow's start may be from its mover. */
export function planAnimation(d: Diagram, reach: number): Plan {
  const els = d.elements;
  const pos = new Map<string, Pt>(els.map((e) => [e.id, [e.x, e.y] as Pt]));
  const hasBall = els.some((e) => e.type === 'ball');
  const needsBall = d.lines.some((l) => l.type === 'pass' || l.type === 'shot' || l.type === 'dribble');
  const virtualBall: DiagramElement | null = !hasBall && needsBall ? { id: VBALL, type: 'ball', x: d.lines[0].pts[0][0], y: d.lines[0].pts[0][1] } : null;
  const all = virtualBall ? [...els, virtualBall] : els;
  if (virtualBall) pos.set(VBALL, [virtualBall.x, virtualBall.y]);

  const steps: Step[] = [];
  let t = 0;
  for (let i = 0; i < d.lines.length; i++) {
    const group = [i];
    const ln = d.lines[i];
    const next = d.lines[i + 1];
    if (ln.type === 'run' && next && next.type === 'pass' && dist(next.pts[next.pts.length - 1] as Pt, ln.pts[ln.pts.length - 1] as Pt) <= reach * 1.5) {
      group.push(i + 1);
      i++;
    }
    const movers: Step['movers'] = [];
    for (const li of group) {
      const l = d.lines[li];
      const start = l.pts[0] as Pt;
      const end = l.pts[l.pts.length - 1] as Pt;
      if (l.type === 'pass' || l.type === 'shot') {
        const ball = nearest(pos, all, start, ['ball'], Infinity);
        if (ball) movers.push({ id: ball, line: li, lead: 0 });
      } else {
        const p = nearest(pos, all, start, ['player', 'gk'], reach);
        if (p) movers.push({ id: p, line: li, lead: 0 });
        if (l.type === 'dribble') {
          const ball = nearest(pos, all, start, ['ball'], reach * 2);
          if (ball) movers.push({ id: ball, line: li, lead: 0.06 });
        }
      }
      for (const m of movers.filter((m) => m.line === li)) pos.set(m.id, end);
    }
    const dur = Math.max(...group.map((li) => durOf[d.lines[li].type]));
    steps.push({ lines: group, start: t, dur, movers });
    t += dur + GAP;
  }
  return { steps, total: Math.max(0, t - GAP), virtualBall };
}

/** Diagram as it looks at time `t` seconds, plus which step is playing (-1 before the first). */
export function frameAt(d: Diagram, plan: Plan, t: number): { diagram: Diagram; step: number } {
  const pos = new Map<string, Pt>(d.elements.map((e) => [e.id, [e.x, e.y] as Pt]));
  if (plan.virtualBall) pos.set(plan.virtualBall.id, [plan.virtualBall.x, plan.virtualBall.y]);
  let step = -1;
  for (let s = 0; s < plan.steps.length; s++) {
    const st = plan.steps[s];
    if (t < st.start) break;
    step = s;
    const f = st.dur === 0 ? 1 : ease(Math.min(1, (t - st.start) / st.dur));
    for (const m of st.movers) pos.set(m.id, along(d.lines[m.line].pts as Pt[], Math.min(1, f + m.lead * (f < 1 ? 1 : 0))));
  }
  const elements = d.elements.map((e) => {
    const p = pos.get(e.id)!;
    return p[0] === e.x && p[1] === e.y ? e : { ...e, x: p[0], y: p[1] };
  });
  if (plan.virtualBall && step >= 0) {
    const p = pos.get(plan.virtualBall.id)!;
    elements.push({ ...plan.virtualBall, x: p[0], y: p[1] });
  }
  return { diagram: { ...d, elements }, step };
}

export const stepLabel: Record<DiagramLine['type'], string> = { pass: 'מסירה', run: 'ריצה', dribble: 'כדרור', shot: 'בעיטה' };
