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
  (Twilio, MessageBird, Vonage or Textlocal). Until then, use the **אימייל** tab on the login screen.

**Authentication → URL Configuration → Site URL**: your site address, e.g.
`https://iplays.onrender.com`.

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
