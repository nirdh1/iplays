# IFA data integration — status report (2026-11-01)

## What works, verified

| Item | Evidence |
|---|---|
| Roster extraction from a **saved** team roster page | Owner's saved page for team 7491, season 28: 24 players from `#teamPlayers`, 24 unique `player_id`s. The 8 staff in `#teamStaff` are excluded. Same result from `tools/ifa/ifa_collector.py --saved`, the owner's `parse_saved_roster.py`, and the in-app parser (`src/lib/ifaApi.ts`). |
| Team name, team id, season id from the same page | `<h1>סגל שחקנים הפועל רמת גן צפון</h1>`. `team_id=7491` and `season_id=28` are in every `#teamStaff` link. |
| League list for season 28 | The site menu (present on every page) links to 195 leagues with `season_id=28`, 153 of them youth (נוער / נערים / ילדים / טרום). Example: 156 = "ליגת ילדים א' מרכז". |
| Server-side upsert | `import_ifa_team(jsonb)` keys on `ifa_player_id` (players) and `(season, team, player)` (roster). Running the same payload twice creates nothing new. Covered by `supabase/tests/test_ifa.sql`. |
| Sync log | Every run goes into `ifa_sync_runs` with counts, errors, players missing from the payload, and the time. The Super Admin screen (`#ifa`) shows the runs and each team's last sync. |

## What does NOT work / not verified

- **Live sync from the IFA site does not work.** From this environment, a plain GET, the owner's `ifa_collector.py` and a real browser (Playwright) all get `403 Attention Required! | Cloudflare` (`server: cloudflare`, e.g. `cf-ray: a53af0a89ee0fa2f-IAD`). The block is on the server's IP. Supabase or Vercel functions would very likely get the same response; that is untested. We do not get around it. The saved-page import is **not** proof that automatic sync works.
- **Team page main tab, league of the team, birth year, matches:** no saved page of these yet, so nothing is parsed or imported. The roster page does not state the team's league or age group (the leagues on it are the site menu). Matches: no assumption of an API or JSON. Waiting for a saved `team-games` page.
- **Player birth month/year** is on player pages (per the owner's screenshots); not parsed, not imported.
- **IFA terms of use** for reuse have not been checked. A data request letter is at `/mnt/project-files/iplays/ifa-data-request-letter.md`.

## Data model (additive, migration `20261101800000_ifa_import.sql`)

- `ifa_leagues (season, league_id, name)`
- `ifa_teams (season, ifa_team_id, name, ifa_league_id, team_id → teams)`
- `ifa_players (ifa_player_id PK, name, player_id → players, profile_url)`
- `ifa_rosters (season, ifa_team_id, ifa_player_id)`: team + season membership, kept apart from the app's `player_assignments`.
- `ifa_sync_runs (kind, source, counts, errors, created_at)`

Existing tables are not replaced. The rollback keeps all tables and rows.

## League vs academy

Imported players are linked through `ifa_players.player_id`, and their team through `ifa_teams.team_id`. The import only creates or updates IFA-linked teams and players. It never touches club-managed teams, assignments or transfers, so academy rosters stay club-managed. When a club adopts an imported team, it goes into the club's league program.

## Minors' privacy

- No photos are stored or shown; image URLs are not imported.
- Names are stored as written on the page, not split into first and last name. No birth year is guessed.
- An imported child that no parent has claimed is **hidden from the open search**. On a team page, non-members see only first name + initial. Members, staff and the club see the full name.
- The `ifa_*` tables are readable only by platform admins. Imports run only from the SQL Editor or by a platform admin.

## How to import a team now

1. Save the team's roster page in your browser (Ctrl+S, HTML).
2. In the app: Family tab → "נתוני ההתאחדות" (Super Admin only) → upload → check the count and names → import.
   Or run `tools/ifa/make_import_sql.py` and paste the SQL into the Supabase SQL Editor.
