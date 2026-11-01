/**
 * "Save iplays to your home screen": shown first, on the login screen and the
 * home screen, until the app is installed or the user closes it.
 * Android / Chrome: a real install button (beforeinstallprompt).
 * iPhone / iPad (Safari has no install API): short Share → Add to Home Screen steps.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'iplays.installHintClosed';
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  });
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasClosed() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallHint({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [, force] = useState(0);
  const [closed, setClosed] = useState(wasClosed);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (closed || isStandalone()) return null;

  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  };

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') close();
    else force((n) => n + 1);
  }

  return (
    <div className={`ip-install ip-install--${tone}`} role="note">
      <img src="./apple-touch-icon.png" alt="" width={44} height={44} className="ip-install-icon" />
      <div className="ip-install-text">
        <strong>שמרו את iplays במסך הבית</strong>
        {deferred ? (
          <span>פותחים בלחיצה אחת, כמו אפליקציה. בלי חנות ובלי הורדה.</span>
        ) : ios ? (
          <span>
            בספארי: לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה), ואז <b>"הוספה למסך הבית"</b>.
          </span>
        ) : (
          <span>
            בתפריט הדפדפן (⋮) בוחרים <b>"הוספה למסך הבית"</b> או <b>"התקנת אפליקציה"</b>.
          </span>
        )}
      </div>
      {deferred && (
        <button type="button" className="ip-install-btn" onClick={() => void install()}>
          הוספה
        </button>
      )}
      <button type="button" className="ip-install-close" aria-label="סגירה" onClick={close}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
