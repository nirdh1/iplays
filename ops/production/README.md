# iPlays 2.0 (Club OS) to Production: runbook

Order is fixed. Each step needs the operator's go. Nothing here runs automatically.

1. **Backup (read-only)**: `ops/backup/RUN-ACTIONS-1-3.md`: `preflight.sh` must end with
   `PREFLIGHT PASSED`, then `backup.sh` must end with `BACKUP PASSED` (send only `report.txt`).
2. **SQL parts**, one at a time in the Production SQL editor (`ops/production/parts/`):
   1 exercise-library, 2 session-plans, 3 reports-dashboard, 4 topics-base-25,
   5 exercise-video, 6 club-os-pilot. Each refuses Staging, a database that does not look
   like iPlays Production, the wrong order and a second run; a refusal changes nothing.
   All are additive (new tables and functions). Rollbacks: `supabase/rollback/`.
   Not included: `20261106100000_player_career_measurements_private.sql` (changes an
   existing function): only after the read-only check T2 and its own approval.
3. **Pilot account**: in the SQL editor
   `insert into public.os_pilot_users (user_id, note) select id, 'pilot' from auth.users where email = '<email>';`
   The account also needs a real club role (owner/admin or team coach) from the V1 club panel.
4. **Code**: merge the branch to `main`. With `VITE_V2_OS` unset in the Production env this
   changes nothing for users. Then set `VITE_V2_OS=1` in Production (Vercel/Render) and
   redeploy: Club OS opens only for accounts in `os_pilot_users`, from the "Club OS" button;
   everyone else keeps V1 and never sees the button.
5. **Off switch**: remove `VITE_V2_OS` and redeploy, or `delete from public.os_pilot_users;`.

Rebuild the parts after any migration change: `ops/production/build_prod_parts.sh`.
Tested on a local database built from the Staging base parts with the `staging` schema
removed: all 6 parts pass in order; a second run and a run on Staging abort.
