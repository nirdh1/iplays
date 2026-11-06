# iPlays 2.0 MVP (5 days): what works and what doesn't

Branch `claude/project-thread-xrc27s`, not merged. Production unchanged.
Everything below was tested on a local Postgres that emulates Supabase
(migrations, RLS, RPCs) and in a real browser (Playwright, desktop 1280 and
phone 390). It has not yet run on the real Staging Supabase project.

## Flow that works end to end
Coach builds a session plan from library exercises (with a 4-station block),
assigns it to Sunday's training, opens "יום האימון", runs the step and station
timer, marks attendance, sends the one-minute report, and the club director's
dashboard shows one missing report fewer.

## By screen (status also in the app: "מה עובד")
| Screen | Status | Works | Not yet |
|---|---|---|---|
| קבוצות וסגל | live | staff teams, active roster, opens player card | |
| בית המאמן | live | next training, this week, reported absences, trainings with no marks | |
| יומן ונוכחות | live | 14 days back / 28 ahead, create, edit, cancel, attendance, assigned plan | |
| כרטיס שחקן | partial | attendance, appearances, goals, last coach assessment, medical "valid until" only | self assessment, goals, match feedback |
| ספריית תרגילים | partial | iPlays / club / personal libraries, search and filters, exercise page, copy, basic pitch editor (phone: basic tools) | 15 more base exercises (10 of 25), professional approval of categories and exercises, rotate players, curved lines |
| מערכי אימון | partial | builder (library exercises, stations, breaks, reorder), stations maths, assign to a training with a frozen copy | templates, duplicate plan, naming players into work groups, club methodology, plan vs actual |
| יום האימון | live | today's training and plan, step timer, stations rotation per group, attendance, one-minute report | |
| דשבורד מנהל | partial | 5 real KPIs + up to 3 priority actions, 7 / 30 days, per team | methodology, fitness and limits, tasks and delegation |

## Permissions (checked by SQL tests)
- Exercises: staff only; a parent sees nothing; the iPlays library is never edited from the app; personal exercises only by their owner; the club library is written with training level 3 at club level.
- Plans: team staff with training level ≥ 1 read, level 3 write and assign; another team's coach and the platform admin see nothing; parents and players see only the title and goal of a training's plan.
- Reports: written by training level 3 after the training started; read like plans.
- Dashboard: club owner / admin or a club-level "reports" grant.

## Numbers are real or absent
Attendance counts staff marks only (a training with no marks is not 100%).
Personal trainings are left out. A value with nothing behind it shows "—".
In Staging all data is invented and the app shows a STAGING banner.

## Tests
- SQL: `supabase/tests/test_exercise_library.sql` (13), `test_session_plans.sql` (17), `test_training_reports_dashboard.sql` (13), all pass on a fresh database built from the Staging parts.
- Unit: `node scripts/run-os-tests.mjs` (plan minutes + validation 13, timer 11).

## Staging files (in order)
Parts 1-3 and the seed (unchanged since first handed out), then add-on parts
5 (exercise library), 6 (session plans), 7 (reports and dashboard). Each part
aborts if run out of order, twice, or on a database that is not a Staging
project in progress. See `docs/v2-staging.md`.

## Before Production
P0 still applies: the read-only checks (T1, T2), a proven backup and restore,
and a separate approval for every migration.
