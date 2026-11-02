// iplays — read a game schedule from a file (Supabase Edge Function, Deno).
//
// The app sends one file of a team's schedule: an image (photo / screenshot),
// a PDF, or the text of a spreadsheet (Excel / CSV converted in the browser).
// Claude reads it and returns the games of that team only. Nothing is saved
// here: the app shows the games for review and saves the approved ones with
// import_team_matches().
//
// Secrets (Supabase → Edge Functions → Secrets), never in the app:
//   ANTHROPIC_API_KEY
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase.
// Deploy: supabase functions deploy read-schedule  (JWT verification stays on)
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const MAX_BASE64 = 14_000_000; // ~10 MB file
const MAX_TEXT = 200_000;

interface Body {
  team_id: string;
  team_name: string;
  kind: 'image' | 'pdf' | 'text';
  media_type?: string;
  data: string;
  file_name?: string;
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['team_found', 'games', 'warning'],
  properties: {
    team_found: { type: 'boolean', description: 'false when the file shows no games of the requested team' },
    warning: { type: 'string', description: 'short Hebrew note for the user, or empty' },
    games: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'time', 'opponent', 'home', 'venue', 'competition', 'round'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM (24h), or empty when the file shows no time or 00:00' },
          opponent: { type: 'string' },
          home: { type: 'boolean', description: 'true when the requested team is the home team (listed first / under home)' },
          venue: { type: 'string' },
          competition: { type: 'string', enum: ['league', 'cup', 'friendly', 'tournament'] },
          round: { type: 'string', description: 'round / matchday label as written, or empty' },
        },
      },
    },
  },
} as const;

function instructions(teamName: string, today: string) {
  return `This file is a youth sports game schedule from Israel (usually Hebrew, right-to-left).
Extract every game of the team "${teamName}" (names in the file may be shorter or spelled a bit differently, e.g. without the age group or with a city name; choose the closest team).
Rules:
- Only games where that team plays. Ignore games of other teams and byes.
- opponent = the other team's name exactly as written.
- home = true when "${teamName}" is the home team (in Israeli schedules the home team usually appears first, or in a "בית"/"מארחת" column).
- Dates: Israeli order is day/month (e.g. 12/1 = 12 January). Today is ${today}; when the year is missing, use the season year that puts the game nearest to today's season (Aug-Jun).
- time: 24h HH:MM. Empty when no time is shown or it is 00:00.
- venue: the field/hall name if shown, else empty.
- competition: league unless the file says cup (גביע), friendly (ידידות) or tournament (טורניר).
- Do not invent games. If the team is not in the file, return team_found=false with no games and a short Hebrew warning.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'not_configured' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!body?.team_id || !body.data || !['image', 'pdf', 'text'].includes(body.kind)) return json({ error: 'bad_request' }, 400);

  // only someone who may import games into this team may have a file read for it
  const { data: allowed, error: permError } = await db.rpc('can_import_matches', { p_team: body.team_id });
  if (permError || !allowed) return json({ error: 'forbidden' }, 403);

  let filePart: Anthropic.ContentBlockParam;
  if (body.kind === 'image') {
    if (!IMAGE_TYPES.includes(body.media_type as ImageType)) return json({ error: 'unsupported_type' }, 400);
    if (body.data.length > MAX_BASE64) return json({ error: 'too_large' }, 413);
    filePart = { type: 'image', source: { type: 'base64', media_type: body.media_type as ImageType, data: body.data } };
  } else if (body.kind === 'pdf') {
    if (body.data.length > MAX_BASE64) return json({ error: 'too_large' }, 413);
    filePart = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.data } };
  } else {
    if (body.data.length > MAX_TEXT) return json({ error: 'too_large' }, 413);
    filePart = { type: 'text', text: `Spreadsheet "${body.file_name ?? ''}" as tab-separated rows:\n\n${body.data}` };
  }

  const client = new Anthropic({ apiKey });
  const today = new Date().toISOString().slice(0, 10);
  try {
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: [filePart, { type: 'text', text: instructions(body.team_name ?? '', today) }] }],
    } as never);
    const m = msg as unknown as Anthropic.Beta.BetaMessage;
    if (m.stop_reason === 'refusal') return json({ error: 'refused' }, 422);
    if (m.stop_reason === 'max_tokens') return json({ error: 'too_long' }, 422);
    const text = m.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'no_result' }, 502);
    return json(JSON.parse(text.text));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'not_configured' }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: 'ai_error', status: e.status }, 502);
    return json({ error: 'ai_error' }, 502);
  }
});
