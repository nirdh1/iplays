/**
 * Web Push on this device: register the service worker, subscribe with the
 * VAPID public key (VITE_VAPID_PUBLIC_KEY) and store the subscription in
 * push_subscriptions (own rows only, RLS). Sending happens on the server
 * (supabase/functions/notify-dispatch) from the notification_outbox queue.
 * iPhone: works only after "add to home screen" (iOS 16.4+).
 */
import { supabase } from './supabase';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState = 'unsupported' | 'not-configured' | 'denied' | 'off' | 'on';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!VAPID || !supabase) return 'not-configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) as BufferSource }));
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '', user_agent: navigator.userAgent.slice(0, 300) },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  return 'off';
}

export interface NotificationPrefs {
  match_changes: boolean;
  match_results: boolean;
}

export async function getPrefs(): Promise<NotificationPrefs> {
  const { data } = (await supabase?.from('notification_prefs').select('match_changes, match_results').maybeSingle()) ?? { data: null };
  return { match_changes: data?.match_changes ?? true, match_results: data?.match_results ?? true };
}

export async function savePrefs(p: NotificationPrefs) {
  if (!supabase) return;
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('notification_prefs').upsert({ user_id: u.user?.id, ...p, updated_at: new Date().toISOString() });
  if (error) throw error;
}
