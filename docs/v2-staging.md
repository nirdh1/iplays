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
2. SQL Editor: run the bundle made by `supabase/staging/build_bundle.sh`
   (every migration in file order). It aborts if the database already has the
   iPlays schema, so it cannot run on Production by mistake.
3. SQL Editor: run `supabase/staging/seed_synthetic.sql` (invented club, 3
   teams, 45 players, trainings and attendance). It aborts if IFA data exists.
4. Vercel → Settings → Environment Variables, scope **Preview**, branch of V2:
   the four variables above.
5. Open the Preview URL, sign up with your email, then in the SQL Editor:
   `select staging_make_me_staff('your@email');`
6. Open `<preview-url>/#os/teams`.

## Notes
- `20261106100000_player_career_measurements_private.sql` restores the
  parent-only rule for body measurements in `player_career()` (two migrations
  share a timestamp and the later one re-exposed them). It runs on Staging as
  part of the bundle. On Production it runs only after the read-only check
  (P0-T2) and a separate approval.
