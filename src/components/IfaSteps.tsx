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

export function IfaSteps({ teamId, kind, links: given }: { teamId?: string; kind: IfaPageKind; links?: PageLink[] }) {
  const [links, setLinks] = useState<PageLink[] | null>(given ?? null);
  const [opened, setOpened] = useState(false);
  const [back, setBack] = useState(false);

  useEffect(() => {
    if (given || !teamId) return;
    let live = true;
    void pagesFor(teamId, kind).then((l) => live && setLinks(l));
    return () => {
      live = false;
    };
  }, [teamId, kind, given]);

  // the user returns from the IFA tab: point at step 3
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

  if (!links?.length) return null;
  const what = kind === 'table' ? 'הטבלה' : kind === 'roster' ? 'רשימת השחקנים' : kind === 'player' ? 'כרטיס השחקן' : 'המשחקים';
  return (
    <>
    <IconExplainer />
    <ol className="ip-ifa-steps">
      <li className={opened ? 'is-done' : ''}>
        <span>פותחים את הדף באתר ההתאחדות:</span>
        <span className="ip-ifa-steps-links">
          {links.map((l) => (
            <a key={l.href} className="ip-btn ip-btn--secondary ip-btn--sm" href={l.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
              <span>{l.label}</span>
              <Icon name="external" size={16} />
            </a>
          ))}
        </span>
      </li>
      <li className={back ? 'is-done' : ''}>
        מצלמים מסך של {what} (הצילום נשמר בגלריה של הטלפון). שימו את כל {what} במסך אחד; אם צריך, הקטינו את התצוגה.
      </li>
      <li className={back ? 'is-next' : ''}>חוזרים לכאן ובוחרים את הצילום בכפתור למטה.</li>
    </ol>
    </>
  );
}
