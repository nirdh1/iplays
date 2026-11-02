#!/usr/bin/env python3
"""iPlays local IFA agent (pilot). Runs on the owner's own computer.

It picks up "הרץ בדיקה" requests made in the admin panel (#ifa), loads each
team's roster page with a plain Playwright Chromium, parses and validates it,
and sends the result back as a DRY RUN. Nothing is imported until a platform
admin clicks "ייבוא" in the panel.

Rules (not configurable):
  * no stealth, no changed user agent or fingerprint, no proxy, no CAPTCHA solving;
  * one load per page, no retries; on HTTP 403 / 429 / 503 or a challenge page the
    whole run stops and every request it holds is reported as failed;
  * robots.txt is read once per run and respected;
  * at least --delay seconds between pages, at most --max-pages pages per run;
  * only id, name and profile link are sent (no photos).

Setup (once):
  python3 -m venv .venv && .venv/bin/pip install -r tools/ifa/requirements.txt playwright
  .venv/bin/playwright install chromium
  cp tools/ifa/agent.env.example tools/ifa/agent.env   # fill in; never commit it

Run:
  .venv/bin/python tools/ifa/ifa_agent.py            # one pass, then exit
  .venv/bin/python tools/ifa/ifa_agent.py --headed   # show the browser window
  .venv/bin/python tools/ifa/ifa_agent.py --check 7491   # load one page, print, send nothing
  .venv/bin/python tools/ifa/ifa_agent.py --from-files tools/ifa/saved   # no network: answer from
      authorized-source JSON (<team_id>.json) or saved pages (<team_id>/roster.html)

Status 2026-11-01: headless loads get a Cloudflare block page, so live fetching is paused
until the IFA grants access (see README). Do not switch to --headed to get past a block.

A launchd example (every 5 minutes while the Mac is awake) is in tools/ifa/README.md.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import robotparser

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from batch_saved_import import is_masked, validate_roster  # noqa: E402

BASE = 'https://www.football.org.il'
ROSTER_ITEM = '%7B2AE09DED-5019-4C49-BFD5-4458C66F9D24%7D'
BLOCK_STATUS = {403, 429, 503}
CHALLENGE_MARKS = ('Attention Required', 'Just a moment', 'cf-chl-')


def log(event, **kw):
    print(json.dumps({'t': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'event': event, **kw}, ensure_ascii=False), flush=True)


def roster_url(team_id, season):
    return f'{BASE}/team-details/?itemid={ROSTER_ITEM}&team_id={team_id}&season_id={season}'


def load_env(path):
    if path.is_file():
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    missing = [k for k in ('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'IFA_AGENT_KEY') if not os.environ.get(k)]
    if missing:
        sys.exit(f'missing settings: {", ".join(missing)} (tools/ifa/agent.env)')


class Api:
    """Supabase RPC with the public anon key + the agent's own key. No service_role."""

    def __init__(self):
        self.url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/rpc/'
        self.key = os.environ['IFA_AGENT_KEY']
        anon = os.environ['SUPABASE_ANON_KEY']
        self.headers = {'apikey': anon, 'Authorization': f'Bearer {anon}', 'Content-Type': 'application/json'}

    def call(self, fn, **args):
        r = requests.post(self.url + fn, headers=self.headers, data=json.dumps({'p_key': self.key, **args}), timeout=30)
        if r.status_code >= 300:
            raise RuntimeError(f'{fn}: HTTP {r.status_code} {r.text[:300]}')
        return r.json() if r.text else None


class Blocked(Exception):
    pass


