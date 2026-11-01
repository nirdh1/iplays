# iPlays IFA data collector (discovery POC)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python ifa_collector.py --team 7491 --season 28
```

Results in `ifa_output/`:
- `team.html`, `roster.html`, `games.html` (when accessible)
- `result.json`: discovered team/league links, **unverified** roster name candidates, raw game tables, and errors.

**Not a production scraper:** The IFA website's exact HTML structure and request behavior have not been validated in this runtime. Inspect HTML and refine selectors before syncing data to Supabase. Do not auto-import roster candidates. No endpoint is assumed to exist for all clubs/teams. Respect site terms, robots.txt, rate limits, and children's data privacy. Stop on 403/429 rather than circumventing restrictions.

## Offline mode (saved pages)

The IFA site returns a Cloudflare 403 to server requests, so the collector stops. To work from pages the owner saved in their own browser (Ctrl+S, HTML only):

```bash
python ifa_collector.py --team 7491 --season 28 --saved ./saved --out ./ifa_output
```

`./saved` holds `team.html`, `roster.html` (after clicking the roster tab) and `games.html`. Players come only from `#teamPlayers`; staff (`#teamStaff`) are skipped. Nothing is imported to Supabase from here.

Parser check on the synthetic fixture (expects 2 players, staff skipped, duplicate id merged):

```bash
python ifa_collector.py --saved fixtures --out /tmp/ifa_fixture_out
```

Output: `players.json` — one record per IFA `player_id` with `ifa_team_id`, `ifa_season_id`, `name`, `profile_url`, `image_url` (null when the page has no image). Records without a `player_id` are skipped, never guessed.

## Games from saved pages

```
python3 -I tools/ifa/ifa_games.py --games team_games.html --league league_games.html --report > games.json
```

`team_games.html` = the saved "כל משחקי קבוצה" page (`/team-details/team-games/?team_id=…&season_id=…`);
`league_games.html` = the saved league games page, needed for the team ids in its dropdown.
The output is the payload of `import_ifa_games()`. See `docs/ifa-games-sync.md`.

## Roster sync from saved pages (change detection)

Folder layout: `saved/<ifa_team_id>/roster.html` (Ctrl+S on the team page; optional `team.html`).

    python3 tools/ifa/batch_saved_import.py --saved tools/ifa/saved --out out/

Steps, kept apart:

1. **Extract** — `ifa_collector.roster_players` reads `#teamPlayers` (staff in `#teamStaff` are skipped).
2. **Validate** — numeric team folder, team name from the page heading (never guessed), at least one
   player, every player id matches its profile link on football.org.il. Rejected folders are listed
   in `out/review.json` with the reason.
3. **Detect** — run `out/review_dryrun.sql` in the Supabase SQL Editor: `sync_ifa_roster(p, false)`
   returns added / missing / returned / renamed players per team and writes only a `dry_run` row
   in `ifa_sync_runs`.
4. **Apply** — after checking the dry run, run `out/review_apply.sql` (`sync_ifa_roster(p, true)`).

The database never deletes a player. One no longer on the page is marked `missing` in
`ifa_rosters` (and `returned` if it comes back); parent links and names edited in the app are
kept. An empty roster, or one that drops below half of the active roster (6+ players), is
refused and logged as `failed`; after checking the page, resend with `"allow_large_drop": true`.
Every change is logged in `ifa_roster_changes` (platform admins only). The same flow is in the
app: `#ifa` → "ייבוא סגל מדף שמור" → "בדיקה: מה ישתנה" → "ייבוא השינויים".

There is no scheduled run: the IFA site returns 403 to servers (also to Playwright, checked
2026-11-01), and we do not get around that.

## Local agent (pilot): "הרץ בדיקה" from the admin panel

The IFA site returns 403 to cloud servers, but a plain browser on the owner's home
connection loads the pages normally (one test from the owner's Mac, 2026-11-01: HTTP 200,
no challenge, 24 players). The agent runs there and never gets around a block.

Flow: panel `#ifa` → "הרץ בדיקה" (team id) → request row → `ifa_agent.py` on the Mac claims
it, loads the roster page, validates it (`validate_roster`, shared with
`batch_saved_import.py`) and sends a **dry run** → the panel shows what will change →
"ייבוא השינויים" (platform admin only) applies it through `sync_ifa_roster`.

The agent signs with its own key (`#ifa` → "מפתח לסוכן" → "יצירת מפתח"; shown once, stored
hashed). The key can claim requests, submit a dry run and report a failure; it cannot import
or read anything else. Never put service_role on the computer.

Built-in limits: plain Chromium (no stealth, user agent or proxy changes), one load per page,
no retries, stop the whole run on HTTP 403 / 429 / 503 or a challenge page, robots.txt
respected, at least 5 s between pages (default 8), at most 20 pages per run (default 5).
Only id, name and profile link are sent (no photos).

Setup on the Mac:

    python3 -m venv .venv
    .venv/bin/pip install -r tools/ifa/requirements.txt playwright
    .venv/bin/playwright install chromium
    cp tools/ifa/agent.env.example tools/ifa/agent.env      # fill in; ignored by git
    .venv/bin/python tools/ifa/ifa_agent.py --check 7491     # one page, prints, sends nothing
    .venv/bin/python tools/ifa/ifa_agent.py                  # one pass over open requests

Every 5 minutes while the Mac is awake (`~/Library/LaunchAgents/il.iplays.ifa-agent.plist`,
then `launchctl load` it; adjust the paths):

    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict>
      <key>Label</key><string>il.iplays.ifa-agent</string>
      <key>ProgramArguments</key><array>
        <string>/Users/YOU/iplays/.venv/bin/python</string>
        <string>/Users/YOU/iplays/tools/ifa/ifa_agent.py</string>
      </array>
      <key>StartInterval</key><integer>300</integer>
      <key>StandardOutPath</key><string>/tmp/iplays-ifa-agent.log</string>
      <key>StandardErrorPath</key><string>/tmp/iplays-ifa-agent.log</string>
    </dict></plist>

Pilot scope: one team (7491), on demand. Wider use (teams from league pages, scheduled
checks) waits for the pilot result and, preferably, the IFA's reply to the data request:
the terms of use say nothing about automated access, and reuse of IFA content and images
needs their consent.
