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
  Then **Authentication → Emails → Templates**: paste the same body into **both** **Magic Link**
  (returning parents) and **Confirm signup** (first time). The button signs the parent in
  directly; the code is the fallback for the home-screen app on iPhone, whose storage is
  separate from Safari's:

  ```html
  <div dir="rtl" style="font-family:Arial,sans-serif;text-align:right">
    <h2>כניסה ל-iplays</h2>
    <p>
      <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email"
         style="display:inline-block;background:#7CF23D;color:#0B1F3B;padding:14px 28px;border-radius:12px;font-weight:bold;text-decoration:none">
        כניסה ל-iplays
      </a>
    </p>
    <p>משתמשים באפליקציה שבמסך הבית? הקלידו בה את הקוד:</p>
    <p style="font-size:28px;letter-spacing:6px" dir="ltr"><strong>{{ .Token }}</strong></p>
    <p style="color:#666">הלינק והקוד תקפים לשעה ולשימוש אחד. מתחברים פעם אחת בכל מכשיר.</p>
  </div>
  ```

  `{{ .RedirectTo }}` is the site the parent asked from (it must be listed under Redirect URLs,
  below; otherwise Supabase uses the Site URL). The app reads `token_hash` from the address and
  signs in, in any browser.

  **Password (optional)**: parents can set a password in the Family tab (or the one-time popup
  after sign-up) and then sign in with email + password on any other device. Keep **Email** provider
  password sign-in enabled (the default). The app stores `has_password` in the user's metadata.

  **Why a parent may be asked again** (each is a separate browser storage, so a session in one is not
  in the other): opening the email link inside the Gmail/Outlook app's built-in browser; the iPhone
  home-screen app vs Safari; `iplays.onrender.com` vs `iplays.vercel.app` (use one address, and list
  both under Redirect URLs). A password avoids all three.

  **Stay signed in**: the app keeps the session on the device and renews it automatically, so a
  parent signs in once per device. Under **Authentication → Sessions** keep *Time-box user
  sessions* and *Inactivity timeout* off (0 / never).

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

## Teams without a coach (migration `20261101600000_open_teams.sql`)

Run after the M4 migration. Rollback: `supabase/rollback/20261101600000_open_teams.down.sql` (keeps every team, child and membership).

- **Search teams by birth year.** `search_teams(query, birth_year, sport)` finds teams by the child's birth year alone, or by team / club / city name. A team matches a year by its `birth_year_from/to` or by the birth years of its players. The search screen opens on the "קבוצה" tab.
- **A parent opens a team.** `open_team(...)` creates the team (`opened_by = 'parent'`) with the parent's child. The parent is a regular parent member, not staff, and needs the parent declaration. The same name, club and birth year can't be opened twice.
- **Auto-approval while nobody manages the team.** `team_has_staff(team)` is true when the team has an admin / coach, its club has an owner / admin, or a staff grant covers it. While it is false, `request_join` approves a declared parent right away. An existing child that already has a declared parent still waits, and follow requests still go to the parent. Once the team has staff, requests wait for staff as before.
- **A club adopts the team.** `adopt_team(team, club, program)` lets a club admin take a team with no staff and no club into the club.

## A coach takes over a team (migration `20261101700000_team_claims.sql`)

Run after `20261101600000_open_teams.sql`. Rollback keeps the `team_claims` table and every membership approved through it.

- League teams can exist before anyone manages them (catalog / import). Parents join them right away while they have no staff.
- A coach opens the team page and taps "אני המאמן של הקבוצה" (`request_team_claim`).
- The team's club admin approves (`review_team_claim`). If the team has no club, a platform admin (Super Admin, a row in `platform_admins`) approves. Pending claims show at the top of the Family tab for whoever can approve them.
- The approved coach becomes the team admin if the team has none, otherwise a coach. From then on parent requests wait for the staff.

To make yourself Super Admin, run once in the SQL Editor:
`insert into public.platform_admins (user_id) select id from auth.users where email = '<your email>';`

## IFA import (migration `20261101800000_ifa_import.sql`)

