/**
 * Cockpit insights (phase A). Pure functions over the dashboard RPCs, so they
 * can be unit-tested and so every insight has a stable key that matches the
 * server's intervention key (kind + team id, or kind + 'club').
 * See supabase/migrations/20261111100000_club_interventions.sql.
 */

/** club_dashboard(): supabase/migrations/20261106400000_training_reports_dashboard.sql */
export interface TeamRow {
  team_id: string;
  name: string;
  held: number;
  held_marked: number;
  marked_cells: number;
  came: number;
  attendance_pct: number | null;
  missing_reports: number;
  upcoming: number;
  upcoming_no_plan: number;
  held_no_plan: number;
}
export interface Dash {
  days: number;
  generated_at: string;
  teams: TeamRow[];
  totals: { held: number; marked_cells: number; attendance_pct: number | null; missing_reports: number; upcoming: number; upcoming_no_plan: number; new_club_exercises: number };
}

/** club_team_results(): supabase/migrations/20261109200000_club_team_results.sql */
export interface TeamResult {
  team_id: string;
  name: string;
  linked: boolean;
  league_name: string | null;
  has_results: boolean;
  league_teams: number;
  last_result_at: string | null;
  pos: number | null;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  form: string;
  ifa_coach: string | null;
  app_coaches: string[];
}

/** club_trends(): supabase/migrations/20261109400000_club_trends_drills.sql */
export interface Week {
  start: string;
  held: number;
  attendance_pct: number | null;
  plan_pct: number | null;
  report_pct?: number | null;
}
export interface Trends {
  weeks: Week[];
  teams: { team_id: string; name: string; weeks: Week[] }[];
}

/** The part of a drill-transfer suggestion an insight needs. */
export interface TransferLike {
  from: { name: string; teamIds: string[] };
  to: { name: string; teamIds: string[] };
  drills: { exercise_id: string; title: string }[];
}

/* ---------- numbers ---------- */

const FORM_PTS: Record<string, number> = { W: 3, D: 1, L: 0 };

export function formPpg(form: string): number | null {
  return form ? [...form].reduce((s, c) => s + (FORM_PTS[c] ?? 0), 0) / form.length : null;
}
/** Last-5 points per game against the season's: up / down / steady. */
export function trend(r: TeamResult): 'up' | 'down' | 'flat' | null {
  const season = r.played ? r.points! / r.played : null;
  const recent = formPpg(r.form);
  if (season === null || recent === null || (r.played ?? 0) < 4) return null;
  if (recent - season >= 0.4) return 'up';
  if (season - recent >= 0.4) return 'down';
  return 'flat';
}
export const pctOf = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);
export const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
/** Weeks that had trainings, newest last. */
export function heldWeeks(ws: Week[]) {
  return ws.filter((w) => w.held > 0);
}
/** Change between the average of the last 2 active weeks and the 2 before them. */
export function delta(ws: Week[], key: 'attendance_pct' | 'plan_pct' | 'report_pct'): number | null {
  const h = heldWeeks(ws);
  if (h.length < 3) return null;
  const now = avg(h.slice(-2).map((w) => w[key]));
  const before = avg(h.slice(-4, -2).map((w) => w[key]));
  return now === null || before === null ? null : Math.round(now - before);
}

/* ---------- insights ---------- */

/** Same kinds as club_interventions.kind on the server. */
export type InsightKind = 'missing_marks' | 'attendance_drop' | 'results_down' | 'missing_reports' | 'no_plan' | 'drill_transfer';

export interface Insight {
  /** kind + ':' + team id or 'club'; the server builds the same key */
  key: string;
  kind: InsightKind;
  teamId: string | null;
  level: 'critical' | 'warn' | 'chance';
  /** what happened (headline) */
  title: string;
  /** the fact behind it, with numbers */
  what: string;
  /** why it matters */
  why: string;
  /** what to do */
  todo: string;
  cta: string;
  href: string;
  /** extra facts the server stores (drill transfer: exercise ids, source team) */
  context?: Record<string, unknown>;
}

export const insightKey = (kind: InsightKind, teamId: string | null) => `${kind}:${teamId ?? 'club'}`;

