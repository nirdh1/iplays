// Unit tests for the diagram animation. Run: node scripts/run-os-tests.mjs
import { along, frameAt, planAnimation } from './animate';
import type { Diagram } from './model';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const r = (p: number[]) => p.map((x) => Math.round(x * 100) / 100);
const pos = (d: Diagram, id: string) => r([d.elements.find((e) => e.id === id)!.x, d.elements.find((e) => e.id === id)!.y]);

eq('along: middle of an L', r(along([[0, 0], [10, 0], [10, 10]], 0.75)), [10, 5]);
eq('along: clamps', r(along([[0, 0], [4, 0]], 2)), [4, 0]);

// player p1 with ball passes to p2, p2 dribbles, then shoots
const d: Diagram = {
  v: 1,
  elements: [
    { id: 'p1', type: 'player', x: 0, y: 0, team: 'a' },
    { id: 'b', type: 'ball', x: 0.5, y: 0 },
    { id: 'p2', type: 'player', x: 10, y: 0, team: 'a' },
    { id: 'c', type: 'cone', x: 5, y: 5 },
  ],
  lines: [
    { id: 'l1', type: 'pass', pts: [[0.5, 0], [10, 0]] },
    { id: 'l2', type: 'dribble', pts: [[10, 0], [20, 0]] },
    { id: 'l3', type: 'shot', pts: [[20, 0], [30, 0]] },
  ],
};
const plan = planAnimation(d, 3);
eq('three steps', plan.steps.length, 3);
eq('pass moves the ball', plan.steps[0].movers.map((m) => m.id), ['b']);
eq('dribble moves player and ball', plan.steps[1].movers.map((m) => m.id), ['p2', 'b']);
eq('shot moves the ball from where the dribble left it', plan.steps[2].movers.map((m) => m.id), ['b']);
eq('before start: nothing moved', pos(frameAt(d, plan, -1).diagram, 'b'), [0.5, 0]);
eq('after the pass: ball at p2', pos(frameAt(d, plan, plan.steps[0].dur).diagram, 'b'), [10, 0]);
const end = frameAt(d, plan, plan.total).diagram;
eq('end: p2 at end of dribble', pos(end, 'p2'), [20, 0]);
eq('end: ball in the goal', pos(end, 'b'), [30, 0]);
eq('end: cone never moves', pos(end, 'c'), [5, 0 + 5]);
eq('end: p1 stays', pos(end, 'p1'), [0, 0]);

// run into space + pass to the same spot play together
const d2: Diagram = {
  v: 1,
  elements: [
    { id: 'm', type: 'player', x: 0, y: 0, team: 'a' },
    { id: 'b', type: 'ball', x: 0.5, y: 0 },
    { id: 'r', type: 'player', x: 10, y: 5, team: 'a' },
  ],
  lines: [
    { id: 'l1', type: 'run', pts: [[10, 5], [20, 10]] },
    { id: 'l2', type: 'pass', pts: [[0.5, 0], [20, 10.5]] },
  ],
};
const p2 = planAnimation(d2, 3);
eq('run + pass into the run = one step', p2.steps.map((s) => s.lines), [[0, 1]]);

// a far-away arrow start moves nobody
const d3: Diagram = { v: 1, elements: [{ id: 'p', type: 'player', x: 0, y: 0 }], lines: [{ id: 'l', type: 'run', pts: [[30, 30], [40, 40]] }] };
eq('run with no player near its start: no mover', planAnimation(d3, 3).steps[0].movers, []);

// passes without a ball element get a temporary ball, only while playing
const d4: Diagram = { v: 1, elements: [{ id: 'p', type: 'player', x: 0, y: 0 }], lines: [{ id: 'l', type: 'pass', pts: [[0, 0], [8, 0]] }] };
const p4 = planAnimation(d4, 3);
eq('virtual ball exists', !!p4.virtualBall, true);
eq('virtual ball hidden before start', frameAt(d4, p4, -1).diagram.elements.length, 1);
eq('virtual ball shown and moves', pos(frameAt(d4, p4, p4.total).diagram, '__ball'), [8, 0]);
eq('no arrows: no steps', planAnimation({ v: 1, elements: [], lines: [] }, 3).steps.length, 0);
if (failed) process.exit(1);