Run after `20261101700000_team_claims.sql`. See `docs/ifa-integration.md` for what is verified and what isn't. Super Admin screen: `#ifa`.

## Parent requests on a team with no staff (migration `20261101950000_join_no_staff_parent.sql`)

Run after `20261101900000_ifa_games_sync.sql`. Replaces two functions; no tables or data change. Rollback restores them.

- A declared parent on a team with no staff is still added right away (no request), as before.
- If the child already has a declared parent, the request used to wait for "the staff", which a team with no staff doesn't have. It now goes to the child's declared parent: it shows with the follow requests at the top of the Family / Home tab, and that parent approves (`review_join_request`). A platform admin can also approve it.
- Teams with staff are unchanged: the coach / club admin approves.

## Empty state instead of sample data

Signed-in users see only their own data: their teams, their linked children and the teams' upcoming matches. A user without a team sees an empty state with a search button and a "הצגה לדוגמה" link that shows the sample screens; the choice is remembered on the device and ends as soon as the user belongs to a real team. Signed-out visitors who tap "browse the demo" on the login screen still see the sample data.

## Parents keep the training schedule (migration `20261101960000_parent_trainings.sql`)

Run after `20261101950000_join_no_staff_parent.sql`. Adds three policies; rollback removes them and keeps the trainings.

Any member of a team (parents too) can add, cancel and delete trainings in the team board (`#coach/<team>`), with or without a coach; everyone in the team sees them on Home and in the Calendar. A coach may still update parents elsewhere (e.g. WhatsApp). Staff keep their own training permissions.

## Parent carpools (migration `20261101970000_rides.sql`)

Run after `20261101960000_parent_trainings.sql`. Additive only: tables `rides`, `ride_passengers`, `ride_needs` and their functions. Rollback (`supabase/rollback/20261101970000_rides.down.sql`) deletes all rides.

- Every training and match (including IFA league games) has a "הסעות" line on Home and in the Calendar that opens the rides sheet.
- A team member offers a ride (direction to / from / both, seats, optional departure time, pickup point, note). One offer per driver per event; the driver can edit or cancel it.
- A parent seats their own child in a ride with a free seat (`join_ride`), or marks that the child needs a ride (`set_ride_need`). The mark is cleared (or narrowed to the remaining leg) when the child gets a seat. When a ride is canceled, the other parents' children go back to "needs a ride".
- Only team members can read rides (RLS); clients have no direct write access, everything goes through the `security definer` functions. Children appear by first name only; the driver's name and phone (if on the profile) are shown to the team.

## Team fund and payments (migration `20261101990000_team_fund.sql`)

Run after `20261101980000_account_types.sql`. Additive: five new tables (`fund_treasurers`, `fund_collections`, `fund_payments`, `fund_expenses`, `child_costs`), helpers, RPCs and policies. The rollback drops the fund tables and their data.

