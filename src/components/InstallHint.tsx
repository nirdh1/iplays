/**
 * "Save iplays to your home screen" popup, mounted once for the whole app.
 * It pops up shortly after the page opens, with a bouncing arrow pointing at
 * the browser button to press:
 * - iPhone Safari: the share button in the bottom toolbar (arrow down).
 * - iPad Safari: the share button at the top right (arrow up).
 * - Android / Chrome with an install prompt: a real "install" button.
 * - Other browsers: the ⋮ menu at the top right (arrow up).
 * Hidden when the app already runs from the home screen. "Not now" snoozes it
 * for 3 days; installing hides it for good.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'iplays.installHintClosed';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 1500;

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
function setFlag(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    setFlag('installed');
    listeners.forEach((l) => l());
  });
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Hidden for good after install; for 3 days after "not now". ('1' = closed by an older version: show again.) */
function isSnoozed() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'installed') return true;
    const at = Number(v);
    return v !== null && v !== '1' && Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

type Platform = 'iphone' | 'ipad' | 'other';
function platform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'ipad';
  return 'other';
}

/** The iOS share glyph: a square with an arrow up. */
function ShareGlyph() {
  return (
    <svg className="ip-a2hs-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function InstallHint() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // not inside the iPlays 2.0 Club OS preview (#os/...)
    if (isStandalone() || isSnoozed() || window.location.hash.startsWith('#os')) return;
    const l = () => force((n) => n + 1);
    listeners.add(l);
    const t = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => {
      listeners.delete(l);
      window.clearTimeout(t);
    };
  }, []);

  if (!open || isStandalone() || isSnoozed()) return null;

  const p = platform();
  // Where the arrow points: iPhone Safari's toolbar is at the bottom; iPad's share
  // button and other browsers' ⋮ menu are at the top right. Chrome's own install
  // dialog needs no arrow.
  const where: 'bottom' | 'top' | 'none' = deferred ? 'none' : p === 'iphone' ? 'bottom' : 'top';

  const snooze = () => {
    setFlag(String(Date.now()));
    setOpen(false);
  };

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') setFlag('installed');
    setOpen(false);
  }

  return (
    <div className={`ip-a2hs ip-a2hs--${where}`} role="dialog" aria-modal="false" aria-labelledby="ip-a2hs-title">
      {where !== 'none' && (
        <div className="ip-a2hs-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40">
            <path d="M12 4v15M5 12l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <div className="ip-a2hs-card">
        <button type="button" className="ip-a2hs-close" aria-label="סגירה" onClick={snooze}>
          <Icon name="close" size={16} />
        </button>
        <div className="ip-a2hs-head">
          <img src="./apple-touch-icon.png" alt="" width={48} height={48} className="ip-a2hs-icon" />
          <div>
            <strong id="ip-a2hs-title">שמרו את iplays במסך הבית</strong>
            <span>נפתח בלחיצה אחת, כמו אפליקציה, ונשארים מחוברים.</span>
          </div>
        </div>
        {deferred ? (
          <button type="button" className="ip-a2hs-install" onClick={() => void install()}>
            הוספה למסך הבית
          </button>
        ) : p === 'other' ? (
          <ol className="ip-a2hs-steps">
            <li>
              לוחצים על תפריט הדפדפן <b dir="ltr">⋮</b> למעלה
            </li>
            <li>
              בוחרים <b>"הוספה למסך הבית"</b> או <b>"התקנת אפליקציה"</b>
            </li>
          </ol>
        ) : (
          <ol className="ip-a2hs-steps">
            <li>
              לוחצים על כפתור השיתוף <ShareGlyph /> {p === 'iphone' ? 'למטה' : 'למעלה'}
              {p === 'iphone' && <small>אם אינו מופיע: על ⋯ ואז "שיתוף"</small>}
            </li>
            <li>
              גוללים ובוחרים <b>"הוספה למסך הבית"</b>
            </li>
          </ol>
        )}
        <button type="button" className="ip-a2hs-later" onClick={snooze}>
          לא עכשיו
        </button>
      </div>
    </div>
  );
}
