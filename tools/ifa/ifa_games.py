#!/usr/bin/env python3
"""Games from saved IFA pages -> payload for import_ifa_games() in Supabase.

Works only on pages saved from a browser (Ctrl+S). No network access.

  python3 -I tools/ifa/ifa_games.py --games team_games.html --league league_games.html > games.json

Pages (structure verified on saved pages, season 28):
  * team games:  /team-details/team-games/?team_id=7491&season_id=28  (all games of one team)
  * league games: /leagues/games/?league_id=640&season_id=28          (a window of dates only;
    the teams filter there is an ASP.NET postback, not a URL)
Both have rows `.games_table a.table_row` with labelled columns
(תאריך, משחק "home - away", אצטדיון, שעה, תוצאה) and a link
/leagues/games/game/?game_id=N. Future games carry game_id=-1 (no id yet).

Team ids: rows show names only. Ids come from the teams dropdown of a saved
league page (--league). A name that is not in the dropdown is NOT guessed:
the row is reported in "unmatched" and left out of the payload.

Rules: time 00:00 -> sent as "00:00" (the database stores it as not confirmed);
empty venue allowed; status 'played' when a result is shown, else 'scheduled'
(the page has no status column). Scores are parsed from "a - b" as home - away;
this order still has to be checked against a played game.
"""
import argparse, html, json, re, sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE = 'https://www.football.org.il'


def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(s or '')).strip()


def strip_tags(s):
    return clean(re.sub(r'<[^>]+>', ' ', s or ''))


def form_action(page):
    m = re.search(r'<form[^>]*action="([^"]*)"', page)
    if not m:
        return None, {}
    url = html.unescape(m.group(1))
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    return url, q


def dropdown_teams(page):
    """{name: ifa_team_id} from the league page teams dropdown."""
    m = re.search(r'<select[^>]*ddlTeams.*?</select>', page, re.S)
    if not m:
        return {}
    out = {}
    for value, name in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        if value.isdigit():
            out[strip_tags(name)] = int(value)
    return out


def league_title(page):
    m = re.search(r'<h1[^>]*page_main_title[^>]*>(.*?)</h1>', page, re.S)
    return strip_tags(m.group(1)) if m else ''


def game_rows(page):
    start = page.find('games_table')
    if start < 0:
        return []
    rows = []
    for href, body in re.findall(r'<a[^>]*class="table_row[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', page[start:], re.S):
        cols = {}
        for label, value in re.findall(r'<span class="sr-only">(.*?)</span>(.*?)</div>', body, re.S):
            cols[strip_tags(label)] = strip_tags(value)
        gid = parse_qs(urlparse(html.unescape(href)).query).get('game_id', [''])[0]
        rows.append({'game_id': gid, **cols})
    return rows


def to_payload(games_page, league_page=None, source_url=''):
    action, q = form_action(games_page)
    teams = dropdown_teams(league_page) if league_page else dropdown_teams(games_page)
    l_action, lq = form_action(league_page) if league_page else (None, {})
    season = int(q.get('season_id') or lq.get('season_id') or 0) or None
    scope_team = int(q['team_id']) if q.get('team_id', '').isdigit() else None
    league_id = q.get('league_id') or lq.get('league_id')
    payload = {
        'ifa_season_id': season,
        'ifa_league_id': int(league_id) if league_id and league_id.isdigit() else None,
        'league_name': league_title(league_page or games_page) if (league_page or 'league_id' in q) else None,
        'source_url': source_url or (BASE + action if action else ''),
        'scope': {'kind': 'team' if scope_team else 'league', 'ifa_team_id': scope_team},
        'games': [],
    }
    unmatched, problems, seen = [], [], set()
    for r in game_rows(games_page):
        match = r.get('משחק', '')
        if ' - ' not in match:
            problems.append({'row': r, 'error': 'no " - " between home and away'})
            continue
        home, away = [clean(x) for x in match.split(' - ', 1)]
        d = re.fullmatch(r'(\d{2})/(\d{2})/(\d{4})', r.get('תאריך', ''))
        if not d:
            problems.append({'row': r, 'error': 'date not dd/mm/yyyy'})
            continue
        t = r.get('שעה', '')
        if t and not re.fullmatch(r'\d{1,2}:\d{2}', t):
            problems.append({'row': r, 'error': f'time {t!r} not HH:MM'})
            continue
        hid, aid = teams.get(home), teams.get(away)
        if hid is None or aid is None:
            unmatched.append({'date': r.get('תאריך'), 'home': home, 'away': away,
                              'missing': [n for n, i in ((home, hid), (away, aid)) if i is None]})
            continue
        key = (hid, aid)
        if key in seen:
            problems.append({'row': r, 'error': 'same home/away pairing twice on the page'})
            continue
        seen.add(key)
        res = r.get('תוצאה', '')
        sm = re.fullmatch(r'(\d+)\s*-\s*(\d+)', res)
        payload['games'].append({
            'ifa_game_id': r['game_id'] if r['game_id'].isdigit() and int(r['game_id']) > 0 else '-1',
            'date': f'{d.group(3)}-{d.group(2)}-{d.group(1)}',
            'time': t or None,
            'home_ifa_team_id': hid, 'away_ifa_team_id': aid,
            'home_name': home, 'away_name': away,
            'venue': r.get('אצטדיון', ''),
            'status': 'played' if res else 'scheduled',
            'result_raw': res,
            'home_score': int(sm.group(1)) if sm else None,
            'away_score': int(sm.group(2)) if sm else None,
        })
    return payload, {'rows': len(game_rows(games_page)), 'games': len(payload['games']),
                     'with_ifa_id': sum(1 for g in payload['games'] if g['ifa_game_id'] != '-1'),
                     'time_00_00': sum(1 for g in payload['games'] if g['time'] in (None, '00:00')),
                     'no_venue': sum(1 for g in payload['games'] if not g['venue']),
                     'teams_in_dropdown': len(teams), 'unmatched': unmatched, 'problems': problems}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--games', required=True, help='saved team-games or league-games page')
    ap.add_argument('--league', help='saved league-games page (for the team ids in its dropdown)')
    ap.add_argument('--source-url', default='')
    ap.add_argument('--report', action='store_true', help='print the check report to stderr')
    a = ap.parse_args()
    games = Path(a.games).read_text(encoding='utf-8', errors='replace')
    league = Path(a.league).read_text(encoding='utf-8', errors='replace') if a.league else None
    payload, report = to_payload(games, league, a.source_url)
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=1)
    print(file=sys.stdout)
    if a.report or report['unmatched'] or report['problems']:
        json.dump(report, sys.stderr, ensure_ascii=False, indent=1)
        print(file=sys.stderr)


if __name__ == '__main__':
    main()
