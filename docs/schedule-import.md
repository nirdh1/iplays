# Load a game schedule from a file

Team page → משחקים → **טעינת לוח משחקים מקובץ**. Staff and any member of the team (a parent too) can use it.

Accepted files: a screenshot or photo (e.g. of the team's games page on the IFA site), PDF, Excel (.xlsx) or CSV.
The app shows every game it found for the team; the user fixes date, time, opponent, home/away and venue,
unticks what they don't want, and saves. Games the team already has that day (same opponent, or any IFA game) are
skipped. A game without a time is saved as "שעה טרם נקבעה" until someone sets it.

## Setup (once)

1. **SQL** – run `supabase/migrations/20261103100000_schedule_import.sql` in the Supabase SQL Editor.
   Rollback: `supabase/rollback/20261103100000_schedule_import.down.sql` (imported games stay).
2. **AI reading of images / PDF** – Edge Function `supabase/functions/read-schedule`:
   - Supabase → Edge Functions → Secrets: add `ANTHROPIC_API_KEY` (from console.anthropic.com → API keys).
   - Deploy: `supabase functions deploy read-schedule` (JWT verification stays on), or create a function named
     `read-schedule` in the dashboard and paste `index.ts`.
   - The function checks `can_import_matches(team)` with the caller's own login, so it only reads files for people
     who may add games to that team. Nothing is stored; the file goes to the Claude API and back.

Until step 2 is done, Excel / CSV still work (a column-name parser in the browser: needs a header row with
תאריך and יריבה, or תאריך with קבוצה ביתית + קבוצה אורחת), and images / PDF show a message.

Cost: one Claude call per file (Opus 5.5 at medium effort; a screenshot of a season is a few cents).
