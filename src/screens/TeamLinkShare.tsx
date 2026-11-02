/** Share the team's page (#t/<id>) on WhatsApp or by copying the link. Any member can share it. */
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { teamLink } from '../lib/joinApi';

export function TeamLinkShare({ teamId, teamName }: { teamId: string; teamName: string }) {
  const link = teamLink(teamId);
  const text = `הקבוצה ${teamName} ב-iplays. נכנסים, מוצאים את הילד ומצטרפים: ${link}`;


  return (
    <div className="ip-invite">
      <p className="ip-muted">מי שיפתח את הקישור יגיע ישר לדף הקבוצה, ימצא את הילד שלו וישלח בקשה. צוות הקבוצה מאשר.</p>
      <input className="ip-input ip-invite-link" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="קישור לדף הקבוצה" />
      <div className="ip-btn-row">
        <a className="ip-btn ip-btn--lime ip-btn--md" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          <Icon name="chat" size={20} />
          <span>שליחה בוואטסאפ</span>
        </a>
        {typeof navigator !== 'undefined' && !!navigator.share && (
          <Button variant="ghost" onClick={() => void navigator.share({ title: 'iplays', text: text }).catch(() => undefined)}>
            שיתוף…
          </Button>
        )}
      </div>
    </div>
  );
}
