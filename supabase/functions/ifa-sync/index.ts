/**
 * ifa-sync — fills the ifa_* tables from public football.org.il pages.
 *
 * Runs on a schedule (see docs/backend-setup.md, "IFA sync") with the
 * service role, which is the only role allowed to write these tables.
 * Polite by design: one request at a time, a pause between requests, and an
 * identifying User-Agent.
 *
 * Body (all optional): { "season": "2026/27", "leagues": ["123"], "squads": true }
 * Without "leagues" it syncs every league already in ifa_leagues for the season
 * after refreshing the league index.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseLeague, parseLeagues, parseSquad } from './parse.ts';

const BASE = 'https://www.football.org.il';
const PAUSE_MS = 1500;
const UA = 'iplays-sync/1.0 (+https://iplays.app; youth team schedules)';

// URL patterns are filled in together with the parsers.
const urls = {
  leagues: (_season: string) => `${BASE}/leagues/`,
  league: (id: string) => `${BASE}/leagues/league/?league_id=${encodeURIComponent(id)}`,
  team: (id: string) => `${BASE}/team-details/?team_id=${encodeURIComponent(id)}`,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'he' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  await sleep(PAUSE_MS);
  return text;
}

function currentSeason(d = new Date()) {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1; // seasons start in summer
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) return new Response('forbidden', { status: 403 });

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const season: string = body.season ?? currentSeason();
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
  const log: string[] = [];
  const now = new Date().toISOString();

  try {
    let leagueIds: string[] = body.leagues ?? [];
    if (!leagueIds.length) {
      const leagues = parseLeagues(await get(urls.leagues(season)), season);
      const { error } = await db.from('ifa_leagues').upsert(leagues.map((l) => ({ ...l, updated_at: now })));
      if (error) throw error;
      leagueIds = leagues.map((l) => l.id);
      log.push(`leagues: ${leagues.length}`);
    }

    for (const id of leagueIds) {
      const { teams, matches, standings } = parseLeague(await get(urls.league(id)), id);
      for (const [table, rows] of [
        ['ifa_teams', teams],
        ['ifa_matches', matches],
        ['ifa_standings', standings],
      ] as const) {
        if (!rows.length) continue;
        const { error } = await db.from(table).upsert((rows as object[]).map((r) => ({ ...r, updated_at: now })));
        if (error) throw error;
      }
      log.push(`league ${id}: ${teams.length} teams, ${matches.length} matches, ${standings.length} table rows`);
    }

    // Squads only for IFA teams that an iplays team is linked to: we don't
    // collect minors' names for teams nobody on iplays asked for.
    if (body.squads !== false) {
      const { data: linked, error } = await db.from('teams').select('ifa_team_id').not('ifa_team_id', 'is', null);
      if (error) throw error;
      for (const teamId of [...new Set((linked ?? []).map((t) => t.ifa_team_id as string))]) {
        const players = parseSquad(await get(urls.team(teamId)), teamId);
        if (players.length) {
          const { error: e } = await db.from('ifa_players').upsert(players.map((p) => ({ ...p, updated_at: now })));
          if (e) throw e;
        }
        log.push(`squad ${teamId}: ${players.length}`);
      }
    }

    return Response.json({ ok: true, season, log });
  } catch (e) {
    return Response.json({ ok: false, season, log, error: String((e as Error).message ?? e) }, { status: 500 });
  }
});
