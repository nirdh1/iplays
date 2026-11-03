/**
 * #adminfeedback — Super Admin: every "צור קשר / תקלה / הצעה" message.
 * Set a status and write a reply; the reply goes to the sender's bell.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, Segmented, Tag } from '../components/ui';
import { Err } from '../components/form';
import { friendlyError } from '../lib/api';
import { isPlatformAdmin } from '../lib/ifaApi';
import { timeAgo } from '../lib/inbox';
import { adminFeedbackList, adminUpdateFeedback, feedbackError, kindLabel, statusLabel, type AdminFeedback, type FeedbackStatus } from '../lib/feedbackApi';
import '../theme/coach.css';

type Filter = 'open' | FeedbackStatus | 'all';
const filters: { id: Filter; label: string }[] = [
  { id: 'open', label: 'פתוחות' },
  { id: 'done', label: 'טופלו' },
  { id: 'all', label: 'הכל' },
];
const statuses: { id: FeedbackStatus; label: string }[] = (['new', 'in_progress', 'done'] as FeedbackStatus[]).map((id) => ({ id, label: statusLabel[id] }));

function FeedbackCard({ f, onSaved }: { f: AdminFeedback; onSaved: () => void }) {
  const [status, setStatus] = useState<FeedbackStatus>(f.status);
  const [reply, setReply] = useState(f.admin_reply ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = status !== f.status || reply.trim() !== (f.admin_reply ?? '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await adminUpdateFeedback(f.id, status, reply);
      onSaved();
    } catch (e) {
      setError(feedbackError(e) ?? friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="ip-form">
        <div className="ip-feedback-head">
          <Tag tone={f.kind === 'bug' ? 'warning' : f.kind === 'suggestion' ? 'lime' : 'blue'}>{kindLabel[f.kind]}</Tag>
          <Tag tone={f.status === 'done' ? 'navy' : 'neutral'}>{statusLabel[f.status]}</Tag>
          <time className="ip-muted" dateTime={f.created_at}>
            {timeAgo(f.created_at)}
          </time>
        </div>
        <div>
          <strong>{f.sender}</strong>
          {f.contact_email && (
            <>
              {' · '}
              <a href={`mailto:${f.contact_email}?subject=${encodeURIComponent(`iplays · ${kindLabel[f.kind]}`)}`} dir="ltr">
                {f.contact_email}
              </a>
            </>
          )}
        </div>
        <p className="ip-feedback-text">{f.message}</p>
        {f.link && (
          <a href={f.link} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="ip-feedback-link">
            {f.link}
          </a>
        )}
        {(f.page || f.user_agent) && (
          <p className="ip-footnote" dir="ltr">
            {[f.page, f.user_agent].filter(Boolean).join(' · ')}
          </p>
        )}
        <Segmented items={statuses} value={status} onChange={setStatus} label="סטטוס" />
        <textarea className="ip-input ip-textarea" rows={3} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="תשובה לפונה (תגיע להתראות שלו/ה). לא חובה" />
        <Err error={error} />
        <Button variant="primary" size="sm" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'שומר…' : 'שמירה'}
        </Button>
      </div>
    </Card>
  );
}

export function AdminFeedbackScreen({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [items, setItems] = useState<AdminFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    adminFeedbackList(filter === 'open' || filter === 'all' ? null : filter).then(
      (list) => setItems(filter === 'open' ? list.filter((f) => f.status !== 'done') : list),
      (e) => {
        setItems([]);
        setError(feedbackError(e) ?? friendlyError(e));
      },
    );
  };
  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);
  useEffect(() => {
    if (allowed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, filter]);

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>פניות משתמשים</h1>
        <span />
      </div>
      {allowed === null ? (
        <p className="ip-muted ip-pad">טוען…</p>
      ) : !allowed ? (
        <Card>
          <EmptyState icon="shield" title="אין גישה" text="המסך הזה מיועד למנהלי המערכת בלבד." />
        </Card>
      ) : (
        <section className="ip-stack ip-stack--tight">
          <Segmented items={filters} value={filter} onChange={setFilter} label="סינון פניות" />
          <Err error={error} />
          {items === null ? (
            <p className="ip-muted ip-pad">טוען…</p>
          ) : items.length === 0 ? (
            !error && (
              <Card>
                <EmptyState icon="chat" title="אין פניות" text="פניות, דיווחי תקלות והצעות ייעול מהמשתמשים יופיעו כאן." />
              </Card>
            )
          ) : (
            items.map((f) => <FeedbackCard key={`${f.id}-${f.updated_at}`} f={f} onSaved={load} />)
          )}
        </section>
      )}
    </div>
  );
}
