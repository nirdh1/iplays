// Unit tests for the north/south area of a team name. Run: node scripts/run-os-tests.mjs
import { areaOf } from './areas';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
eq('north in middle', areaOf("הפועל רמת גן צפון · ילדים א'"), 'צפון');
eq('south at end', areaOf('הפועל רמת גן דרום'), 'דרום');
eq('hyphen', areaOf('רמת גן-מרכז ילדים ב'), 'מרכז');
eq('south+center counts as south', areaOf('הפועל רמת גן דרום מרכז'), 'דרום');
eq('no area', areaOf('הפועל רמת גן ילדים ג'), null);
eq('not part of a word', areaOf('מצפון הכדורגל'), null);
if (failed) process.exit(1);
