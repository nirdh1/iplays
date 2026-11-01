# IFA games: sync, change detection and notifications (2026-11-01)

Migration: `supabase/migrations/20261101900000_ifa_games_sync.sql` (additive; rollback keeps all data).
Tests: `supabase/tests/test_ifa_games.sql` (simulated games and changes only).

## What the saved pages show (verified)

| Page | URL | Verified |
|---|---|---|
| All games of a team | `/team-details/team-games/?team_id=7491&season_id=28` | 15 games, 19/10/2026 to 08/05/2027. The owner's screenshot shows the same 15 rows. |
| League games | `/leagues/games/?league_id=640&season_id=28` | 12 games, 10/10 to 26/10/2026 only (a date window, **not** the season). The teams filter there is an ASP.NET postback (`__EVENTTARGET=…ddlTeams`, `ddlTeams=7491`, `__VIEWSTATE`), not a URL. Its dropdown lists the league's 17 teams with IFA ids. |

- 14 of the team's 15 games have **no game id yet** (`game_id=-1`). Only 1144003 has one.
- 12 games show **00:00** and an **empty venue**.
- There is no status column. Status is `played` when a result is shown, else `scheduled`.
- Rows show team **names** only. The ids come from the league page dropdown. All 15 opponents are in it.
- The team plays 15 games but the league has 16 other teams. No game against "שמשון תל אביב דרום" is listed (a bye, or not scheduled yet; **unverified**). So a team page is not proof of a complete season.
- Score order ("a - b" = home - away) is still to be checked against a played game.

Parsers (same output, checked on the real pages): `tools/ifa/ifa_games.py` and `parseGamesHtml` in `src/lib/ifaApi.ts`.

## Model

- `ifa_games`: one row per game. Matched by the IFA game id when the page has one, else by **season + home IFA team id + away IFA team id**. When the IFA later assigns an id, it is attached to the same row (no duplicate, no notification). A payload with the same pairing twice is rejected for that row, not guessed.
- Time: `00:00` or empty → `kickoff_time = null`, `time_confirmed = false` → shown as **"שעה טרם נקבעה"**. Empty venue → **"מיקום טרם נקבע"**.
- `ifa_game_updates` + `ifa_game_changes`: every real change, field by field (old value, new value, time, source, run).
- `team_matches`: IFA games are mirrored with `source = 'ifa'` for every linked app team (home and/or away). Club-created matches and trainings stay `source = 'club'` and are never touched. Staff can't edit the official fields of an IFA game (trigger); note and lineup size stay editable.
- Venue estimate: `venue_hint` = the home team's usual ground (majority of its home games with a venue). Shown as "כנראה: …", never written to the official venue, never notified.
- `venue_locations`: address / map point per venue name, set once and reused for future games (Waze link). Allowed: Super Admin, club admin, staff or parents of a team playing there. A parent cannot overwrite a staff/admin entry. History in `venue_location_history`.
- Team label: `set_ifa_team_category(season, team, 'טרום ב׳')` shows the team as "טרום ב׳ – הפועל רמת גן צפון"; `ifa_teams.name` keeps the IFA name. The league name from the games page goes into `teams.league`.

## Change rules

| Change | Recorded | Significant | Notify |
|---|---|---|---|
| First time a game is seen | as new | – | no |
| Date | yes | yes | yes |
| Venue | yes | yes | yes |
| Time unknown → known, or known → other time | yes | yes | yes |
| Known time → 00:00 | yes | no | no (likely a page glitch; visible in history) |
| Status (postponed / canceled / played) | yes | yes | yes |
| Result | yes | no | yes (as "result") |
| IFA game id assigned | yes | no | no |
| Nothing changed | no | – | no |
| Game missing from the page | reported in the run | – | no; never deleted |
| Source unreachable | run logged as `failed` | – | no; data untouched |

## Notification queue

`notification_outbox`: one row per user per change, `unique (user_id, update_id)`, so a re-run or two racing runs never notify twice.
Recipients: members of the app teams linked to the game, minus those who turned the type off (`notification_prefs`).
The rows are also the user's in-app inbox (RLS: own rows only).

Dispatcher: `supabase/functions/notify-dispatch` (Edge Function):
- `claim_notifications` (`for update skip locked`).
- Web Push to each device.
- `complete_notification`: sent, or retry with backoff up to 5 attempts; no device → skipped.
- Rows older than 24 h are skipped, not sent late.
- Sending is controlled by `push_mode`: **off** by default, then `admins` (test on your own phone) and `all`.

### Turning push on (one time)

1. Create VAPID keys: `npx web-push generate-vapid-keys`.
2. Supabase → Edge Functions → Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:you@iplays.io`.
3. Render and Vercel env: `VITE_VAPID_PUBLIC_KEY` (public key only).
4. Deploy: `supabase functions deploy notify-dispatch --no-verify-jwt`. The function checks the service-role bearer itself.
5. Schedule every minute (SQL Editor; needs the `pg_cron` and `pg_net` extensions; the key is read from Vault, never pasted into code):
   ```sql
   select cron.schedule('notify-dispatch', '* * * * *', $$
     select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/notify-dispatch',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')));
   $$);
   ```
6. In `#ifa`, switch to "בדיקה: רק מנהלים", enable notifications in your account, import a changed page, and check that a notification arrives. Then switch to "לכולם".

iPhone: Web Push works only after "add to home screen" (iOS 16.4+).

## Games schedule

`ifa_games_due(now)` lists the linked IFA teams due for a games sync:
- every **3 hours**;
- **every hour** when the team has a scheduled game in the next 48 hours.

It is ready, but **nothing fetches from the IFA site**. Server requests get Cloudflare 403, and we do not get around that. Until there is an approved source (IFA permission or feed), a run happens when an admin uploads a saved page in `#ifa`: dry run, then import. A fetcher for an approved source would:
1. call `ifa_games_due()`;
2. fetch each team's games;
3. call `import_ifa_games(payload, true)`;
4. on failure, call `record_ifa_sync_failure(...)`.

It would run on the same pg_cron as above.