def fetch_roster(page, team_id, season):
    url = roster_url(team_id, season)
    resp = page.goto(url, wait_until='domcontentloaded', timeout=45000)
    status = resp.status if resp else None
    title = page.title()
    head = page.content()[:20000]
    if status in BLOCK_STATUS or any(m.lower() in (title + head).lower() for m in CHALLENGE_MARKS):
        # keep the evidence (for the site owner / an access request), never retry
        ray = resp.headers.get('cf-ray') if resp else None
        code = re.search(r'Error code:?\s*(?:<[^>]+>\s*)*(\d{3,4})', head)
        raise Blocked(f'blocked or challenge page (HTTP {status}, title {title!r}, cf-ray {ray}, '
                      f'cloudflare code {code.group(1) if code else None}); stopped, not retried')
    try:
        page.wait_for_selector('#teamPlayers', timeout=15000)
    except Exception:
        pass  # validated below: an empty roster is refused
    html = page.content()
    info = {'url': url, 'http_status': status, 'title': title, 'fetched_at': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    return html, info


def robots_allows(page):
    resp = page.request.get(BASE + '/robots.txt', timeout=30000)
    if resp.status in BLOCK_STATUS:
        raise Blocked(f'robots.txt returned HTTP {resp.status}; stopped')
    rp = robotparser.RobotFileParser()
    rp.parse(resp.text().splitlines() if resp.ok else [])
    return rp.can_fetch('*', BASE + '/team-details/')


def payload_from_file(folder, team, season):
    """Authorized source or saved page -> validated payload. No network."""
    js = folder / f'{team}.json'
    html = folder / str(team) / 'roster.html'
    if js.is_file():
        p = json.loads(js.read_text(encoding='utf-8'))
        if int(p.get('ifa_team_id', 0)) != team or int(p.get('ifa_season_id', 0)) != season:
            raise ValueError(f'{js.name} is for another team or season')
        players = p.get('players') or []
        if not players or any(not str(x.get('ifa_player_id', '')).isdigit() or not str(x.get('name', '')).strip() for x in players):
            raise ValueError(f'{js.name}: empty roster or a player without numeric id / name')
        p['players'] = [{'ifa_player_id': str(x['ifa_player_id']), 'name': str(x['name']).strip(),
                         'profile_url': str(x.get('profile_url', ''))}
                        for x in players if not is_masked(str(x['name']))]  # id, name, link only; masked names skipped
        if not p['players']:
            raise ValueError(f'{js.name}: no player with a readable name')
        p.setdefault('sport', 'football')
        p.setdefault('source_url', f'file:{js.name}')
        return p, {'source': 'file', 'file': js.name}
    if html.is_file():
        soup = BeautifulSoup(html.read_text(encoding='utf-8', errors='replace'), 'html.parser')
        return validate_roster(soup, team, season, f'saved-page:{team}/roster.html'), {'source': 'saved_page', 'file': f'{team}/roster.html'}
    raise FileNotFoundError(f'no {team}.json or {team}/roster.html in {folder}')


def answer_from_files(api, folder, max_pages):
    jobs = api.call('agent_claim_ifa_requests', p_limit=max_pages) or []
    log('claimed', count=len(jobs), mode='files')
    for job in jobs:
        team, season = int(job['ifa_team_id']), int(job['ifa_season_id'])
        try:
            payload, info = payload_from_file(folder, team, season)
        except (ValueError, FileNotFoundError, json.JSONDecodeError) as exc:
            log('file_failed', team=team, error=str(exc))
            api.call('agent_fail_ifa_request', p_request=job['id'], p_error=f'file: {exc}', p_fetch_info={'source': 'file'})
            continue
        info['players'] = len(payload['players'])
        res = api.call('agent_submit_ifa_roster', p_request=job['id'], p_payload=payload, p_fetch_info=info)
        log('submitted', team=team, players=info['players'], ok=res.get('ok'), summary=res.get('summary'), error=res.get('error'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--env', type=Path, default=Path(__file__).resolve().parent / 'agent.env')
    ap.add_argument('--headed', action='store_true', help='show the browser window')
    ap.add_argument('--delay', type=float, default=8.0, help='seconds between pages (minimum 5)')
    ap.add_argument('--max-pages', type=int, default=5, help='pages per run (maximum 20)')
    ap.add_argument('--check', type=int, metavar='TEAM_ID', help='load one roster page, print the parsed result, send nothing')
    ap.add_argument('--season', type=int, default=28)
    ap.add_argument('--from-files', type=Path, metavar='DIR',
                    help='no network: answer requests from files instead of the site. For each request, '
                         'DIR/<team_id>.json (import payload from an authorized source, e.g. an IFA data export) '
                         'or DIR/<team_id>/roster.html (a page saved in the browser)')
    a = ap.parse_args()
    delay = max(a.delay, 5.0)
    max_pages = min(max(a.max_pages, 1), 20)

    if a.from_files is not None:
        load_env(a.env)
        return answer_from_files(Api(), a.from_files, max_pages)

    from playwright.sync_api import sync_playwright

    api = None
    if a.check is None:
        load_env(a.env)
        api = Api()
        jobs = api.call('agent_claim_ifa_requests', p_limit=max_pages) or []
        log('claimed', count=len(jobs))
        if not jobs:
            return
    else:
        jobs = [{'id': None, 'kind': 'roster', 'ifa_team_id': a.check, 'ifa_season_id': a.season}]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not a.headed)
        page = browser.new_page(locale='he-IL')
        pending = list(jobs)
        try:
            if not robots_allows(page):
                raise Blocked('robots.txt does not allow /team-details/; stopped')
            first = True
            while pending:
                job = pending.pop(0)
                if not first:
                    time.sleep(delay)
                first = False
                team, season = int(job['ifa_team_id']), int(job['ifa_season_id'])
                try:
                    html, info = fetch_roster(page, team, season)
                except Blocked:
                    pending.insert(0, job)
                    raise
                except Exception as exc:  # timeout, network: this page only, no retry
                    log('fetch_failed', team=team, error=str(exc)[:300])
                    if api:
                        api.call('agent_fail_ifa_request', p_request=job['id'], p_error=f'load failed: {str(exc)[:300]}', p_fetch_info={})
                    continue
                try:
                    payload = validate_roster(BeautifulSoup(html, 'html.parser'), team, season, info['url'])
                except ValueError as exc:
                    log('invalid_page', team=team, error=str(exc), http_status=info['http_status'])
                    if api:
                        api.call('agent_fail_ifa_request', p_request=job['id'], p_error=f'page not valid: {exc}', p_fetch_info=info)
                    continue
                info['players'] = len(payload['players'])
                if api is None:
                    log('checked_locally', team=team, team_name=payload['team_name'], http_status=info['http_status'],
                        players=info['players'], ids=[p['ifa_player_id'] for p in payload['players']])
                    continue
                res = api.call('agent_submit_ifa_roster', p_request=job['id'], p_payload=payload, p_fetch_info=info)
                log('submitted', team=team, players=info['players'], ok=res.get('ok'), summary=res.get('summary'), error=res.get('error'))
        except Blocked as exc:
            log('blocked', error=str(exc), stopping=True, remaining=len(pending))
            if api:
                for job in pending:
                    api.call('agent_fail_ifa_request', p_request=job['id'], p_error=str(exc), p_fetch_info={})
            sys.exit(2)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
