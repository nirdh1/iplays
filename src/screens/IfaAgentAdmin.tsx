/**
 * #ifa — local agent (pilot): "הרץ בדיקה" asks the collector on the owner's
 * computer to load a team's roster page. The agent sends back a dry run only;
 * the import happens here, on a click. The web app cannot reach the computer
 * itself, so a request waits until the agent runs (every few minutes while the
 * computer is on).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, SectionHeader, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  applyIfaRequest,
  cancelIfaRequest,
  createAgentKey,
  getAgentKeys,
  getSyncRequests,
  requestIfaSync,
  revokeAgentKey,
  type AgentKey,
  type RosterChangeRow,
  type RosterSyncResult,
  type SyncRequest,
} from '../lib/ifaApi';

const fmt = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

const reqStatus: Record<SyncRequest['status'], { label: string; tone: 'lime' | 'warning' | 'live' | 'neutral' | 'blue' }> = {
  pending: { label: 'ממתין לסוכן', tone: 'neutral' },
  claimed: { label: 'הסוכן טוען את הדף', tone: 'blue' },
  checked: { label: 'נבדק, ממתין לאישור', tone: 'warning' },
  applied: { label: 'יובא', tone: 'lime' },
  failed: { label: 'נכשל', tone: 'live' },
  canceled: { label: 'בוטל', tone: 'neutral' },
};

export function IfaAgentAdmin({ onChanged }: { onChanged: () => void }) {
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [requests, setRequests] = useState<SyncRequest[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [form, setForm] = useState({ teamId: '7491', seasonId: '28' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [k, r] = await Promise.all([getAgentKeys(), getSyncRequests()]);
      setKeys(k);
      setRequests(r);
    } catch (e) {
      // the agent SQL is not installed yet: hide the section quietly
      const code = (e as { code?: string }).code;
      if (code === 'PGRST205' || code === '42P01' || code === 'PGRST202') setMissing(true);
      else setError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = requests.some((r) => r.status === 'pending' || r.status === 'claimed');
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [waiting, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const active = keys.filter((k) => !k.revoked_at);
  const lastSeen = active.map((k) => k.last_seen_at).filter(Boolean).sort().pop() ?? null;
  const ready = /^\d+$/.test(form.teamId) && /^\d+$/.test(form.seasonId);

  if (missing) return null;

  return (
    <section>
      <SectionHeader title="בדיקה מהמחשב המקומי (פיילוט)" icon="clock" />
      <Card>
        <div className="ip-form">
          <p className="ip-muted">
            הבדיקה רצה על המחשב שלך, כשהוא דלוק והסוכן פועל. הסוכן טוען את דף הסגל כמו דפדפן רגיל, ונעצר אם האתר חוסם. הוא רק בודק, והייבוא קורה כאן בלחיצה שלך.
          </p>

          <div className="ip-agent-status">
            {active.length === 0 ? (
              <Tag tone="warning">אין סוכן מחובר</Tag>
            ) : lastSeen ? (
              <Tag tone="lime">הסוכן פעל לאחרונה {fmt(lastSeen)}</Tag>
            ) : (
              <Tag tone="neutral">יש מפתח, הסוכן עוד לא פעל</Tag>
            )}
          </div>

          <div className="ip-field-row">
            <Field label="מזהה קבוצה בהתאחדות">
              <input className="ip-input" dir="ltr" inputMode="numeric" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="מזהה עונה">
              <input className="ip-input" dir="ltr" inputMode="numeric" value={form.seasonId} onChange={(e) => setForm({ ...form, seasonId: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <Button variant="primary" block disabled={!ready || busy} onClick={() => void act(() => requestIfaSync(Number(form.teamId), Number(form.seasonId)))}>
            הרץ בדיקה
          </Button>
          <Err error={error} />

          {requests.length > 0 && (
            <ul className="ip-agent-requests">
              {requests.map((r) => (
                <li key={r.id}>
                  <div className="ip-agent-request-head">
                    <strong>
                      קבוצה {r.ifa_team_id} · {fmt(r.requested_at)}
                    </strong>
                    <Tag tone={reqStatus[r.status].tone}>{reqStatus[r.status].label}</Tag>
                  </div>
                  {(r.status === 'pending' || r.status === 'claimed') && (
                    <p className="ip-muted">
                      {active.length === 0 ? 'אין סוכן מחובר, הבקשה תחכה עד שיופעל.' : 'הסוכן יאסוף את הבקשה בהרצה הבאה שלו (כל כמה דקות כשהמחשב דלוק).'}{' '}
                      <button type="button" className="ip-link-btn" disabled={busy} onClick={() => void act(() => cancelIfaRequest(r.id))}>
                        ביטול
                      </button>
                    </p>
                  )}
                  {r.status === 'failed' && <p className="ip-muted" dir="auto">{r.error}</p>}
                  {r.status === 'checked' && r.result && (
                    <>
                      {r.fetch_info.fetched_at && (
                        <p className="ip-footnote">
                          נטען {fmt(r.fetch_info.fetched_at)} · HTTP {r.fetch_info.http_status} · {r.fetch_info.players} שחקנים
                        </p>
                      )}
                      <RosterCheck r={r.result} />
                      <div className="ip-field-row">
                        <Button variant="primary" block disabled={busy} onClick={() => void act(() => applyIfaRequest(r.id))}>
                          ייבוא השינויים
                        </Button>
                        <Button variant="secondary" block disabled={busy} onClick={() => void act(() => cancelIfaRequest(r.id))}>
                          לא לייבא
                        </Button>
                      </div>
                    </>
                  )}
                  {r.status === 'applied' && r.applied_result?.summary && (
                    <p className="ip-muted">
                      {r.applied_result.summary.added} נוספו, {r.applied_result.summary.missing} סומנו כלא מופיעים, {r.applied_result.summary.returned} חזרו,{' '}
                      {r.applied_result.summary.renamed} שינויי שם.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <details className="ip-agent-keys">
            <summary>מפתח לסוכן</summary>
            <p className="ip-footnote">
              הסוכן מתחבר עם מפתח ייעודי: הוא יכול רק לקבל בקשות ולשלוח תוצאת בדיקה. הוא לא יכול לייבא או לקרוא נתונים אחרים. המפתח מוצג פעם אחת בלבד.
            </p>
            {active.map((k) => (
              <div key={k.id} className="ip-agent-request-head">
                <span>
                  {k.name} · נוצר {fmt(k.created_at)}
                </span>
                <button type="button" className="ip-link-btn" disabled={busy} onClick={() => void act(() => revokeAgentKey(k.id))}>
                  ביטול מפתח
                </button>
              </div>
            ))}
            {newKey ? (
              <div className="ip-find-sent">
                <Tag tone="warning">העתק עכשיו, הוא לא יוצג שוב</Tag>
                <code dir="ltr" className="ip-agent-key">{newKey}</code>
              </div>
            ) : (
              <Button variant="secondary" block disabled={busy} onClick={() => void act(async () => setNewKey(await createAgentKey('Mac')))}>
                יצירת מפתח
              </Button>
            )}
          </details>
        </div>
      </Card>
    </section>
  );
}
const changeLabels: { key: 'added' | 'missing' | 'returned' | 'renamed'; label: string }[] = [
  { key: 'added', label: 'שחקנים חדשים' },
  { key: 'missing', label: 'לא מופיעים יותר בדף (יסומנו, לא יימחקו)' },
  { key: 'returned', label: 'חזרו לסגל' },
  { key: 'renamed', label: 'שינוי שם בהתאחדות (השם שההורה ערך באפליקציה לא ישתנה)' },
];

export function RosterCheck({ r }: { r: RosterSyncResult }) {
  if (!r.ok) {
    return (
      <div className="ip-roster-check">
        <Tag tone="live" icon="shield">נעצר, שום דבר לא השתנה</Tag>
        <p dir="auto">{r.error}</p>
      </div>
    );
  }
  const s = r.summary;
  const none = s && s.added + s.missing + s.returned + s.renamed === 0;
  return (
    <div className="ip-roster-check">
      <Tag tone="neutral" icon="check">בדיקה בלבד, שום דבר לא נשמר</Tag>
      <p>
        {s?.players_in_payload} שחקנים בדף, {s?.active_before} פעילים היום באפליקציה.
        {none && ' אין שינויים.'}
      </p>
      {changeLabels.map(({ key, label }) => {
        const rows: RosterChangeRow[] = r[key] ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={key}>
            <strong>
              {label}: {rows.length}
            </strong>
            <ul className="ip-change-list">
              {rows.map((x) => (
                <li key={x.ifa_player_id}>
                  {key === 'renamed' ? `${x.old} ← ${x.new}` : x.name} <span className="ip-muted" dir="ltr">#{x.ifa_player_id}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