- The team page (`#myteam/<team>`) has a "קופת הקבוצה" entry that opens `#fund/<team>`.
- A fund manager (an appointed treasurer, anyone with `can(team, 'finance', 3)` such as a team manager / team admin / club admin, or a platform admin) opens collections with an amount per child, due date and a payment link (Bit / PayBox / bank details), confirms or rejects payments, records cash, exempts a child, closes / cancels / reopens a collection and logs expenses.
- While a team has no fund manager, any member can appoint themselves the first treasurer. After that, managers appoint others; a treasurer can step down.
- A parent taps "שילמתי" for their own child (`report_payment`); the treasurer confirms (`set_payment_status`).
- Every member sees collections, totals (`fund_summary`) and expenses. A parent sees only their own children's payment rows; managers see every family.
- Money never moves through iplays. Collections are never deleted, only cancelled. The new-collection sheet offers ready titles (food after a game, a gift for the coaches, an end-of-season event…) and takes a PayBox group / Bit request link.
- Family costs (`#costs/<player>`, linked from the fund screen and from the parent's child row): the program's annual fee per child and season, payments toward it (what's left to pay), and other costs (kit, tournaments, rides, medical). Confirmed team-fund payments are listed too. `child_costs` is visible only to the child's parents.

## Family members and permissions (migration `20261101996000_family_members.sql`)

Run after `20261101995000_inbox_notifications.sql`. Additive: new columns on `player_guardians` and `team_members`, a `family_invites` table, new functions, and replaced policies for trainings and absences. Rollback restores the previous functions and policies and keeps the data.

- **Family tab → "בני משפחה והרשאות"**: everyone linked to each of my children, with a kinship label (אמא, סבתא, ...) and what they may do.
- **Invite link** (`#fam/<code>`): a parent invites a second parent or a family member for one or more children. One-time, valid 14 days. Opening it after sign-in shows an accept card on the Family tab; no staff approval.
- **Permissions** for non-parents: `can_report` (absences), `can_rides`, `can_pay` (stored now, enforced when rides / payments are built). Seeing the child, the schedule, matches and results needs none. Parents always have all of them. Helper for policies: `family_can(player, 'view' | 'report' | 'rides' | 'pay')`.
- A parent edits or removes family members, but cannot limit or remove the other parent; anyone can leave by themselves.
- A request from a second declared parent can be approved by the child's existing parent too (staff still can).
- Followers are marked `team_members.is_follower`: they see the team and cannot add, change or delete trainings (`is_team_participant`). Existing followers are marked by the migration.

## Club finances and activities (migration `20261102600000_club_finance_and_activities.sql`)

Run after `20261102500000_calendar_absences.sql`. Additive: tables `club_fee_plans`, `club_charges`, `club_payments`, `club_reminders`, `club_activities`, `activity_registrations`, the view `club_charge_balances`, RPCs and policies; notification kinds `payment_reminder`, `payment`, `activity`. The rollback drops all of it with its data.

- **Club panel → "כספים"** (`ClubFinanceSection`): fee plans (membership for the season, monthly, periodic every N months, one-time) for the whole club, a program or a team; "charge every player" creates one charge per installment per active player (idempotent). Debts list, record a payment (cash / transfer / Bit / PayBox / check / card outside the app), waive, manual charge, reminders (one child or every overdue charge; skipped if reminded in the last 3 days; goes to the parents' bell + push), parent reports awaiting approval, report by team and recent payments, CSV download.
- **Who:** `can_club(club, 'finance', n)` or, for a team's charges, `can(team, 'finance', n)`: 1 view / reports, 2 record payments, 3 plans, charges, approve, waive, remind. A treasurer = a club-wide 'finance' role (the treasurer template) or grant. Parents see only their own children's charges and payments.
- **Club panel → "מחנות"** (`ClubActivitiesSection`): summer camp, day camp, goalkeeper camp, special training, workshop: dates, hours, place, birth years, places, price, registration deadline, public / club-only, draft / open / closed / cancelled. Sign-ups with waitlist, parents' names + phones, payment state, CSV. `can_club(club, 'camps', 3)` edits (club owners/admins, and the camps-manager role).
- **Parents → `#pay`** (Family tab → "תשלומים ומחנות"): open charges per child with "שילמתי", history, and open activities to sign up for. When full, the child goes to the waitlist; cancelling promotes the next child and notifies their parents. A priced sign-up creates a club charge.
- No card data is stored. `club_payments.provider` / `provider_ref` are reserved for a future payment provider (its name and transaction id only).

## Removing a parent from a child (migration `20261103000000_guardian_removal.sql`)

Run after `20261102900000_ifa_repeat_pairings.sql`. Adds functions only; rollback drops them.

- `leave_child(player)`: anyone linked to a child removes themselves (Family tab → "זה לא הילד שלי"), e.g. after claiming the wrong child. They also leave the child's teams unless they still have another child there or a staff role.
- Super Admin (`#adminparents`, from the admin panel): `admin_child_guardians(query)` finds children by name or a parent by name / email; `admin_remove_guardian(player, user, reason)` removes the link (same team clean-up). This is an explicit write exception to the Super Admin's read-only access; every removal goes to `audit_log` (`family.admin_remove`) with the reason.