/** Every insight we can back with real data, most urgent first (not yet cut to 3). */
export function allInsights(dash: Dash, results: TeamResult[], trends: Trends | null, transfer: TransferLike | null): Insight[] {
  const out: Insight[] = [];
  const noMarks = dash.teams.filter((x) => x.held > x.held_marked);
  if (noMarks.length) {
    const n = noMarks.reduce((s, x) => s + x.held - x.held_marked, 0);
    out.push({
      key: insightKey('missing_marks', null), kind: 'missing_marks', teamId: null, level: 'critical',
      title: `נוכחות לא סומנה ב־${n} אימונים`,
      what: `ב־${dash.days} הימים האחרונים ${n} אימונים שהתקיימו בלי אף סימון נוכחות. קבוצות: ${noMarks.map((x) => x.name).join(', ')}.`,
      why: 'בלי סימון אי אפשר לדעת מי מגיע ומי נושר, וכל מדד הנוכחות במועדון לא אמין.',
      todo: 'לבקש מהמאמנים לסמן נוכחות בסוף כל אימון, ולבדוק שוב בעוד שבועיים.',
      cta: 'ללוח האימונים', href: '#os/calendar',
    });
  }
  // a team whose attendance dropped 10+ points over the last weeks
  const drops = (trends?.teams ?? [])
    .map((t) => ({ t, d: delta(t.weeks, 'attendance_pct') }))
    .filter((x) => x.d !== null && x.d <= -10)
    .sort((a, b) => a.d! - b.d!);
  if (drops.length) {
    const { t, d } = drops[0];
    out.push({
      key: insightKey('attendance_drop', t.team_id), kind: 'attendance_drop', teamId: t.team_id, level: 'critical',
      title: `הנוכחות ב${t.name} יורדת`,
      what: `ירידה של ${-d!} נקודות בשבועיים האחרונים לעומת השבועיים שלפניהם (מסימוני הצוות).`,
      why: 'ירידה מתמשכת בנוכחות היא סימן מוקדם לנשירה של ילדים.',
      todo: 'שיחה עם המאמן על הסיבה (שעה, עומס, אווירה) ופנייה להורים של מי שהפסיק להגיע.',
      cta: 'לפרטי הקבוצה', href: '#os/calendar',
    });
  }
  const falling = results.filter((r) => trend(r) === 'down');
  if (falling.length) {
    const r = falling[0];
    const recent = formPpg(r.form);
    const season = r.played ? r.points! / r.played : null;
    out.push({
      key: insightKey('results_down', r.team_id), kind: 'results_down', teamId: r.team_id, level: 'warn',
      title: `${r.name} במגמת ירידה במשחקים`,
      what: `ב־${r.form.length} המשחקים האחרונים ${recent!.toFixed(1)} נקודות למשחק, לעומת ${season!.toFixed(1)} בעונה כולה (טבלת ההתאחדות).${falling.length > 1 ? ` עוד ${falling.length - 1} קבוצות באותו מצב.` : ''}`,
      why: 'ירידה בתוצאות אחרי פתיחה טובה מצביעה לרוב על עומס, פציעות או תוכנית אימון שלא מתאימה לשלב העונה.',
      todo: 'לצפות באימון, לעבור עם המאמן על תוכנית השבועות הקרובים ועל נושאי האימון.',
      cta: 'למאזנים', href: '#os/dashboard',
    });
  }
  if (transfer && transfer.drills.length && transfer.to.teamIds[0]) {
    out.push({
      key: insightKey('drill_transfer', transfer.to.teamIds[0]), kind: 'drill_transfer', teamId: transfer.to.teamIds[0], level: 'chance',
      title: `להעביר תרגילים מ${transfer.from.name} ל${transfer.to.name}`,
      what: `${transfer.drills.length} תרגילים ש${transfer.from.name} משתמש בהם הכי הרבה ו${transfer.to.name} עוד לא ניסה: ${transfer.drills.map((d) => d.title).join(', ')}.`,
      why: 'העברת ידע בין מאמנים היא הדרך הזולה והמהירה לשפר אימון.',
      todo: `לבקש מ${transfer.to.name} לשלב את התרגילים בשבועיים הקרובים, ואם אפשר לצפות באימון של ${transfer.from.name}.`,
      cta: 'לתרגילים', href: `#os/library/${transfer.drills[0].exercise_id}`,
      context: { exercise_ids: transfer.drills.map((d) => d.exercise_id), from_team_id: transfer.from.teamIds[0] ?? null },
    });
  }
  const byMissing = [...dash.teams].filter((x) => x.missing_reports > 0).sort((a, b) => b.missing_reports - a.missing_reports);
  if (byMissing.length) {
    out.push({
      key: insightKey('missing_reports', null), kind: 'missing_reports', teamId: null, level: 'warn',
      title: `${dash.totals.missing_reports} אימונים בלי דוח`,
      what: `הכי הרבה חסרים: ${byMissing[0].name} (${byMissing[0].missing_reports}).`,
      why: 'דוח של דקה בסוף אימון הוא מה שמראה למנהל מה עובד ומה לא.',
      todo: 'להזכיר למאמנים את הדוח בסוף אימון במסך "יום האימון", ולבדוק שוב בעוד שבועיים.',
      cta: 'למצב אימון', href: '#os/day',
    });
  }
  const noPlan = dash.teams.filter((x) => x.upcoming_no_plan > 0).sort((a, b) => b.upcoming_no_plan - a.upcoming_no_plan);
  if (noPlan.length) {
    out.push({
      key: insightKey('no_plan', null), kind: 'no_plan', teamId: null, level: 'warn',
      title: `${dash.totals.upcoming_no_plan} אימונים קרובים בלי מערך`,
      what: `הכי הרבה: ${noPlan[0].name} (${noPlan[0].upcoming_no_plan}).`,
      why: 'אימון בלי מערך הוא אימון מאולתר, וקשה לבדוק אחריו מה עבד.',
      todo: 'לבקש מהמאמנים לשייך מערך לכל אימון של השבוע הבא.',
      cta: 'לבניית מערך', href: '#os/plans',
    });
  }
  const rank = { critical: 0, warn: 1, chance: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** The three for the decision hub: urgent first, keeping one opportunity when there is one. */
export function topInsights(all: Insight[]): Insight[] {
  const chance = all.find((a) => a.level === 'chance');
  const top = all.filter((a) => a !== chance).slice(0, chance ? 2 : 3);
  return chance ? [...top, chance] : top;
}

/* ---------- setup guide ---------- */

export interface SetupStep {
  id: 'teams' | 'areas' | 'coaches' | 'attendance' | 'plans' | 'reports';
  label: string;
  /** what is there now, in numbers */
  detail: string;
  done: boolean;
  href: string;
  cta: string;
}

/**
 * What the club still needs so the cockpit shows the full picture
 * (user 2026-11-11: "אין דשבורד שמציג מה שדיברנו"). Each step is computed from
 * the same real numbers as the cockpit; nothing is assumed.
 */
export function setupSteps(dash: Dash, results: TeamResult[], areaOfName: (name: string) => string | null): SetupStep[] {
  const teams = dash.teams;
  const steps: SetupStep[] = [];
  steps.push({
    id: 'teams', label: 'לשייך את קבוצות המועדון', cta: 'לחיפוש ושיוך',
    href: '#os/setup', done: teams.length >= 2,
    detail: teams.length === 0 ? 'עדיין אין קבוצות משויכות' : `משויכות ${teams.length} קבוצות`,
  });
  const areas = [...new Set(teams.map((t) => areaOfName(t.name)).filter((a): a is string => !!a))];
  if (areas.length > 0 || teams.length === 0) {
    steps.push({
      id: 'areas', label: 'קבוצות מכמה אזורים (צפון, דרום) לתחרות', cta: 'לשיוך קבוצות',
      href: '#os/setup', done: areas.length >= 2,
      detail: areas.length ? `יש קבוצות מ: ${areas.join(', ')}` : 'אין עדיין קבוצות עם אזור בשם',
    });
  }
  const withCoach = results.filter((r) => r.app_coaches.length > 0).length;
  steps.push({
    id: 'coaches', label: 'המאמנים מחוברים לאפליקציה', cta: 'להזמנת מאמנים',
    href: '#os/setup/coaches', done: teams.length > 0 && withCoach >= teams.length,
    detail: teams.length ? `${withCoach} מתוך ${teams.length} קבוצות עם מאמן רשום` : 'אין קבוצות',
  });
  const held = teams.reduce((s, t) => s + t.held, 0);
  const marked = teams.reduce((s, t) => s + t.held_marked, 0);
  steps.push({
    id: 'attendance', label: 'המאמנים מסמנים נוכחות', cta: 'ליומן',
    href: '#os/calendar', done: held > 0 && marked === held,
    detail: held === 0 ? `לא התקיימו אימונים ב־${dash.days} הימים האחרונים` : `${marked} מתוך ${held} אימונים סומנו`,
  });
  const upcoming = teams.reduce((s, t) => s + t.upcoming, 0);
  const noPlan = teams.reduce((s, t) => s + t.upcoming_no_plan, 0);
  steps.push({
    id: 'plans', label: 'לכל אימון קרוב יש מערך', cta: 'למערכי אימון',
    href: '#os/plans', done: upcoming > 0 && noPlan === 0,
    detail: upcoming === 0 ? 'אין אימונים ביומן לשבוע הקרוב' : `${upcoming - noPlan} מתוך ${upcoming} עם מערך`,
  });
  const missing = teams.reduce((s, t) => s + t.missing_reports, 0);
  steps.push({
    id: 'reports', label: 'דוח של דקה אחרי כל אימון', cta: 'ליום האימון',
    href: '#os/day', done: held > 0 && missing === 0,
    detail: held === 0 ? 'אין עדיין אימונים לדווח עליהם' : `${held - missing} מתוך ${held} עם דוח`,
  });
  return steps;
}
