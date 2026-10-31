# iplays — Brand Style Guide

**iplays** · המשחק שלהם. העולם שלך.

A premium, Hebrew‑first (RTL) youth sports platform for parents. The brand should feel
calm, confident and sporty: deep navy for trust, lime for energy, blue for action.

A live, interactive version of this guide ships with the app at **`#brand`**
(`npm run dev` → `http://localhost:5173/#brand`).

---

## 1. Name

- Always **iplays**, all lowercase, also at the start of a sentence and in Hebrew text.
- Never "iPlays", "IPlays", "I-Plays" or "איפלייס" in UI copy.
- In Hebrew sentences, wrap the name in an LTR isolate (`<span dir="ltr">iplays</span>`) so punctuation doesn't jump.

## 2. Logo

| Asset | File | Use |
|---|---|---|
| Wordmark (navy) | `public/brand/wordmark.svg` | Light backgrounds, app header |
| Wordmark (white) | `public/brand/wordmark-on-dark.svg` | Navy / photo backgrounds |
| Motion symbol | `public/brand/symbol.svg` | Loading states, watermarks |
| React component | `src/components/Logo.tsx` | `<Logo />`, `<Logo tone="white" />`, `<LogoSymbol />` |

**Construction.** A geometric monoline wordmark (round caps, one stroke weight, circles
for every bowl). The dot of the **i** is the motion symbol: a lime ball with two blue
speed trails. It reads as "a ball in flight" without belonging to one sport — it works for
football, basketball, tennis, volleyball and more.

**Do**
- Keep clear space around the logo equal to the height of the ball.
- Minimum size: 20px tall on screen (the trails disappear below that; use `LogoSymbol`).
- Use navy on light backgrounds and white on navy.

**Don't**
- Recolor the ball (it is always lime `#7CF23D`) or the trails (always blue `#3DA5FF`).
- Set the name in a typeface instead of using the vector logo.
- Add outlines, shadows, gradients or rotate the logo.

## 3. App icon

| Variant | File | Notes |
|---|---|---|
| Light | `public/brand/app-icon-light.svg` | White tile, navy stem |
| Dark (primary) | `public/brand/app-icon-dark.svg` | Navy gradient tile, white stem — default store icon |
| Wordmark | `public/brand/app-icon-wordmark.svg` | Alternate / marketing |

The icon is the **i** from the wordmark enlarged: stem + ball in motion. All icons are
1024×1024 with a 228px corner radius preview; export PNGs from these SVGs for the stores
(iOS applies its own mask — export the square tile without the radius for iOS).

## 4. Color

| Token | Hex | Role |
|---|---|---|
| `--ip-navy` | `#0B1F3B` | Primary text, primary buttons, hero cards, match events |
| `--ip-lime` | `#7CF23D` | Highlight, active tab, success, key CTA on navy |
| `--ip-blue` | `#3DA5FF` | Actions, links (use `--ip-blue-700 #1477D6` for text), team training |
| `--ip-bg` | `#F4F7FB` | App background |
| `--ip-white` | `#FFFFFF` | Cards |
| `--ip-live` | `#FF3B4E` | **LIVE only** — never for errors or decoration |

Supporting tints: `--ip-blue-100 #E3F2FF`, `--ip-lime-100 #EBFDDF`, borders `#E3EAF3`,
secondary text `#51627D`, tertiary `#8392A8`.

**Accessibility.** Lime and action blue are too light for text on white. Put text *on*
lime in navy; use `--ip-blue-700` for blue text/links; use `#2F7D0B` for green text.

**Event colors (calendar).** Match = navy · Team training = blue · Private coaching = lime.
Always paired with a text label, never color alone.

## 5. Typography

Font: **Heebo** (Google Fonts), fallback Rubik → system UI.

| Style | Size / weight | Use |
|---|---|---|
| Display | 28 / 800 | Big numbers, kickoff time |
| Title | 22 / 800 | Screen titles, child name (24) |
| Heading | 18 / 800 | Section headers |
| Body | 16 / 400–700 | Default text — never smaller for primary content |
| Secondary | 14 / 400 | Meta rows, subtitles |
| Label | 12 / 600 | Tags, tab labels, footnotes |

Numbers use `font-variant-numeric: tabular-nums` so scores and times don't jump.

## 6. Layout, spacing & shape

- **Mobile-first**, max content width 480px; 16px side gutters.
- 4pt spacing grid: 4 · 8 · 12 · 16 · 20 · 24 · 32. Sections are 20px apart.
- Radius: cards 22px, inner tiles 16px, chips/pills fully rounded.
- Elevation: cards use `--ip-shadow-1` (soft, low). Sheets use `--ip-shadow-2`.
- **Touch targets ≥ 48px** (buttons, tabs, list rows are 56–64px).

## 7. RTL rules

- `<html lang="he" dir="rtl">`; layouts use logical properties (`inset-inline-start`, `padding-inline-end`).
- Directional icons (chevrons, arrows) mirror automatically (`.ip-icon--mirror`).
- Scores render as separate flex items so the **home score sits next to the home team**
  (prevents the bidi algorithm from flipping "34:28").
- Signed numbers (`+6`) and Latin names are isolated with `direction:ltr; unicode-bidi:isolate`.
- Time flows right → left in charts and day strips (oldest/first on the right).

## 8. Iconography

`src/components/Icon.tsx` — one custom set on a 24px grid, 2px stroke, round caps and joins.
Active tab icons use a 2.4px stroke on a lime pill. Don't mix in filled or third‑party icons.

## 9. Components

All in `src/components/` and styled in `src/theme/components.css`:

| Component | Purpose |
|---|---|
| `Card` (`default` / `navy` / `live`) | Every content block |
| `SectionHeader` | Title + icon + optional "see all" link |
| `Button` (`primary` / `secondary` / `lime` / `ghost`) | Actions, 48px min height |
| `IconButton` | Header actions with optional count badge |
| `Tag`, `LiveBadge` | Status and type labels (use sparingly — one per card) |
| `StatTile`, `ProgressBar` | Career numbers and athletic progress |
| `MetaRow`, `ListRow` | Icon + text rows; tappable rows with chevron |
| `TeamCrest`, `Avatar`, `InitialsAvatar` | Teams, children (photo slot), adults |
| `AppHeader`, `ChildSwitcherPill`, `ChildSwitcherSheet`, `BottomSheet` | Shell & child switching |
| `BottomNav` | בית · קבוצה · יומן · קריירה · משפחה |
| `CareerChart` | Goals/assists by month (CVD-validated colors, direct labels, tooltip) |
| `Segmented` | In-screen section switcher (Team tab), sticky under the header |
| `Scoreline` | Crest + score + crest; home team always on the start (right) side |

**Live & reporting patterns** (match center): LIVE red is reserved for the badge and the
live card ring. Goal events use blue dots, the selected child's own events use a lime dot,
opponent events stay neutral. Every report from the stands shows the reporter's name and
can be undone by its author; a toast confirms that all parents were notified.

## 10. Content & tone

- Speak to the parent, about the child: "המשחק הבא של נועם", not "המשחק הבא של הקבוצה".
- Short, warm, practical. Lead with what the parent must do (arrive by, bring, confirm).
- Avoid badge overload: at most one tag per card; counts only on notifications.
- Demo content is fictional (names, clubs, venues).
