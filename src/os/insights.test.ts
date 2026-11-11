// Unit tests for the cockpit insights. Run: node scripts/run-os-tests.mjs
import { allInsights, delta, insightKey, setupSteps, topInsights, trend, type Dash, type TeamResult, type TeamRow, type Trends } from './insights';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const row = (id: string, o: Partial<TeamRow> = {}): TeamRow => ({
  team_id: id, name: `קבוצה ${id}`, held: 3, held_marked: 3, marked_cells: 30, came: 25, attendance_pct: 83,
  missing_reports: 0, upcoming: 2, upcoming_no_plan: 0, held_no_plan: 0, ...o,
});
const dash = (teams: TeamRow[]): Dash => ({
  days: 7, generated_at: '2026-11-11T10:00:00Z', teams,
  totals: {
    held: teams.reduce((s, t) => s + t.held, 0), marked_cells: 0, attendance_pct: null,
    missing_reports: teams.reduce((s, t) => s + t.missing_reports, 0), upcoming: 0,
    upcoming_no_plan: teams.reduce((s, t) => s + t.upcoming_no_plan, 0), new_club_exercises: 0,
  },
});
const result = (id: string, o: Partial<TeamResult> = {}): TeamResult => ({
  team_id: id, name: `קבוצה ${id}`, linked: true, league_name: 'ליגה', has_results: true, league_teams: 12,
  last_result_at: null, pos: 3, played: 10, won: 6, drawn: 2, lost: 2, goals_for: 20, goals_against: 10,
  points: 20, form: 'WWDLW', ifa_coach: null, app_coaches: [], ...o,
});
const wk = (held: number, att: number | null) => ({ start: '2026-10-01', held, attendance_pct: att, plan_pct: null });

// healthy club with no data problems -> no insights (never invented)
eq('healthy club: no insights', allInsights(dash([row('a'), row('b')]), [result('a'), result('b')], null, null).length, 0);
// empty club: no teams, no results -> no insights, no crash
eq('empty club: no insights', allInsights(dash([]), [], null, null).length, 0);

// keys are stable and match the server (kind + team or club)
eq('club key', insightKey('missing_marks', null), 'missing_marks:club');
eq('team key', insightKey('attendance_drop', 'T1'), 'attendance_drop:T1');

// missing marks + missing reports + no plan are club-wide
const problems = dash([row('a', { held: 4, held_marked: 2, missing_reports: 3, upcoming_no_plan: 2 }), row('b')]);
const ins = allInsights(problems, [], null, null);
eq('club-wide kinds', ins.map((i) => i.key), ['missing_marks:club', 'missing_reports:club', 'no_plan:club']);
eq('missing marks counts trainings', ins[0].title, 'נוכחות לא סומנה ב־2 אימונים');
eq('every insight has what/why/todo', ins.every((i) => i.what && i.why && i.todo), true);
eq('unique keys', new Set(ins.map((i) => i.key)).size, ins.length);

// attendance drop of 10+ points needs at least 3 weeks with trainings
const trends: Trends = {
  weeks: [],
  teams: [
    { team_id: 'a', name: 'א', weeks: [wk(2, 90), wk(2, 90), wk(2, 70), wk(2, 72)] },
    { team_id: 'b', name: 'ב', weeks: [wk(0, null), wk(0, null), wk(2, 60), wk(2, 40)] },
  ],
};
eq('delta a', delta(trends.teams[0].weeks, 'attendance_pct'), -19);
eq('delta b: too few weeks', delta(trends.teams[1].weeks, 'attendance_pct'), null);
const drop = allInsights(dash([row('a'), row('b')]), [], trends, null);
eq('attendance drop is per team', drop.map((i) => i.key), ['attendance_drop:a']);

// results trend: needs 4+ games; down = recent 0.4 below the season
eq('trend down', trend(result('a', { played: 10, points: 22, form: 'LLDLW' })), 'down');
eq('trend unknown with 3 games', trend(result('a', { played: 3, points: 9, form: 'WWW' })), null);
const falling = allInsights(dash([row('a')]), [result('a', { played: 10, points: 22, form: 'LLDLW' })], null, null);
eq('results insight', falling.map((i) => [i.key, i.teamId]), [['results_down:a', 'a']]);

// drill transfer keeps the exercise ids for the server
const transfer = { from: { name: 'מאמן א', teamIds: ['a'] }, to: { name: 'מאמן ב', teamIds: ['b'] }, drills: [{ exercise_id: 'E1', title: 'רונדו' }] };
const tr = allInsights(dash([row('a'), row('b')]), [], null, transfer);
eq('transfer key', tr[0].key, 'drill_transfer:b');
eq('transfer context', tr[0].context, { exercise_ids: ['E1'], from_team_id: 'a' });

// top three keeps one opportunity, urgent first
const many = allInsights(problems, [], trends, transfer);
const top = topInsights(many);
eq('top 3 size', top.length, 3);
eq('top 3 keeps the chance last', top.map((i) => i.level), ['critical', 'critical', 'chance']);
eq('top without chance', topInsights(ins).map((i) => i.kind), ['missing_marks', 'missing_reports', 'no_plan']);

// setup guide: from real numbers only
const area = (n: string) => (n.includes('צפון') ? 'צפון' : n.includes('דרום') ? 'דרום' : null);
const one = setupSteps(dash([row('a', { name: 'טרום ב צפון', held: 2, held_marked: 0, missing_reports: 2, upcoming: 0, upcoming_no_plan: 0 })]), [result('a')], area);
eq('one team: steps', one.map((s) => `${s.id}:${s.done}`), ['teams:false', 'areas:false', 'coaches:false', 'attendance:false', 'plans:false', 'reports:false']);
eq('one team: area detail', one[1].detail, 'יש קבוצות מ: צפון');
eq('one team: attendance detail', one[3].detail, '0 מתוך 2 אימונים סומנו');
const full = setupSteps(
  dash([row('a', { name: 'צפון' }), row('b', { name: 'דרום' })]),
  [result('a', { app_coaches: ['x'] }), result('b', { app_coaches: ['y'] })], area);
eq('full club: all done', full.every((s) => s.done), true);
const noArea = setupSteps(dash([row('a'), row('b')]), [], area);
eq('no area words: no area step', noArea.some((s) => s.id === 'areas'), false);
eq('empty club: nothing done', setupSteps(dash([]), [], area).filter((s) => s.done).length, 0);

if (failed) process.exit(1);
