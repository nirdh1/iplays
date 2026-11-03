/**
 * "עדכון מההתאחדות": the steps shown at the top of an upload sheet.
 *   1. open the right page on the IFA site (in the user's own browser, a new tab)
 *   2. take a screenshot there (the phone keeps it in the photo gallery)
 *   3. come back and pick that screenshot
 * The app never fetches anything from the IFA site; the user opens and
 * screenshots the page themselves. When the user comes back to the app after
 * opening a page, step 3 is highlighted.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Button } from './ui';
import { getTeamLeagueTable, ifaLeagueGamesUrl, ifaLeagueTableUrl, ifaTeamGamesUrl } from '../lib/leagueApi';
import { teamIfaLink } from '../lib/ifaApi';

export type IfaPageKind = 'table' | 'roster' | 'games' | 'player';

export interface PageLink {
  label: string;
  href: string;
}

async function pagesFor(teamId: string, kind: IfaPageKind): Promise<PageLink[]> {
  if (kind === 'player') return [];
  if (kind === 'roster') {
    const href = await teamIfaLink(teamId).catch(() => null);
    return href ? [{ label: 'דף הסגל של הקבוצה', href }] : [];
  }
  const t = await getTeamLeagueTable(teamId).catch(() => null);
  if (!t) return [];
  const out: PageLink[] = [];
  if (kind === 'table') out.push({ label: 'טבלת הליגה', href: ifaLeagueTableUrl(t.ifa_league_id, t.ifa_season_id) });
  if (kind === 'games') {
    out.push({ label: 'משחקי המחזור בליגה', href: ifaLeagueGamesUrl(t.ifa_league_id, t.ifa_season_id) });
    if (t.our_ifa_team_id) out.push({ label: 'כל משחקי הקבוצה בעונה', href: ifaTeamGamesUrl(t.our_ifa_team_id, t.ifa_season_id) });
  }
  return out;
}

const TIP_KEY = 'ip-ifa-icon-seen';
const seenTip = () => {
  try {
    return localStorage.getItem(TIP_KEY) === '1';
  } catch {
    return true;
  }
};

/**
 * The small ⟳ icon placed beside anything that can be updated from the IFA
 * site (league table, roster, games, a player's numbers). Until it is tapped
 * once it pulses gently, and the sheet it opens explains what it means.
 */
export function IfaUpdateIcon({ label, onClick }: { label: string; onClick: () => void }) {
  const [fresh, setFresh] = useState(() => !seenTip());
  return (
    <button
      type="button"
      className={`ip-ifa-icon${fresh ? ' is-fresh' : ''}`}
      aria-label={label}
      title={`${label}: פותחים את הדף באתר ההתאחדות, מצלמים מסך ובוחרים אותו כאן`}
      onClick={() => {
        setFresh(false);
        onClick();
      }}
    >
      <Icon name="sync" size={16} strokeWidth={2.2} />
    </button>
  );
}

/** First time only: what the ⟳ icon means. */
function IconExplainer() {
  const [show] = useState(() => !seenTip());
  useEffect(() => {
    try {
      localStorage.setItem(TIP_KEY, '1');
    } catch {
      /* private mode: the note simply shows again */
    }
  }, []);
  if (!show) return null;
  return (
    <p className="ip-ifa-explainer">
      <span className="ip-ifa-icon" aria-hidden>
        <Icon name="sync" size={16} strokeWidth={2.2} />
      </span>
      האייקון הזה מופיע ליד כל נתון שאפשר לעדכן מאתר ההתאחדות: הטבלה, הסגל, המשחקים ונתוני השחקן. תמיד באותה דרך, בשלושה צעדים:
    </p>
  );
}

const WHAT: Record<IfaPageKind, { title: string; what: string }> = {
  table: { title: 'צלמו את טבלת הליגה', what: 'הטבלה' },
  roster: { title: 'צלמו את רשימת השחקנים', what: 'רשימת השחקנים' },
  games: { title: 'צלמו את משחקי המחזור', what: 'המשחקים' },
  player: { title: 'צלמו את הנתונים הסטטיסטיים של השחקן', what: 'הנתונים' },
};

/**
 * The top of an upload sheet. With a known IFA page: a title saying exactly
 * what to photograph, one button to the page, where the screenshot is kept,
 * and (once the user is back) a large "pick the screenshot you just took".
 * Without one: the sheet's own text and a pick button.
 */
export function UploadIntro({
  teamId,
  kind,
  links: given,
  busy,
  progress,
  fileName,
  onPick,
  fallback,
}: {
  teamId?: string;
  kind: IfaPageKind;
  links?: PageLink[];
  busy: boolean;
  progress: string;
  fileName: string;
  onPick: () => void;
  fallback: string;
}) {
  const [links, setLinks] = useState<PageLink[] | null>(given ?? null);
  const [opened, setOpened] = useState(false);
  const [back, setBack] = useState(false);

  useEffect(() => {
    if (given) {
      setLinks(given);
      return;
    }
    if (!teamId) return;
    let live = true;
    void pagesFor(teamId, kind).then((l) => live && setLinks(l));
    return () => {
      live = false;
    };
  }, [teamId, kind, given]);

  // the user returns from the IFA tab: the next step is picking the screenshot
  useEffect(() => {
    if (!opened) return;
    const onVis = () => document.visibilityState === 'visible' && setBack(true);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [opened]);

  const pickLabel = busy ? `קוראים את ${fileName || 'הצילום'}…` : back ? 'בחירת הצילום שצילמתם עכשיו' : 'בחירת צילום מסך';
  const status = busy && (
    <p className="ip-muted" role="status">
      {progress || 'קוראים…'} מתמונה זה יכול לקחת עד דקה.
    </p>
  );

  if (!links?.length) {
    return (
      <>
        <p className="ip-muted">{fallback}</p>
        <Button variant="primary" icon="photo" block disabled={busy} onClick={onPick}>
          {busy ? `קוראים את ${fileName || 'הקובץ'}…` : 'בחירת צילום מסך או קובץ'}
        </Button>
        {status}
      </>
    );
  }

  const w = WHAT[kind];
  return (
    <>
      <IconExplainer />
      <h3 className="ip-ifa-title">{w.title}</h3>
      <ol className="ip-ifa-steps">
        <li className={opened ? 'is-done' : ''}>
          <span className="ip-ifa-steps-links">
            {links.map((l, i) => (
              <a
                key={l.href}
                className={`ip-btn ip-btn--${opened || i > 0 ? 'secondary' : 'primary'} ip-btn--md`}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpened(true)}
              >
                <span>פתיחת {l.label} באתר ההתאחדות</span>
                <Icon name="external" size={16} />
              </a>
            ))}
          </span>
        </li>
        <li className={back ? 'is-done' : ''}>
          שם, צלמו מסך של {w.what}. הצילום נשמר לבד בתמונות של הטלפון (באלבום "צילומי מסך").
        </li>
        <li className={back ? 'is-next' : ''}>חזרו לכאן ובחרו אותו. הצילום האחרון מופיע ראשון.</li>
      </ol>
      <Button variant={opened ? 'primary' : 'secondary'} icon="photo" block disabled={busy} onClick={onPick}>
        {pickLabel}
      </Button>
      {status}
      <p className="ip-footnote">אפשר גם לבחור PDF, אקסל או CSV.</p>
    </>
  );
}
