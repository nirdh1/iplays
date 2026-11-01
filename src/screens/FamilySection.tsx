/**
 * Family tab: the people linked to each of my children (parents, grandparents,
 * ...), what each may do, one-time invite links, and accepting an invite.
 * Server side: supabase/migrations/20261101996000_family_members.sql
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { BottomSheet } from '../components/shell';
import { Field } from '../components/form';
import { useAuth, clearFamilyInvite, readFamilyInvite } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import type { Relation } from '../lib/joinApi';
import {
  KINSHIPS,
  PARENT_KINSHIPS,
  PERM_LABELS,
  acceptFamilyInvite,
  createFamilyInvite,
  familyError,
  familyInviteInfo,
  familyInviteLink,
  leaveChild,
  myFamily,
  myFamilyInvites,
  permsSummary,
  removeFamilyMember,
  revokeFamilyInvite,
  updateFamilyMember,
  type FamilyInvite,
  type FamilyInviteInfo,
  type FamilyMember,
  type FamilyPerms,
} from '../lib/familyApi';
import '../theme/coach.css';

const errText = (e: unknown) => familyError(e) ?? friendlyError(e);
const NO_PERMS: FamilyPerms = { report: false, rides: false, pay: false };

function PermChecks({ value, onChange }: { value: FamilyPerms; onChange: (p: FamilyPerms) => void }) {
  return (
    <div className="ip-form">
      <p className="ip-muted">צפייה בילד, בלו"ז, במשחקים ובתוצאות כלולה תמיד. מה עוד מותר?</p>
      {PERM_LABELS.map((p) => (
        <label key={p.key} className="ip-check">
          <input type="checkbox" checked={value[p.key]} onChange={(e) => onChange({ ...value, [p.key]: e.target.checked })} />
          <span>
            {p.label} <span className="ip-muted">· {p.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function KinshipInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Field label="קרבה לילד">
      <input className="ip-input" list="ip-kinships" value={value} maxLength={30} onChange={(e) => onChange(e.target.value)} placeholder="לדוגמה: סבתא" />
      <datalist id="ip-kinships">
        {options.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </Field>
  );
}

/** Copy / WhatsApp for a family invite link. */
function InviteLinkBox({ code, text }: { code: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const link = familyInviteLink(code);
  const message = `${text} ${link}`;
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
        await navigator.share({ title: 'iplays', text: message });
        return;
      } catch {
        /* cancelled */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }
  return (
    <div className="ip-invite">
      <input className="ip-input ip-invite-link" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="קישור ההזמנה" />
      <div className="ip-btn-row">
        <Button variant="lime" icon="chat" onClick={share}>
          שליחה בוואטסאפ
        </Button>
        <Button variant="secondary" icon={copied ? 'check' : 'plus'} onClick={copy}>
          {copied ? 'הועתק' : 'העתקת קישור'}
        </Button>
      </div>
      <p className="ip-footnote">הקישור חד־פעמי ותקף 14 יום. מי שיפתח אותו ויאשר יצורף לילד מיד.</p>
    </div>
  );
}

function InviteSheet({
  open,
  onClose,
  kids,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  kids: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [relation, setRelation] = useState<Relation>('family');
  const [picked, setPicked] = useState<string[]>([]);
  const [kinship, setKinship] = useState('');
  const [perms, setPerms] = useState<FamilyPerms>(NO_PERMS);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPicked(kids.map((k) => k.id));
      setCode(null);
      setError(null);
      setKinship('');
      setPerms(NO_PERMS);
    }
  }, [open, kids]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCode(await createFamilyInvite(picked, relation, kinship.trim(), relation === 'parent' ? NO_PERMS : perms));
      onCreated();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const names = kids.filter((k) => picked.includes(k.id)).map((k) => k.name.split(' ')[0]);
  return (
    <BottomSheet open={open} onClose={onClose} title="הזמנת בן משפחה">
      {code ? (
        <div className="ip-form ip-form--sheet">
          <p>
            ההזמנה מוכנה. שלחו את הקישור ל{kinship.trim() || (relation === 'parent' ? 'הורה השני' : 'בן המשפחה')}.
          </p>
          <InviteLinkBox code={code} text={`הוזמנת להצטרף ב-iplays${names.length ? ` ל${names.join(' ול')}` : ''}:`} />
          <Button variant="secondary" onClick={onClose}>
            סיום
          </Button>
        </div>
      ) : (
        <form className="ip-form ip-form--sheet" onSubmit={submit}>
          <Segmented
            label="סוג ההזמנה"
            items={[
              { id: 'family', label: 'בן משפחה' },
              { id: 'parent', label: 'הורה שני' },
            ]}
            value={relation}
            onChange={setRelation}
          />
          {kids.length > 1 && (
            <div className="ip-form">
              <p className="ip-muted">לאילו ילדים?</p>
              {kids.map((k) => (
                <label key={k.id} className="ip-check">
                  <input
                    type="checkbox"
                    checked={picked.includes(k.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, k.id] : picked.filter((x) => x !== k.id))}
                  />
                  <span>{k.name}</span>
                </label>
              ))}
            </div>
          )}
          <KinshipInput value={kinship} onChange={setKinship} options={relation === 'parent' ? PARENT_KINSHIPS : KINSHIPS} />
          {relation === 'family' ? (
            <PermChecks value={perms} onChange={setPerms} />
          ) : (
            <p className="ip-muted">הורה מקבל את כל ההרשאות: עריכת פרטי הילד, היעדרויות, הסעות, תשלומים והזמנת בני משפחה.</p>
          )}
          {error && <p className="ip-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy || picked.length === 0}>
            {busy ? 'יוצר הזמנה…' : 'יצירת קישור הזמנה'}
          </Button>
        </form>
      )}
    </BottomSheet>
  );
}

