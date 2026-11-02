/** Share the team's page (#t/<id>) on WhatsApp or by copying the link. Any member can share it. */
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { teamLink } from '../lib/joinApi';

export function TeamLinkShare({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [copied, setCopied] = useState(false);
  const link = teamLink(teamId);
  const text = `הקבוצה ${teamName} ב-iplays. נכנסים, מוצאים את הילד ומצטרפים: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }


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
        <Button variant="secondary" icon={copied ? 'check' : 'plus'} onClick={copy}>
          {copied ? 'הועתק' : 'העתקת קישור'}
        </Button>
      </div>
    </div>
  );
}
