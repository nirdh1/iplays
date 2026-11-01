# iplays — backend setup (Supabase + Render)

Without these settings the app runs in **demo mode**: fictional data, no login.
With them, users sign in, open or join teams and add their children.

## 1. Create a Supabase project

Use a **separate project for iplays** (don't reuse a project that belongs to another app).

1. supabase.com → **New project** → name `iplays`, region close to Israel (e.g. Frankfurt).
2. **SQL Editor** → paste the whole file
   [`supabase/migrations/20261031000000_init.sql`](../supabase/migrations/20261031000000_init.sql) → **Run**.
   It creates the tables, Row Level Security policies and the functions the app calls.

## 2. Turn on login

**Authentication → Sign In / Providers**

- **Email** (free, recommended to start): keep it enabled.
  Then **Authentication → Emails → Templates → Magic Link** and put the code in the email,
  for example:

  ```html
  <h2>קוד הכניסה שלך ל-iplays</h2>
  <p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
  <p>הקוד תקף לשעה.</p>
  ```

  Supabase's built-in mailer is rate-limited (a few emails per hour). Before inviting real
  parents, add your own SMTP under **Authentication → Emails → SMTP Settings** (e.g. Resend).

- **Phone / SMS** (optional, paid): enable **Phone** and connect an SMS provider
  (Twilio, MessageBird, Vonage or Textlocal). The login screen shows email only; once SMS works,
  add `VITE_ENABLE_SMS=true` to the site's environment variables and redeploy to show the phone tab.

**Authentication → URL Configuration → Site URL**: your site address, e.g.
`https://iplays.vercel.app`. Under **Redirect URLs** add every address the app runs on
(`https://iplays.onrender.com/**`, `https://iplays.vercel.app/**`, `https://*-nirhq.vercel.app/**`).

**Home screen**: the site is installable (`public/manifest.webmanifest`). The login and home screens
show a "save to home screen" hint until it is installed or closed.

## 3. Connect the site (Render)

1. Supabase → **Connect** (or **Project Settings → API**) → copy **Project URL** and the
   **anon / publishable key**. Never use the `service_role` key in the app.
2. Render → your static site → **Environment** → add:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon key |

3. **Manual Deploy → Deploy latest commit** (Vite reads these at build time).

For local development put the same two lines in `.env.local`.

## How it works

- **Sign in**: phone or email → 6-digit one-time code. No passwords.
- **Coach / team manager**: opens a team and gets an invite code + link (`/#join/CODE`) to send on WhatsApp.
- **Parent**: opens the link (or types the code), signs in, joins, adds their child
  (name, shirt number, birth year) — or taps **"זה הילד שלי"** on a player the coach already added.
- **Privacy**: everything is protected by Row Level Security. People only see teams they belong to;
  only staff can edit the roster or create invites; parents can edit their own child.

## Data model

| Table | What |
|---|---|
| `profiles` | one row per user (name, phone/email) |
| `teams` | team, club, season, sport |
| `team_members` | who belongs to which team, role `admin` / `coach` / `parent` |
| `invites` | 6-character invite codes (60-day expiry) |
| `players` | the roster, shirt numbers unique per team |
| `player_guardians` | which parent belongs to which child |

Next steps: matches, trainings, carpools and the team fund move from demo data to these tables.

## Clubs, programs and transfers (migration `20261101200000_clubs_and_assignments.sql`)

A **club** holds two **programs**, league (`ליגה`) and academy (`אקדמיה`), and each team belongs to
one program. A **player** is one profile for the whole career. Team membership lives in
`player_assignments`, so a child can be in the academy and in a league team at the same time.
Moving between programs closes one assignment and opens another, and is recorded in
`player_transfers` and `audit_log`. Nothing is deleted: teams and players can't be deleted from the
app any more (archive instead).

| Table | What |
|---|---|
| `clubs` | club, city, status `draft` / `pending_verification` / `verified` / `suspended` |
| `club_programs` | league / academy programs of a club |
| `club_staff` | club owner / admin / staff |
| `club_claims` | verification requests, reviewed by the platform team |
| `platform_admins` | iplays platform admins (super admin) |
| `audit_log` | who did what (club actions, transfers) |
| `player_assignments` | player ↔ team, shirt number, main team, start / end dates |
| `player_transfers` | history of moves, parallel joins and exits |

`players.team_id` and `players.shirt_number` stay and always mirror the player's main team, so older
screens keep working.

### Running it (in this order)

1. **Back up first**: Supabase → Database → Backups (or export the tables).
2. SQL Editor → run [`20261101100000_coach.sql`](../supabase/migrations/20261101100000_coach.sql)
   (the coach board), if you haven't yet.
3. SQL Editor → run [`20261101200000_clubs_and_assignments.sql`](../supabase/migrations/20261101200000_clubs_and_assignments.sql).
   It runs as one transaction and ends with a check that prints
   `iplays M1+M2: N players backfilled, M clubs created`. If anything fails, nothing changes.
4. Make yourself platform admin (put your login email):
   ```sql
   insert into public.platform_admins (user_id, note)
   select id, 'owner' from auth.users where email = 'you@example.com';
   ```

Existing teams that had a club name typed in get a **draft club** owned by the person who created
the team, with the team in the league program. Clubs are not merged by name automatically.

**Rollback**: [`supabase/rollback/20261101200000_clubs_and_assignments.down.sql`](../supabase/rollback/20261101200000_clubs_and_assignments.down.sql)
removes only what this migration added and restores the previous policies. Players, teams,
trainings and absences stay. A second, parallel team of a player is lost on rollback.

**Tests**: `supabase/tests/run.sh` runs both migrations, the RLS tests (club isolation, transfers,
history, permissions), the rollback and a re-apply on a throwaway local Postgres:
`PGHOST=… PGPORT=… PGUSER=postgres supabase/tests/run.sh`.

## Permission tree (migration `20261101300000_permissions.sql`)

All access goes through one database function, `can(team, domain, level)`. Levels: 1 view, 2 create,
3 edit, 4 manage. A person gets the **highest** of:

1. **Club owner / admin**: everything in their club.
2. **Explicit grants** (`permission_grants`), given by a club admin on the whole club, one program
   (league / academy, which covers all of its teams) or one team.
3. **Role in the team** (`team_members.role`) → default levels:

| Domain | coach | assistant_coach | instructor | team_manager |
|---|---|---|---|---|
| roster (סגל) | edit | view | view | edit |
| training | manage | edit | edit | edit |
| matches | manage | edit | – | view |
| attendance | manage | edit | edit | edit |
| metrics | manage | edit | edit | – |
| communication | manage | create | create | manage |
| finance | view | – | – | edit |
| equipment | view | – | – | edit |
| medical | view | view | view | edit |
| staff / invites | edit | – | – | create |
| reports | view | – | – | view |

The team `admin` (whoever opened the team) manages everything in the team. Parents get access only
to their own children.

Every RLS policy for teams, members, invites, players, trainings, announcements and absences now asks
`can()` for the matching domain. So a coach of one team can't see another team unless a club admin
gave them a grant. Moving players needs roster **manage**, which by default only club admins have.

Club staff join with a one-time link `#staff/CODE` (14 days), created in **ניהול מועדון → צוות**.

Run order: `20261101300000_permissions.sql` after `20261101200000_clubs_and_assignments.sql`.
Rollback: `supabase/rollback/20261101300000_permissions.down.sql`. It turns the new roles into
`coach` and removes the grants.

## Search, join requests, shirt numbers and kit (migration `20261101400000_search_and_join_requests.sql`)

**Open search** (owner decision): any signed-in user can search a child by name and birth year (league
and academy) and see the child's team and club, or search a club by name or city and see its teams by
birth year. Results show only the name, birth year, team, club and program. Training times, places,
contact details and everything else stay visible only to team members.

**Joining** happens on the team page, `#t/<team id>`. Any member can share it on WhatsApp from
**ניהול הקבוצה → שליחת דף הקבוצה להורים**, and every search result leads to it.

* **Parent**: picks "זה הילד שלי" or "הילד שלי לא ברשימה". The parent must tick the declaration
  *"אני מצהיר/ה שאני ההורה או האפוטרופוס החוקי של הילד/ה"*, which is stored with its wording and time.
  The team's staff (staff ≥ create) approve it in **ניהול הקבוצה → בקשות הצטרפות**.
* **Family / follower** (a grandparent, for example): asks to follow a child who already has a
  declared parent. Only that parent can approve it, in **משפחה → בקשות מעקב לאישורך**. Followers see
  the child and the team board. They cannot edit the child or report absences: from this migration on,
  `is_player_guardian` means a parent.
* A parent registers **once** and adds any number of children. Each child is its own request, or is
  added directly in a team the parent already belongs to.
* "זה הילד שלי" inside a team works directly only while the child has no declared parent yet.

**Shirt number and kit**: the parent sets the child's shirt number per team (`set_shirt_number`). The
number is not part of the IFA data, can change, and is unique per team. The parent also records the
child's kit (`player_kit`): summer, winter, home and away sets, pairs of socks, and shirt, pants and
shoe sizes. Edit access: the child's parent, or staff with equipment ≥ edit. View access: the
child's guardians, and staff with equipment ≥ view.

Run after `20261101300000_permissions.sql`. Rollback:
`supabase/rollback/20261101400000_search_and_join_requests.down.sql`. It removes the functions and
policies and keeps the `join_requests` and `player_kit` tables and their data, which are reused if the
migration is run again.

## Matches, lineups and attendance — M4 (migration `20261101500000_matches_lineups_attendance.sql`)

**Sport profiles** (`src/lib/sports.ts`): one app for every sport. The shared core works the same
everywhere: teams, trainings, announcements, absences, attendance, carpools, kit, payments,
permissions and search. Football and basketball also get matches, lineups and scores: football
lineups have 7 players by default (5, 8, 9 or 11 can be chosen per match), basketball lineups have 5.
Other sports get the core only.

* **Matches** (`team_matches`): opponent, home or away, time, venue, type and score. Members see
  them; staff add them (matches ≥ create) and edit them (≥ edit). A match is canceled, never
  deleted.
* **Lineups** (`match_lineups`, `match_lineup_players`): any number per match, for example two
  sevens. Slot 1 to N means on the field; no slot means on the bench. A player can be in only one
  lineup of a match. Parents see a lineup only after staff publish it.
* **Attendance** (`attendance_records`): a player is presumed to be coming. A parent's absence
  report, for one training or for a date range, shows up as expected absent or late. Staff mark
  only the exceptions, or "present" to confirm. `event_attendance()` builds the sheet for one
  training or match. `team_attendance_summary()` gives each player's rate over a period of past,
  non-canceled events. A player with no mark and no report counts as present.

Run after `20261101400000_search_and_join_requests.sql`. Rollback:
`supabase/rollback/20261101500000_matches_lineups_attendance.down.sql`. It keeps the tables and their
data.
