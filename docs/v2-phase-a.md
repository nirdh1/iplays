# iPlays 2.0, phase A: decision cockpit and interventions (Staging)

Approved by the user on 2026-11-11, for **Staging only**. Production is untouched: no deploy and no SQL there.

## What was built

**Cockpit (`#os/dashboard`, "קוקפיט מנהל")** has the three Stitch areas. It uses the existing `DashboardScreen` components and metric functions.

| Area | What it shows | Data source |
|---|---|---|
| B. Decision hub | Three insights, each with "what happened / why it matters / what to do" and one linked intervention | `club_dashboard`, `club_trends`, `club_team_results`, `club_drill_usage` |
| A. Pitches today | Today's trainings, marked **planned only**; no live status until phase C | `club_today_sessions` (calendar) |
| C. Trends and results | Pulse, north vs south, team cards, coach comparison, 8-week trends, drill transfer | unchanged |

**Interventions (`#os/interventions`, `#os/interventions/<id>`)** cover the life cycle identify → decide → act → check → result:

- owner, due date and action plan;
- before/after with a causality caveat;
- an action log;
- close with an outcome and a written professional conclusion of at least 10 characters;
- cancel with a reason. Nothing is ever deleted.

## Database

The migration is `supabase/migrations/20261111100000_club_interventions.sql`, with a rollback in `supabase/rollback/`. It is additive only: two new tables and new functions.

- **Data model**
  - `club_interventions` holds owner, status, due date, baseline metric, current metric, outcome and conclusion.
  - `club_intervention_log` records every action.
- **Duplicates**
  - The server builds the insight key: kind + team, or kind + `club`.
  - A unique partial index allows one open intervention per insight. Opening it again returns the open one.
- **Metrics**
  - The server measures them from real rows only. With no data the value is null ("אין נתון"), never 0.
  - The client cannot set or choose the metric.
- **Permissions (RLS + security-definer RPCs)**
  - Clients cannot write to the tables directly.
  - **See:** club owner/admin and the club "reports" grant see all; a team's professional staff (coach, assistant, instructor) see their team's; the owner sees their own. Parents, players and other clubs see nothing.
  - **Change:**

    | Action | Who |
    |---|---|
    | Open, assign, set due date, close, cancel | owner/admin, or "reports" level 3 |
    | Note, in progress / for checking, re-measure | the owner and the team's professional staff |

## Staging SQL (run in the Staging SQL Editor only)

1. `supabase/staging/addon-parts/staging-part-11-dashboard-metrics.sql`
   - Requires part 9.
   - Adds the dashboard functions that were not in Staging yet: results, trends, drills, derby, goal alerts and adopt info.
2. `supabase/staging/addon-parts/staging-part-12-interventions.sql`
   - Requires part 11.

Both parts abort when the database is not Staging, or when they already ran.

## Tests

| Suite | Command | Result |
|---|---|---|
| SQL permissions, duplicates, missing data | `psql -d <staging copy> -f supabase/tests/test_club_interventions.sql` | 54/54 |
| Unit: insights | `node scripts/run-os-tests.mjs` | all pass |
| End-to-end: navigation, roles, missing data | `PGDB=<db> node tests/e2e/phaseA.cjs` (local Postgres + `minirest.cjs`; build with `VITE_SUPABASE_URL=http://stg.local`, served on :4324) | 64/64 |
| Staging parts in order on a fresh database | parts 1-9, 11, 12, then 10 | OK; part 12 again aborts; a non-Staging database aborts |

## Screens

- `docs/v2-screens/phaseA-cockpit-desktop.png`
- `docs/v2-screens/phaseA-cockpit-phone.png`
- `docs/v2-screens/phaseA-intervention-phone.png`
- `docs/v2-screens/phaseA-intervention-closed-desktop.png`
- `docs/v2-screens/phaseA-empty-club-desktop.png`

## Gaps left

- **Live pitches:** live status (who is on the pitch now, coach arrived) needs pitches + staff check-in (phase C).
- **Manual interventions:** only interventions opened from an insight; there is no free-text intervention without one.
- **Notifications:** none when an intervention is assigned or overdue (in-app only).
- **Insight scope:** insights are computed in the browser from the dashboard RPCs, and the server only re-checks the kind/team. A server-side insight list would be needed for alerts outside the app.
- **Results metric:** `form_ppg` depends on the IFA league table imported by the user; without it the result is "no data".
- **Production:** needs its own guarded parts, separate approval, PR #90 merged and production parts 8-11 run first.
