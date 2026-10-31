# iplays

**המשחק שלהם. העולם שלך.** — a premium Hebrew (RTL) youth sports app for parents.

This is the first pass of the iplays rebrand: brand assets, a style guide, the new
child-first home screen, the child switcher, a career overview preview and the shared
component library that the remaining screens will be rebuilt on.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

Routes (hash based, add `/<childId>` to pick a child, e.g. `#home/maya`):

| Route | Screen |
|---|---|
| `#home` | Home — child-first dashboard |
| `#team` | Team: overview, matches & standings, training RSVP, team fund, roster |
| `#match` | LIVE match center with goal / basket reporting |
| `#calendar` | Weekly calendar for all children |
| `#career` | Career overview preview |
| `#family` | Children, family permissions, carpools |
| `#brand` | Living brand style guide |

Demo children: `noam` (football), `maya` (basketball, live game now), `itay` (football).

## Structure

```
public/brand/          logo, symbol, light/dark app icons (SVG)
docs/                  brand style guide + screenshots
src/theme/             design tokens, base and component styles
src/components/        reusable components (Logo, Icon, Avatar, ui, shell, CareerChart)
src/screens/           Home, Career, Team/Calendar/Family, Brand
src/data/demo.ts       fictional Hebrew demo content
```

See [docs/brand-style-guide.md](docs/brand-style-guide.md) for the brand rules.
