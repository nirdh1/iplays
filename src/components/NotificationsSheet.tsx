/**
 * The bell's list. Signed in: the user's real notifications (lib/inbox).
 * Demo: the sample child's notifications.
 */
import { useCallback, useEffect, useState } from 'react';
import { BottomSheet } from './shell';
import { Icon } from './Icon';
import { EmptyState } from './ui';
import { inboxIcon, listInbox, markAllRead, timeAgo, unreadCount, type InboxItem } from '../lib/inbox';
import type { ChildNotification } from '../data/demo';

const POLL_MS = 60_000;

/** Unread count for the badge: on start, every minute, and when the app comes back to the front. */
export function useUnread(enabled: boolean) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    if (enabled) void unreadCount().then(setUnread);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {
      setUnread(0);
      return;
    }
    refresh();
    const t = window.setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);
  return { unread, setUnread, refresh };
}

export function NotificationsSheet({ open, onClose, demo, onRead }: { open: boolean; onClose: () => void; demo?: ChildNotification[]; onRead: () => void }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);

  useEffect(() => {
    if (!open || demo) return;
    let live = true;
    setItems(null);
    void listInbox().then((list) => {
      if (!live) return;
      setItems(list);
      if (list.some((n) => !n.read_at)) void markAllRead().then(onRead);
    });
    return () => {
      live = false;
    };
  }, [open, demo, onRead]);

  const openItem = (n: InboxItem) => {
    onClose();
    if (n.url) window.location.hash = n.url.replace(/^#/, '');
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="התראות">
      {demo ? (
        <ul className="ip-inbox">
          {demo.map((n) => (
            <li key={n.id}>
              <div className={`ip-inbox-item ${n.tone === 'action' ? 'is-unread' : ''}`}>
                <span className="ip-inbox-icon" aria-hidden>
                  <Icon name="bell" size={18} />
                </span>
                <span className="ip-inbox-text">
                  <strong>{n.text}</strong>
                </span>
                <time>{n.time}</time>
              </div>
            </li>
          ))}
        </ul>
      ) : items === null ? (
        <p className="ip-muted ip-inbox-loading">טוען…</p>
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title="אין התראות" text="כאן יופיעו שינויים באימונים ובמשחקים, הודעות מהקבוצה ובקשות שממתינות לך." />
      ) : (
        <ul className="ip-inbox">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className={`ip-inbox-item ${n.read_at ? '' : 'is-unread'}`} onClick={() => openItem(n)}>
                <span className="ip-inbox-icon" aria-hidden>
                  <Icon name={inboxIcon(n.kind)} size={18} />
                </span>
                <span className="ip-inbox-text">
                  <strong>{n.title}</strong>
                  {n.body && <span>{n.body}</span>}
                </span>
                <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
