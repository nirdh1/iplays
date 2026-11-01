/** Share the team's page (#t/<id>) on WhatsApp or by copying the link. Any member can share it. */
import { useState } from 'react';
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

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'iplays', text });
        return;
      } catch {
        /* user cancelled */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  return (
    <div className="ip-invite">
      <p className="ip-muted">מי שיפתח את הקישור יגיע ישר לדף הקבוצה, ימצא את הילד שלו וישלח בקשה. צוות הקבוצה מאשר.</p>
      <input className="ip-input ip-invite-link" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="קישור לדף הקבוצה" />
      <div className="ip-btn-row">
        <Button variant="lime" icon="chat" onClick={share}>
          שליחה בוואטסאפ
        </Button>
        <Button variant="secondary" icon={copied ? 'check' : 'plus'} onClick={copy}>
          {copied ? 'הועתק' : 'העתקת קישור'}
        </Button>
      </div>
    </div>
  );
}
