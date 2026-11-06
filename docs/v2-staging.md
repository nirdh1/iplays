# iPlays 2.0 (Club OS) — Staging

V2 is built on its own branch and runs only against a separate Staging
Supabase project with invented data. Production is not touched.

## Switches
| Variable | Staging | Production |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | the Staging project | unchanged |
| `VITE_V2_OS` | `1` | not set (V2 stays off) |
| `VITE_ENV_LABEL` | `STAGING` (fixed top banner) | not set |

Club OS opens at `#os/...`. It is off unless `VITE_V2_OS=1`, and it refuses to
open when the Supabase URL is the Production project, even with the flag on.

## One-time Staging setup
1. Create a new, empty Supabase project (not Production).
2. SQL Editor of that project: run `staging-part-1-of-3.sql`, then part 2,
   then part 3 (made by `supabase/staging/build_bundle.sh <dir> 3`; every
   migration in file order). Part 1 aborts on any database that already has
   the iPlays schema, so it cannot run on Production; each later part aborts
   unless the previous part finished and it did not run yet.
3. SQL Editor: run `supabase/staging/seed_synthetic.sql` (invented club, 3
   teams, 45 players, trainings and attendance). It aborts unless the parts
   ran, and if the database has players or more than one user.
4. Vercel → Settings → Environment Variables, scope **Preview**, only the V2
   branch: the four variables above. Then redeploy that branch.
5. Open the Preview URL, sign up with your email, then in the SQL Editor:
   `insert into staging.operator (email) values ('<your email>');`
   `select public.staging_make_me_staff();` (one operator, runs once,
   not callable from the app), and remove the helper:
   `drop function public.staging_make_me_staff(); drop table staging.operator;`
6. Open `<preview-url>/#os/home`.

If any step fails half way, delete the Staging project and start again: it
holds no real data.

## Notes
- `20261106100000_player_career_measurements_private.sql` restores the
  parent-only rule for body measurements in `player_career()` (two migrations
  share a timestamp and the later one re-exposed them). It runs on Staging as
  part of the bundle. On Production it runs only after the read-only check
  (P0-T2) and a separate approval.
