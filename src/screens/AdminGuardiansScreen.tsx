/**
 * #adminparents — Super Admin: find a child (or a parent by name / email) and
 * remove someone who is linked to the child but isn't really their parent.
 * Server side: supabase/migrations/20261103000000_guardian_removal.sql
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, Tag } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { BottomSheet } from '../components/shell';
import { Field } from '../components/form';
import { friendlyError } from '../lib/api';
import { isPlatformAdmin } from '../lib/ifaApi';
import { adminChildGuardians, adminRemoveGuardian, familyError, type AdminGuardianRow } from '../lib/familyApi';
import '../theme/coach.css';

const errText = (e: unknown) => familyError(e) ?? friendlyError(e);

export function AdminGuardiansScreen({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminGuardianRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminGuardianRow | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRows(await adminChildGuardians(q.trim()));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await adminRemoveGuardian(removing.player_id, removing.user_id, reason.trim());
      setRemoving(null);
      setReason('');
      await search();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const kids = useMemo(() => {
    const map = new Map<string, { id: string; name: string; meta: string; members: AdminGuardianRow[] }>();
    for (const r of rows ?? []) {
      const k = map.get(r.player_id) ?? {
        id: r.player_id,
        name: r.child_name,
        meta: [r.birth_year, r.team_name].filter(Boolean).join(' · '),
        members: [],
      };
      k.members.push(r);
      map.set(r.player_id, k);
    }
    return [...map.values()];
  }, [rows]);

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>הורים וילדים</h1>
        <span />
      </div>
      {allowed === null ? (
        <p className="ip-muted ip-pad">טוען…</p>
      ) : !allowed ? (
        <Card>
          <EmptyState icon="shield" title="אין גישה" text="המסך הזה מיועד למנהלי המערכת בלבד." />
        </Card>
      ) : (
        <>
          <Card>
            <form className="ip-form" onSubmit={search}>
              <Field label="שם הילד, או שם / מייל של ההורה">
                <input className="ip-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="לדוגמה: יונתן כהן" />
              </Field>
              <Button type="submit" variant="primary" disabled={busy || q.trim().length < 2}>
                {busy ? 'מחפש…' : 'חיפוש'}
              </Button>
              <p className="ip-footnote">הסרה מנתקת את האדם מהילד ומוציאה אותו מקבוצות הילד (אם אין לו שם ילד אחר או תפקיד). הפעולה נרשמת ביומן עם הסיבה.</p>
            </form>
          </Card>
          {error && <p className="ip-error" role="alert">{error}</p>}
          {rows && kids.length === 0 && <p className="ip-muted ip-pad">לא נמצאו ילדים עם הורים מקושרים.</p>}
          {kids.map((k) => (
            <Card key={k.id} padded={false}>
              <div className="ip-member ip-family-head">
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">{k.name}</span>
                  {k.meta && <span className="ip-list-row-sub">{k.meta}</span>}
                </span>
              </div>
              {k.members.map((m) => (
                <div key={m.user_id} className="ip-member ip-request">
                  <InitialsAvatar name={m.member_name || m.member_email || '?'} size={36} tone={m.relation === 'parent' ? 'navy' : 'blue'} />
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">{m.member_name || 'ללא שם'}</span>
                    <span className="ip-list-row-sub" dir="auto">
                      {[m.member_email, m.kinship, `מאז ${new Date(m.since).toLocaleDateString('he-IL')}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="ip-find-actions">
                    <Tag tone={m.relation === 'parent' ? 'navy' : 'neutral'}>{m.relation === 'parent' ? 'הורה' : 'משפחה'}</Tag>
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(m)}>
                      הסרה
                    </Button>
                  </span>
                </div>
              ))}
            </Card>
          ))}
        </>
      )}
      <BottomSheet open={!!removing} onClose={() => setRemoving(null)} title="הסרה מהילד">
        {removing && (
          <div className="ip-form ip-form--sheet">
            <p>
              להסיר את <strong>{removing.member_name || removing.member_email}</strong> מ<strong>{removing.child_name}</strong>?
            </p>
            <Field label="סיבה (נרשמת ביומן)">
              <input className="ip-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="לדוגמה: התברר שאינו ההורה" />
            </Field>
            {error && <p className="ip-error" role="alert">{error}</p>}
            <Button variant="primary" disabled={busy} onClick={() => void remove()}>
              {busy ? 'מסיר…' : 'הסרה'}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              ביטול
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