function MemberSheet({
  member,
  iAmParent,
  onClose,
  onChanged,
}: {
  member: FamilyMember | null;
  iAmParent: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [kinship, setKinship] = useState('');
  const [perms, setPerms] = useState<FamilyPerms>(NO_PERMS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (member) {
      setKinship(member.kinship);
      setPerms({ report: member.can_report, rides: member.can_rides, pay: member.can_pay });
      setError(null);
      setConfirm(false);
    }
  }, [member]);
  if (!member) return <BottomSheet open={false} onClose={onClose} title="" children={null} />;

  const canEditPerms = iAmParent && member.relation === 'family';
  const canRemove = iAmParent && member.relation === 'family' && !member.is_me;
  const child = member.child_name.split(' ')[0];

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={!!member} onClose={onClose} title={member.is_me ? `אני · ${child}` : `${member.member_name || 'בן משפחה'} · ${child}`}>
      <form
        className="ip-form ip-form--sheet"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateFamilyMember(member.player_id, member.user_id, kinship.trim(), canEditPerms ? perms : undefined));
        }}
      >
        <KinshipInput value={kinship} onChange={setKinship} options={member.relation === 'parent' ? PARENT_KINSHIPS : KINSHIPS} />
        {canEditPerms ? (
          <PermChecks value={perms} onChange={setPerms} />
        ) : (
          <p className="ip-muted">{permsSummary(member)}</p>
        )}
        {error && <p className="ip-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          שמירה
        </Button>
        {canRemove &&
          (confirm ? (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => removeFamilyMember(member.player_id, member.user_id))}>
              כן, להסיר מ{child}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              הסרה מהמשפחה של {child}
            </Button>
          ))}
        {member.is_me &&
          (confirm ? (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => leaveChild(member.player_id, member.user_id))}>
              כן, לעזוב את {child}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              לעזוב את {child}
            </Button>
          ))}
        {member.relation === 'parent' && !member.is_me && (
          <p className="ip-footnote">אי אפשר להגביל או להסיר הורה. כל הורה יכול לעזוב בעצמו.</p>
        )}
      </form>
    </BottomSheet>
  );
}

