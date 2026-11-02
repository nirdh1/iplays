#!/usr/bin/env python3
"""Offline test of ifa_watch.py on synthetic fixtures (no network, fake API).

  python3 -I tools/ifa/test_ifa_watch.py
"""
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ifa_watch  # noqa: E402

FIX = HERE / 'fixtures'


class FakeApi:
    def __init__(self, imported=True):
        self.calls = []
        self.imported = imported

    def call(self, fn, payload):
        self.calls.append((fn, payload))
        if fn == 'agent_propose_ifa_roster' and not self.imported:
            return {'ok': False, 'error': 'team not imported yet: run the first import (import_ifa_team) for it'}
        if fn == 'agent_propose_ifa_roster':
            return {'ok': True, 'new_pending': 1}
        return {'ok': True, 'new': len(payload['games']), 'changed': 0, 'same': 0, 'queued': 0}


def check(ok, what):
    if not ok:
        raise SystemExit(f'FAIL: {what}')
    print(f'ok  {what}')


def make_root():
    root = Path(tempfile.mkdtemp())
    league = root / 'leagues' / '08 טרום ב' / 'ליגת בדיקה (9640)'
    (league / 'saved' / '9001').mkdir(parents=True)
    (league / 'saved_games' / '9001').mkdir(parents=True)
    shutil.copy(FIX / 'league_games.html', league / 'league_9640.html')
    shutil.copy(FIX / 'roster.html', league / 'saved' / '9001' / 'roster.html')
    # a games page saved with the browser's own name, in the wrong folder
    shutil.copy(FIX / 'team_games.html', league / 'saved' / '9001' / 'ההתאחדות לכדורגל בישראל - כל משחקי קבוצה.html')
    (root / 'MatchRounds').mkdir()
    (root / 'MatchRounds' / 'index.json').write_text(json.dumps({'schema_version': 1, 'leagues': [
        {'league_id': 9640, 'local_path': str(league), 'league_html': None, 'status': 'not_saved'}]}), encoding='utf-8')
    old = time.time() - 120
    for p in root.rglob('*'):
        os.utime(p, (old, old))
    return root, league


def main():
    rows = []
    root, league = make_root()

    # check only: nothing sent, nothing remembered
    s = ifa_watch.run_once(root, None, 20, rows.append)
    check(s['leagues'] == 1 and s['rosters'] == 1 and s['games'] == 1 and s['errors'] == 0, 'check: league, roster and games page found')
    check(not (root / 'MatchRounds' / 'state.json').exists(), 'check: nothing remembered without --send')
    check(any(r.get('kind') == 'games' and r.get('games') == 2 for r in rows), 'check: misnamed games page read by its content (2 games)')
    check(any(r.get('kind') == 'roster' and r.get('players') == 2 for r in rows), 'check: roster read, staff and duplicates skipped (2 players)')

    # send: roster proposed, games applied, state written
    api = FakeApi()
    s = ifa_watch.run_once(root, api, 20, rows.append)
    fns = [c[0] for c in api.calls]
    check(fns == ['agent_propose_ifa_roster', 'agent_import_ifa_games'], 'send: roster proposed before games applied')
    check(api.calls[1][1]['scope'] == {'kind': 'team', 'ifa_team_id': 9001}, 'send: games scoped to team 9001')
    idx = json.loads((root / 'MatchRounds' / 'index.json').read_text(encoding='utf-8'))['leagues'][0]
    check(idx['teams'] == 2 and idx['status'] == 'links_ready' and idx['last_processed_at'], 'send: index updated (teams, status, processed time)')

    # nothing changed: nothing sent again
    api2 = FakeApi()
    s = ifa_watch.run_once(root, api2, 20, rows.append)
    check(not api2.calls and s['unchanged'] == 3, 'unchanged files are not sent again')

    # a fresh save is not read until it settles
    roster = league / 'saved' / '9001' / 'roster.html'
    roster.write_text(roster.read_text(encoding='utf-8').replace('שחקן א', 'שחקן אלף'), encoding='utf-8')
    api3 = FakeApi()
    s = ifa_watch.run_once(root, api3, 20, rows.append)
    check(not api3.calls and s['skipped_unsettled'] == 1, 'a file still being saved waits')
    old = time.time() - 120
    os.utime(roster, (old, old))
    s = ifa_watch.run_once(root, api3, 20, rows.append)
    check([c[0] for c in api3.calls] == ['agent_propose_ifa_roster'], 'after it settles, only the changed roster is sent')

    # a team not imported yet goes to first_import.sql, not to the server as an import
    root2, _ = make_root()
    api4 = FakeApi(imported=False)
    ifa_watch.run_once(root2, api4, 20, rows.append)
    sql = (root2 / 'MatchRounds' / 'first_import.sql').read_text(encoding='utf-8')
    check('sync_ifa_roster' in sql and '-- select sync_ifa_roster' in sql, 'team not imported: written to first_import.sql (dry run first, apply commented)')
    print('ALL WATCH TESTS PASSED')


if __name__ == '__main__':
    main()
