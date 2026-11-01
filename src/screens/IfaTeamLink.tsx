/**
 * "לדף הקבוצה באתר ההתאחדות": a plain link to the team's own page on
 * football.org.il, shown only for teams linked to the IFA catalog. Nothing is
 * fetched from the IFA site; the page opens in the parent's browser.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { teamIfaLink } from '../lib/ifaApi';

export function IfaTeamLink({ teamId }: { teamId: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void teamIfaLink(teamId).then((h) => live && setHref(h));
    return () => {
      live = false;
    };
  }, [teamId]);
  if (!href) return null;
  return (
    <a className="ip-ifa-link" href={href} target="_blank" rel="noopener noreferrer">
      <span>לדף הקבוצה באתר ההתאחדות</span>
      <Icon name="arrow" size={16} />
    </a>
  );
}