/** "Family members and permissions", grouped by child. */
export function FamilyMembersSection() {
  const [rows, setRows] = useState<FamilyMember[] | null>(null);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // Before the migration runs these fail; the section then stays hidden.
    myFamily().then(setRows, () => setRows([]));
    myFamilyInvites().then(setInvites, () => setInvites([]));
  }, []);
  useEffect(load, [load]);

  const children = useMemo(() => {
    const map = new Map<string, { id: string; name: string; iAmParent: boolean; members: FamilyMember[] }>();
    for (const r of rows ?? []) {
      const c = map.get(r.player_id) ?? { id: r.player_id, name: r.child_name, iAmParent: false, members: [] };
      c.members.push(r);
      if (r.is_me && r.relation === 'parent') c.iAmParent = true;
      map.set(r.player_id, c);
    }
    return [...map.values()];
  }, [rows]);
  const myKids = children.filter((c) => c.iAmParent).map((c) => ({ id: c.id, name: c.name }));
  const kidName = (id: string) => children.find((c) => c.id === id)?.name.split(' ')[0] ?? '';

  if (!rows || children.length === 0) return null;
  return (
    <section>
      <SectionHeader title="בני משפחה והרשאות" icon="shield" action={myKids.length ? 'הזמנה' : undefined} onAction={() => setInviteOpen(true)} />
      <div className="ip-stack">
        {children.map((c) => (
          <Card key={c.id} padded={false}>
            <div className="ip-member ip-family-head">
              <span className="ip-list-row-title">{c.name}</span>
            </div>
            {c.members.map((m) => (
              <button
                key={m.user_id}
                type="button"
                className="ip-member ip-member--button"
                onClick={() => (c.iAmParent || m.is_me ? setEditing(m) : undefined)}
                disabled={!c.iAmParent && !m.is_me}
              >
                <InitialsAvatar name={m.member_name || m.kinship || '?'} size={36} tone={m.relation === 'parent' ? 'navy' : 'blue'} />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {m.member_name || 'ללא שם'}
                    {m.is_me ? ' (אני)' : ''}
                  </span>
                  <span className="ip-list-row-sub">{[m.kinship, permsSummary(m)].filter(Boolean).join(' · ')}</span>
                </span>
                {m.relation === 'parent' ? <Tag tone="navy">הורה</Tag> : <Tag>{m.can_report || m.can_rides || m.can_pay ? 'משפחה' : 'צפייה'}</Tag>}
              </button>
            ))}
          </Card>
        ))}
        {invites.length > 0 && (
          <Card padded={false}>
            <div className="ip-member ip-family-head">
              <span className="ip-list-row-title">הזמנות שעוד לא נפתחו</span>
            </div>
            {invites.map((i) => (
              <div key={i.id} className="ip-member ip-request">
                <InitialsAvatar name={i.kinship || '?'} size={36} tone="blue" />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {i.kinship || (i.relation === 'parent' ? 'הורה שני' : 'בן משפחה')} · {i.player_ids.map(kidName).filter(Boolean).join(', ')}
                  </span>
                  <span className="ip-list-row-sub">בתוקף עד {new Date(i.expires_at).toLocaleDateString('he-IL')}</span>
                </span>
                <span className="ip-find-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      revokeFamilyInvite(i.id)
                        .then(load)
                        .catch((e) => setError(errText(e)))
                    }
                  >
                    ביטול
                  </Button>
                </span>
              </div>
            ))}
          </Card>
        )}
        {myKids.length > 0 && (
          <Button variant="secondary" icon="plus" onClick={() => setInviteOpen(true)}>
            הזמנת הורה שני או בן משפחה
          </Button>
        )}
        {error && <p className="ip-error" role="alert">{error}</p>}
      </div>
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} kids={myKids} onCreated={load} />
      <MemberSheet
        member={editing}
        iAmParent={!!children.find((c) => c.id === editing?.player_id)?.iAmParent}
        onClose={() => setEditing(null)}
        onChanged={load}
      />
    </section>
  );
}

/** Shown on the Family tab while an invite link (#fam/CODE) waits to be accepted. */
export function FamilyInviteCard() {
  const auth = useAuth();
  const [code, setCode] = useState(readFamilyInvite);
  const [info, setInfo] = useState<FamilyInviteInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    familyInviteInfo(code).then(setInfo, () => setInfo(null));
  }, [code]);

  const dismiss = () => {
    clearFamilyInvite();
    setCode(null);
  };

  async function accept() {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await acceptFamilyInvite(code);
      clearFamilyInvite();
      await auth.refresh();
      window.location.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!code || info === undefined) return null;
  const kids = info?.children.join(' ו') ?? '';
  const as = info?.kinship || (info?.relation === 'parent' ? 'הורה' : 'בן/בת משפחה');
  return (
    <section>
      <Card className="ip-family-invite">
        <div className="ip-form">
          <SectionHeader title="הזמנה למשפחה" icon="family" />
          {!info || info.status === 'expired' || info.status === 'revoked' || info.status === 'used' ? (
            <p>{info?.status === 'used' ? 'מישהו אחר כבר השתמש בהזמנה הזו.' : 'ההזמנה לא בתוקף.'} בקשו מההורה קישור חדש.</p>
          ) : info.status === 'accepted' ? (
            <p>כבר הצטרפת דרך ההזמנה הזו.</p>
          ) : (
            <>
              <p>
                <strong>{info.inviter || 'הורה'}</strong> הזמין/ה אותך להצטרף כ{as} של <strong>{kids}</strong>.
              </p>
              <p className="ip-muted">{permsSummary(info)}</p>
              {error && <p className="ip-error" role="alert">{error}</p>}
              <div className="ip-btn-row">
                <Button variant="primary" disabled={busy} onClick={() => void accept()}>
                  {busy ? 'מצטרף/ת…' : 'הצטרפות'}
                </Button>
                <Button variant="ghost" onClick={dismiss}>
                  לא עכשיו
                </Button>
              </div>
            </>
          )}
          {info && info.status !== 'valid' && (
            <Button variant="ghost" size="sm" onClick={dismiss}>
              סגירה
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
