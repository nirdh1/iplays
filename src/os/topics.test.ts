// Unit tests for the "what are we working on today" filter. Run: node scripts/run-os-tests.mjs
import { byTopics } from './topics';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const rows = [
  { id: 'a', topics: ['passing'] },
  { id: 'b', topics: ['depth_pass', 'scanning'] },
  { id: 'c', topics: [] },
  { id: 'd', topics: ['depth_pass'] },
];
const ids = (r: { id: string }[]) => r.map((x) => x.id);
eq('no topic chosen: all rows, same order', ids(byTopics(rows, [])), ['a', 'b', 'c', 'd']);
eq('one topic: only matching rows', ids(byTopics(rows, ['depth_pass'])), ['b', 'd']);
eq('two topics: best match first', ids(byTopics(rows, ['scanning', 'depth_pass'])), ['b', 'd']);
eq('ties keep the original order', ids(byTopics(rows, ['passing', 'depth_pass'])), ['a', 'b', 'd']);
eq('rows without topics never match a chosen topic', ids(byTopics(rows, ['gk'])), []);
if (failed) process.exit(1);
