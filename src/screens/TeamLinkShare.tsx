/**
 * Share links that carry no child data:
 * - TeamLinkShare: the team's page (#t/<id>). Opens the team card and roster names
 *   (as the open search shows them); joining needs staff/parent approval.
 * - AppLinkShare: the app itself, no team and no child.
 * Any member can share them.
 */
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { teamLink } from '../lib/joinApi';

export function appLink() {
  return `${window.location.origin}${window.location.pathname}`;
}

function ShareButtons({ link, text, label }: { link: string; text: string; label: string }) {
  return (
    <>
      <input className="ip-input ip-invite-link" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label={label} />
      <div className="ip-btn-row">
        <a className="ip-btn ip-btn--lime ip-btn--md" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          <Icon name="chat" size={20} />
          <span>שליחה בוואטסאפ</span>
        </a>
        {typeof navigator !== 'undefined' && !!navigator.share && (
          <Button variant="ghost" onClick={() => void navigator.share({ title: 'iplays', text }).catch(() => undefined)}>
            שיתוף…
          </Button>
        )}
      </div>
    </>
  );
}

export function TeamLinkShare({ teamId, teamName }: { teamId: string; teamName: string }) {
  const link = teamLink(teamId);
  const text = `הקבוצה ${teamName} ב-iplays. נכנסים, מוצאים את הילד ומצטרפים: ${link}`;
  return (
    <div className="ip-invite">
      <p className="ip-muted">
        קישור לקבוצה בלבד, בלי פרטים של הילד שלך. מי שיפתח אותו יירשם, יראה את שם הקבוצה ורשימת השמות שלה, וישלח בקשה להצטרף. לפני אישור הוא לא רואה אימונים, משחקים או פרטי ילדים.
      </p>
      <ShareButtons link={link} text={text} label="קישור לדף הקבוצה" />
    </div>
  );
}

export function AppLinkShare() {
  const link = appLink();
  const text = `בואו ל-iplays, האפליקציה לקבוצות ספורט של ילדים: ${link}`;
  return (
    <div className="ip-invite">
      <p className="ip-muted">
        קישור לאפליקציה בלבד, בלי קבוצה ובלי ילד. מי שיפתח אותו יירשם עם אימייל ואז יחפש בעצמו את הקבוצה או הילד שלו.
      </p>
      <ShareButtons link={link} text={text} label="קישור לאפליקציה" />
    </div>
  );
}
