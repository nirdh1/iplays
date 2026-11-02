#!/usr/bin/env python3
"""Watch the folders of saved IFA pages on the owner's Mac and process new saves.

No network access to the IFA site: the owner refreshes pages by hand in Chrome
("Webpage, Complete"). This tool only reads the saved files and, with --send,
talks to Supabase with the public anon key + the agent key (tools/ifa/agent.env).

  # check only: what changed since the last run, what would be sent
  python3 -I tools/ifa/ifa_watch.py --root ~/iplays_clude/ifa_pages

  # send: rosters become proposals for the coach, games are applied
  python3 -I tools/ifa/ifa_watch.py --root ~/iplays_clude/ifa_pages --send

  # keep watching, every 60 seconds
  python3 -I tools/ifa/ifa_watch.py --root ~/iplays_clude/ifa_pages --send --watch 60

  # also read flat update folders (save fresh copies there under any name)
  python3 -I tools/ifa/ifa_watch.py --root ~/iplays_clude/ifa_pages \
      --inbox ~/iplays_clude/ifa_updates/משחקים --inbox ~/iplays_clude/ifa_updates/סגלים --send --watch 60

Layout (spec section 13; the existing folders are reused, nothing is moved):
  <root>/MatchRounds/index.json   one entry per league (league_id, local_path, ...)
  <root>/MatchRounds/state.json   sha256 of every processed file (written by this tool)
  <root>/MatchRounds/log.jsonl    one line per processed file (written by this tool)
  <league local_path>/league_<id>.html               league page (teams dropdown)
  <league local_path>/saved/<team_id>/roster.html     roster page
  <league local_path>/saved_games/<team_id>/team_games.html   all games of one team

Update folders (--inbox, repeatable): any file name, any sub folder. A league
page there updates its league; a roster or team-games page goes to the league
whose saved league page lists the team (a games page of a team no saved league
page lists is refused until that league page is saved). Files there are never
moved or deleted; a re-saved copy with new content is sent again.

A file is identified by what is inside it (the page's own form action: team_id
or league_id), not by its name or folder, so a misnamed or misplaced save still
counts. A file is processed only after it has not changed for --settle seconds
(Chrome writes the page and its _files folder in several steps), and only when
its content changed since the last processed version.

What happens with --send:
  * roster of a team already imported -> agent_propose_ifa_roster: differences
    wait for the coach (nothing in the team changes);
  * roster of a team not imported yet -> written to MatchRounds/first_import.sql
    for the owner to review and run in the SQL Editor (the agent key cannot
    create teams);
  * team games page -> agent_import_ifa_games: date, time, venue, status and
    result follow the page; a coach's own value still wins field by field.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from batch_saved_import import validate_roster  # noqa: E402
from ifa_collector import load_saved  # noqa: E402
from ifa_games import dropdown_teams, form_action, league_title, to_payload  # noqa: E402

BASE = 'https://www.football.org.il'


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def read_text(path):
    return Path(path).read_text(encoding='utf-8', errors='replace')


def classify(page, file_path=None):
    """('league', league_id, season) | ('games', team_id, season) | ('roster', team_id, season) | (None, None, None).

    The page's own form action decides. A roster page without one (trimmed
    copy) falls back to its folder name saved/<team_id>/ when that is a number.
    """
    action, q = form_action(page)
    season = int(q['season_id']) if q.get('season_id', '').isdigit() else None
    path = (action or '').split('?')[0].lower()
    if '/team-details/team-games' in path and q.get('team_id', '').isdigit():
        return 'games', int(q['team_id']), season
    if '/leagues/games' in path and q.get('league_id', '').isdigit():
        return 'league', int(q['league_id']), season
    if '/team-details' in path and q.get('team_id', '').isdigit() and 'teamPlayers' in page:
        return 'roster', int(q['team_id']), season
    if not action and 'id="teamPlayers"' in page:
        m = re.search(r'season_id=(\d+)', page)
        season = int(m.group(1)) if m else None
        if file_path is not None and file_path.parent.name.isdecimal():
            return 'roster', int(file_path.parent.name), season
        ids = set(re.findall(r'team_id=(\d+)', page))
        if len(ids) == 1:  # a trimmed copy whose links all name one team
            return 'roster', int(ids.pop()), season
    return None, None, None


def settled(path, settle):
    """True when the file and its Chrome _files folder have not changed for `settle` seconds."""
    newest = path.stat().st_mtime
    companion = path.with_name(path.stem + '_files')
    if companion.is_dir():
        for p in companion.rglob('*'):
            try:
                newest = max(newest, p.stat().st_mtime)
            except OSError:
                return False
    return time.time() - newest >= settle


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, path)


class Api:
    """Supabase RPC with the public anon key + the agent key. No service_role."""

    def __init__(self, env_path):
        import requests  # only needed with --send

        self.requests = requests
        if env_path.is_file():
            for line in env_path.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        missing = [k for k in ('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'IFA_AGENT_KEY') if not os.environ.get(k)]
        if missing:
            sys.exit(f'missing settings: {", ".join(missing)} ({env_path})')
        self.url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/rpc/'
        self.key = os.environ['IFA_AGENT_KEY']
        anon = os.environ['SUPABASE_ANON_KEY']
        self.headers = {'apikey': anon, 'Authorization': f'Bearer {anon}', 'Content-Type': 'application/json'}

    def call(self, fn, payload):
        r = self.requests.post(self.url + fn, headers=self.headers,
                               data=json.dumps({'p_key': self.key, 'p_payload': payload}, ensure_ascii=False).encode('utf-8'),
                               timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f'{fn}: HTTP {r.status_code} {r.text[:300]}')
        return r.json() if r.text else None


def league_folders(root, index):
    out = []
    for entry in index.get('leagues', []):
        p = entry.get('local_path')
        if p:
            folder = Path(os.path.expanduser(p))
            if folder.is_dir():
                out.append((entry, folder))
    return out


def scan(folder):
    """Every saved html page under a league folder (top level, saved/, saved_games/)."""
    files = [p for p in folder.glob('*.html')]
    for sub in ('saved', 'saved_games'):
        d = folder / sub
        if d.is_dir():
            files += [p for p in d.rglob('*.html') if '_files' not in p.parts[-2]]
    return sorted(set(files))


def first_import_sql(path, payloads):
    lines = ['-- First import of teams whose roster was saved before they were imported.',
             '-- Written by tools/ifa/ifa_watch.py. Review, then run in the Supabase SQL Editor.',
             '-- Step 1 (dry run) shows what would be added; step 2 applies.', '']
    for p in payloads:
        body = json.dumps(p, ensure_ascii=False).replace("'", "''")
        lines.append(f"-- team {p['ifa_team_id']}: {p['team_name']} ({len(p['players'])} players)")
        lines.append(f"select sync_ifa_roster('{body}'::jsonb, false);  -- dry run")
        lines.append(f"-- select sync_ifa_roster('{body}'::jsonb, true);  -- apply after checking")
        lines.append('')
    path.write_text('\n'.join(lines), encoding='utf-8')


def update_league_entry(entry, page, f):
    teams = dropdown_teams(page)
    entry['league_name'] = re.sub(r'^\s*\d{4}/\d{4}\s*', '', league_title(page)) or entry.get('league_name')
    entry['teams'] = len(teams)
    entry['league_html'] = str(f)
    entry['last_saved_at'] = datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat(timespec='seconds')
    if not teams:
        entry['status'] = 'empty_no_season28'
    elif entry.get('status') in (None, 'not_saved', 'empty_no_season28'):
        entry['status'] = 'links_ready'
    return teams


def handle(kind, ident, season, f, rel, digest, page, entry, league_page, api, state, pending_first, summary, log):
    """Process one changed page. Returns the league page when `page` is one, else None.

    `entry` is the index entry of the page's league (None when unknown: a roster
    is still proposed, without the league tag; a games page is refused because
    its opponents cannot be matched to IFA team ids).
    """
    result = {'file': rel, 'kind': kind, 'id': ident}
    new_league = None
    try:
        if kind is None:
            result['note'] = 'not an IFA league, roster or team-games page; ignored'
        elif kind == 'league':
            result['teams'] = len(update_league_entry(entry, page, f))
            new_league = page
            summary['leagues'] += 1
        elif kind == 'roster':
            payload = validate_roster(load_saved(f), ident, season or 28,
                                      f'{BASE}/team-details/?team_id={ident}&season_id={season or 28}')
            if entry:
                payload['ifa_league_id'] = entry.get('league_id')
                if entry.get('league_name'):
                    payload['league_name'] = entry['league_name']
                result['league'] = entry.get('league_id')
            result['players'] = len(payload['players'])
            if api:
                r = api.call('agent_propose_ifa_roster', payload)
                result['server'] = r
                if r and not r.get('ok') and 'not imported yet' in (r.get('error') or ''):
                    pending_first[str(ident)] = payload
                    result['note'] = 'team not imported yet: added to MatchRounds/first_import.sql'
                elif r and not r.get('ok'):
                    raise RuntimeError(r.get('error') or 'refused')
            summary['rosters'] += 1
        elif kind == 'games':
            if not league_page:
                raise RuntimeError('no saved league page lists this team: save the league page first, then this page again')
            payload, report = to_payload(page, league_page, f'{BASE}/team-details/team-games/?team_id={ident}&season_id={season or 28}')
            payload['ifa_league_id'] = payload.get('ifa_league_id') or (entry or {}).get('league_id')
            result.update({'league': payload['ifa_league_id'], 'games': report['games'],
                           'unmatched': len(report['unmatched']), 'problems': len(report['problems'])})
            if report['problems']:
                raise RuntimeError(f'{len(report["problems"])} rows could not be read: {report["problems"][:2]}')
            if api:
                r = api.call('agent_import_ifa_games', payload)
                result['server'] = {k: r.get(k) for k in ('ok', 'error', 'new', 'changed', 'same', 'queued')} if r else None
                if r and not r.get('ok'):
                    raise RuntimeError(r.get('error') or 'refused')
            summary['games'] += 1
        if api:
            state[rel] = {'sha256': digest, 'kind': kind, 'id': ident, 'processed_at': now_iso()}
    except Exception as exc:  # one bad file must not stop the others
        result['error'] = str(exc)
        summary['errors'] += 1
    log(result)
    return new_league


def scan_inbox(folder):
    """Every saved html page anywhere under an update folder (Chrome's _files folders excluded)."""
    return sorted(p for p in folder.rglob('*.html') if not any(part.endswith('_files') for part in p.parent.parts))


def team_leagues(index):
    """{ifa_team_id: (entry, league page)} from every league page the index knows."""
    out = {}
    for entry in index.get('leagues', []):
        html = entry.get('league_html')
        if not html:
            continue
        path = Path(os.path.expanduser(html))
        if not path.is_file():
            continue
        page = read_text(path)
        for team_id in dropdown_teams(page).values():
            out[team_id] = (entry, page)
    return out


def run_inboxes(inboxes, index, api, settle, state, pending_first, summary, log):
    """Flat update folders: any file name, any sub folder. Each page is routed by its content:
    a league page updates its league; a roster or games page goes to the league whose
    saved league page lists the team."""
    pages = []
    for inbox in inboxes:
        if not inbox.is_dir():
            log({'inbox': str(inbox), 'error': 'folder not found'})
            summary['errors'] += 1
            continue
        for f in scan_inbox(inbox):
            rel = str(f)
            try:
                if not settled(f, settle):
                    summary['skipped_unsettled'] += 1
                    continue
                digest = sha256(f)
                if state.get(rel, {}).get('sha256') == digest:
                    summary['unchanged'] += 1
                    continue
                page = read_text(f)
                kind, ident, season = classify(page, f)
                pages.append((kind, ident, season, f, rel, digest, page))
            except OSError as exc:
                log({'file': rel, 'error': str(exc)})
                summary['errors'] += 1
    order = {'league': 0, 'roster': 1, 'games': 2}
    pages.sort(key=lambda x: order.get(x[0], 3))

    by_league = {e.get('league_id'): e for e in index.get('leagues', [])}
    teams = None
    for kind, ident, season, f, rel, digest, page in pages:
        entry, league_page = None, None
        if kind == 'league':
            entry = by_league.get(ident)
            if entry is None:
                entry = {'league_id': ident, 'local_path': None, 'league_html': None, 'status': 'not_saved'}
                index.setdefault('leagues', []).append(entry)
                by_league[ident] = entry
        elif kind in ('roster', 'games'):
            if teams is None:
                teams = team_leagues(index)
            entry, league_page = teams.get(ident, (None, None))
        if handle(kind, ident, season, f, rel, digest, page, entry, league_page, api, state, pending_first, summary, log):
            teams = None  # a new league page: rebuild the team -> league map
            if api:
                entry['last_processed_at'] = now_iso()
        elif entry is not None and api and kind in ('roster', 'games'):
            entry['last_processed_at'] = now_iso()


def run_once(root, api, settle, log, inboxes=()):
    mr = root / 'MatchRounds'
    mr.mkdir(exist_ok=True)
    index_path = mr / 'index.json'
    index = load_json(index_path, {'leagues': []})
    state = load_json(mr / 'state.json', {})
    pending_first = load_json(mr / 'first_import.json', {})
    summary = {'leagues': 0, 'rosters': 0, 'games': 0, 'skipped_unsettled': 0, 'unchanged': 0, 'errors': 0}

    for entry, folder in league_folders(root, index):
        files = scan(folder)
        # league page first (team ids for the games pages), then rosters, then games
        pages = []
        for f in files:
            rel = str(f.relative_to(root)) if f.is_relative_to(root) else str(f)
            try:
                if not settled(f, settle):
                    summary['skipped_unsettled'] += 1
                    continue
                digest = sha256(f)
                if state.get(rel, {}).get('sha256') == digest:
                    summary['unchanged'] += 1
                    continue
                page = read_text(f)
                kind, ident, season = classify(page, f)
                pages.append((kind, ident, season, f, rel, digest, page))
            except OSError as exc:
                log({'file': rel, 'error': str(exc)})
                summary['errors'] += 1
        order = {'league': 0, 'roster': 1, 'games': 2}
        pages.sort(key=lambda x: order.get(x[0], 3))

        league_page = None
        league_html = entry.get('league_html')
        if league_html and Path(os.path.expanduser(league_html)).is_file():
            league_page = read_text(Path(os.path.expanduser(league_html)))

        for kind, ident, season, f, rel, digest, page in pages:
            if kind == 'league' and ident != entry.get('league_id'):
                log({'file': rel, 'kind': kind, 'id': ident,
                     'note': f'league page of {ident} inside the folder of {entry.get("league_id")}; ignored'})
                continue
            new_league = handle(kind, ident, season, f, rel, digest, page, entry, league_page, api, state, pending_first, summary, log)
            if new_league:
                league_page = new_league
        if api and pages:
            entry['last_processed_at'] = now_iso()

    if inboxes:
        run_inboxes(inboxes, index, api, settle, state, pending_first, summary, log)

    if api:
        save_json(mr / 'state.json', state)
        save_json(index_path, index)
        save_json(mr / 'first_import.json', pending_first)
        if pending_first:
            first_import_sql(mr / 'first_import.sql', list(pending_first.values()))
    return summary


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', type=Path, required=True, help='the ifa_pages folder (holds MatchRounds/index.json)')
    ap.add_argument('--send', action='store_true', help='send to Supabase with the agent key and remember processed files')
    ap.add_argument('--watch', type=int, metavar='SECONDS', help='keep running, checking every N seconds (minimum 15)')
    ap.add_argument('--settle', type=int, default=20, help='seconds a file must be unchanged before it is read')
    ap.add_argument('--env', type=Path, default=HERE / 'agent.env')
    ap.add_argument('--inbox', type=Path, action='append', default=[], metavar='DIR',
                    help='a flat update folder (repeatable): save fresh pages there under any name')
    args = ap.parse_args()
    root = args.root.expanduser()
    if not (root / 'MatchRounds' / 'index.json').is_file():
        ap.error(f'{root}/MatchRounds/index.json not found')
    api = Api(args.env) if args.send else None
    log_path = root / 'MatchRounds' / 'log.jsonl'

    def log(row):
        row = {'t': now_iso(), **row}
        print(json.dumps(row, ensure_ascii=False), flush=True)
        if api:
            with open(log_path, 'a', encoding='utf-8') as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + '\n')

    while True:
        summary = run_once(root, api, args.settle, log, [d.expanduser() for d in args.inbox])
        print(json.dumps({'t': now_iso(), 'summary': summary, 'sent': bool(api)}, ensure_ascii=False), flush=True)
        if not args.watch:
            break
        time.sleep(max(args.watch, 15))


if __name__ == '__main__':
    main()
