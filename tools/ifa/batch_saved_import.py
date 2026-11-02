#!/usr/bin/env python3
"""Offline, review-first batch import of IFA roster HTML saved by the operator.

Input layout: saved/<team_id>/roster.html; optional saved/<team_id>/team.html.
Produces a JSON report and two SQL files for manual review. No network or DB writes.

  python3 tools/ifa/batch_saved_import.py --saved tools/ifa/saved --out out/

  out/review.json         accepted teams (validated) and rejected folders with the reason
  out/review_dryrun.sql   sync_ifa_roster(p, false): shows added / missing / returned /
                          renamed players per team; changes nothing but the run log
  out/review_apply.sql    sync_ifa_roster(p, true): run only after the dry run was checked

The database refuses an empty roster, or one that drops below half of the active
roster, and never deletes a player: one no longer on the page is marked missing.
"""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ifa_collector import load_saved, roster_players

# The IFA site shows some children's names masked ("*****"). Such a name is not
# imported: no letter (Hebrew or Latin) means no real name to show.
HAS_LETTER = re.compile(r'[A-Za-z\u0590-\u05FF]')


def is_masked(name):
    return not HAS_LETTER.search(name or '')


def team_name(soup):
    heading = soup.select_one('h1')
    if not heading:
        return None
    value = heading.get_text(' ', strip=True)
    value = re.sub(r'^\s*סגל שחקנים\s*', '', value).strip()
    return value or None


def validate_roster(soup, team_id, season, source_url, fallback_soup=None):
    """Parsed roster page -> import_ifa_team payload, or ValueError. Shared with ifa_agent.py."""
    players = [p for p in roster_players(soup, team_id, season) if not is_masked(p['name'])]
    if not players:
        raise ValueError('no verified #teamPlayers entries; refusing empty import')
    name = team_name(soup)
    if not name and fallback_soup is not None:
        name = team_name(fallback_soup)
    if not name:
        raise ValueError('team name missing from h1; refusing guessed name')
    seen = set()
    for player in players:
        url = player['profile_url']
        if urlparse(url).hostname not in ('www.football.org.il', 'football.org.il'):
            raise ValueError('invalid player profile host')
        if str(player['ifa_player_id']) != parse_qs(urlparse(url).query).get('player_id', [None])[0]:
            raise ValueError('player id/profile mismatch')
        if player['ifa_player_id'] in seen:
            raise ValueError('duplicate player id')
        seen.add(player['ifa_player_id'])
    return {
        'ifa_team_id': team_id, 'ifa_season_id': season,
        'team_name': name, 'sport': 'football',
        'source_url': source_url,
        'players': [{'ifa_player_id': p['ifa_player_id'], 'name': p['name'], 'profile_url': p['profile_url']} for p in players],
    }


def prepare(folder, season):
    roster = folder / 'roster.html'
    if not roster.is_file():
        raise ValueError('missing roster.html')
    team = folder / 'team.html'
    return validate_roster(load_saved(roster), int(folder.name), season,
                           f'https://www.football.org.il/team-details/?team_id={folder.name}&season_id={season}',
                           load_saved(team) if team.exists() else None)


def build(saved, season):
    accepted, rejected = [], []
    for folder in sorted(saved.iterdir()):
        if not folder.is_dir():
            continue
        if not folder.name.isdecimal():
            rejected.append({'folder': folder.name, 'reason': 'folder must be numeric team id'})
            continue
        try:
            accepted.append(prepare(folder, season))
        except ValueError as exc:
            rejected.append({'folder': folder.name, 'reason': str(exc)})
    return accepted, rejected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--saved', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--season', type=int, default=28)
    args = parser.parse_args()
    if not args.saved.is_dir():
        parser.error('--saved must be an existing directory')
    accepted, rejected = build(args.saved, args.season)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'review.json').write_text(json.dumps({'accepted': accepted, 'rejected': rejected}, ensure_ascii=False, indent=2), encoding='utf-8')
    for mode, apply in (('dryrun', 'false'), ('apply', 'true')):
        statements = ['-- REVIEW BEFORE RUNNING IN SUPABASE SQL EDITOR. NO AUTOMATIC EXECUTION.']
        if apply == 'true':
            statements.append('-- Run only after review_dryrun.sql showed the expected changes.')
        for item in accepted:
            body = json.dumps(item, ensure_ascii=False).replace("'", "''")
            statements.append(f"-- team {item['ifa_team_id']}: {item['team_name']} ({len(item['players'])} players)")
            statements.append(f"select sync_ifa_roster('{body}'::jsonb, {apply});")
        (args.out / f'review_{mode}.sql').write_text('\n'.join(statements) + '\n', encoding='utf-8')
    print(json.dumps({'teams_ready': len(accepted), 'players_ready': sum(len(p['players']) for p in accepted), 'rejected': rejected, 'review': str(args.out / 'review.json'), 'dry_run_sql': str(args.out / 'review_dryrun.sql'), 'apply_sql': str(args.out / 'review_apply.sql')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
