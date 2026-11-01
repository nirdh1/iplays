// iplays — notification dispatcher (Supabase Edge Function, Deno).
//
// Takes due rows from notification_outbox (claim_notifications), sends Web Push
// to each of the user's devices and marks each row sent, or failed with a
// retry and backoff (complete_notification). Respects push_mode (off by default).
// Run it every minute with pg_cron (see docs/ifa-games-sync.md).
//
// Secrets (Supabase → Edge Functions → Secrets), never in the app:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// The service role key stays inside this function; the web app never uses it.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

interface Job {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  attempts: number;
}

Deno.serve(async (req) => {
  // only the scheduler (or an admin with the service key) may run it
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return new Response('forbidden', { status: 403 });
  }

  const { data: jobs, error } = await db.rpc('claim_notifications', { p_limit: 100 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const job of (jobs ?? []) as Job[]) {
    const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', job.user_id);
    if (!subs || subs.length === 0) {
      // no device: the row stays readable in the app's inbox; nothing to retry
      await db.rpc('complete_notification', { p_id: job.id, p_ok: true, p_error: 'no device' });
      continue;
    }
    const payload = JSON.stringify({ title: job.title, body: job.body, url: job.url, tag: job.id });
    let delivered = false;
    let lastError = '';
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
        delivered = true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        lastError = `${status ?? ''} ${(e as Error).message}`.trim();
        // the device unsubscribed: forget it
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
    await db.rpc('complete_notification', { p_id: job.id, p_ok: delivered, p_error: delivered ? null : lastError });
    if (delivered) sent += 1;
    else failed += 1;
  }
  return Response.json({ claimed: jobs?.length ?? 0, sent, failed });
});
