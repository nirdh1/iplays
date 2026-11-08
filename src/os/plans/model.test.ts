// Unit tests for plan minutes and validation. Run: node scripts/run-os-tests.mjs
import { blockMinutes, newBlock, planMinutes, validate, type Plan } from './model';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const st = (rounds: number, station: number, transition: number) => ({ ...newBlock('stations'), rounds, station_min: station, transition_min: transition });
eq('4 stations × 12 + 3 transitions × 2 = 54', blockMinutes(st(4, 12, 2)), 54);
eq('one round has no transition', blockMinutes(st(1, 10, 3)), 10);
eq('no transition time', blockMinutes(st(3, 8, 0)), 24);
eq('groups do not multiply the time', blockMinutes({ ...st(4, 10, 2), groups: 8 } as never), 46);
eq('exercise block = its duration', blockMinutes(newBlock('exercise', null, 20)), 20);
eq('break default 3', blockMinutes(newBlock('break')), 3);
eq('plan total 15 + 54 + 3 + 18 = 90', planMinutes([newBlock('exercise', null, 15), st(4, 12, 2), newBlock('break'), newBlock('exercise', null, 18)]), 90);
eq('empty plan = 0', planMinutes([]), 0);

const plan = (blocks: Plan['blocks'], title = 'מערך'): Plan => ({ id: null, team_id: 't', title, goal: '', notes: '', status: 'draft', blocks });
eq('needs a title', validate(plan([], ' ')), ['צריך שם למערך']);
eq('exercise block needs exercise or title', validate(plan([newBlock('exercise')])), ['שלב 1: בחר תרגיל או כתוב כותרת']);
const tooMany = { ...st(5, 10, 2), stations: st(5, 10, 2).stations.map((s) => ({ ...s, title: 'x' })) };
eq('rounds cannot exceed stations', validate(plan([tooMany])), ['שלב 1: יותר סבבים מתחנות']);
const ok = { ...st(4, 10, 2), stations: st(4, 10, 2).stations.map((s) => ({ ...s, title: 'x' })) };
eq('valid stations block', validate(plan([ok])), []);
eq('stations need a title or exercise', validate(plan([st(4, 10, 2)])), ['שלב 1: לכל תחנה צריך תרגיל או כותרת']);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
