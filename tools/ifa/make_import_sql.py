#!/usr/bin/env python3
"""Turn a verified players.json (from ifa_collector.py --saved) into one SQL
statement for the Supabase SQL Editor: select import_ifa_team('<payload>').
Only fields present in the source are passed; nothing is guessed."""
import argparse, json
ap = argparse.ArgumentParser()
ap.add_argument('players_json')
ap.add_argument('--team-id', type=int, required=True)
ap.add_argument('--season-id', type=int, required=True)
ap.add_argument('--team-name', required=True, help='as shown in the page heading')
ap.add_argument('--source-url', default='')
ap.add_argument('--league-id', type=int)
ap.add_argument('--league-name')
a = ap.parse_args()
players = json.load(open(a.players_json, encoding='utf-8'))
ids = [p['ifa_player_id'] for p in players]
assert len(ids) == len(set(ids)), 'duplicate player ids'
assert all(p['ifa_team_id'] == a.team_id and p['ifa_season_id'] == a.season_id for p in players), 'team / season mismatch'
payload = {
    'ifa_team_id': a.team_id, 'ifa_season_id': a.season_id, 'team_name': a.team_name, 'source_url': a.source_url,
    'ifa_league_id': a.league_id, 'league_name': a.league_name, 'sport': 'football',
    'players': [{'ifa_player_id': p['ifa_player_id'], 'name': p['name'], 'profile_url': p['profile_url']} for p in players],
}
body = json.dumps(payload, ensure_ascii=False).replace("'", "''")
print(f"-- IFA import: team {a.team_id}, season {a.season_id}, {len(players)} players\nselect import_ifa_team('{body}'::jsonb);")
