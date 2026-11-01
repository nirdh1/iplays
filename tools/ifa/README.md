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
