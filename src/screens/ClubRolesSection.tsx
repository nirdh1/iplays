/**
 * Club panel → "תפקידים" (spec section 4): the club's roles (templates and
 * custom), a level per permission domain for each role, and who holds which
 * role for the whole club, one program or one team. The database enforces
 * every level (my_level / can() in RLS); this screen only edits roles.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { Icon } from '../components/Icon';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  archiveClubRole,
  assignClubRole,
  clubError,
  createRoleInvite,
  getClubPeople,
  getDomains,
  levelLabel,
  listClubRoles,
  listRoleAssignments,
  saveClubRole,
  staffInviteLink,
  unassignClubRole,
  type Club,
  type ClubAccess,
  type ClubData,
  type ClubPerson,
  type ClubRoleDef,
  type Domain,
  type RoleAssignment,
} from '../lib/clubApi';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);

export function ClubRolesSection({ club, data, access }: { club: Club; data: ClubData; access: ClubAccess }) {
  const [roles, setRoles] = useState<ClubRoleDef[] | null>(null);
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [people, setPeople] = useState<ClubPerson[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [editing, setEditing] = useState<ClubRoleDef | 'new' | null>(null);
  const [assigning, setAssigning] = useState<ClubRoleDef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, a, d] = await Promise.all([listClubRoles(club.id), listRoleAssignments(club.id), getDomains()]);
      setRoles(r);
      setAssignments(a);
      setDomains(d);
      if (access.is_admin) setPeople(await getClubPeople(club.id));
    } catch (e) {
      setError(errText(e));
    }
  }, [club.id, access.is_admin]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const canTouch = (r: ClubRoleDef) => access.is_admin || !r.sensitive;
  const domainLabel = (d: string) => domains.find((x) => x.domain === d)?.label ?? d;

  return (
    <section className="ip-stack">
      <Err error={error} />
      <SectionHeader title={roles ? `תפקידים במועדון · ${roles.length}` : 'תפקידים במועדון'} icon="shield" action="תפקיד חדש" onAction={() => setEditing('new')} />
      {roles === null ? (
        <p className="ip-muted">טוען…</p>
      ) : roles.length === 0 ? (
        <Card>
          <EmptyState icon="shield" title="אין תפקידים" text="צרו תפקיד ראשון." />
        </Card>
      ) : (
        <Card padded={false}>
          {roles.map((r) => {
            const holders = assignments.filter((a) => a.role_id === r.id);
            return (
              <div key={r.id} className="ip-club-role">
                <div className="ip-club-row">
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">
                      {r.name} {r.sensitive && <Icon name="shield" size={14} />}
                    </span>
                    <span className="ip-list-row-sub">{r.description || Object.keys(r.perms).map(domainLabel).join(' · ')}</span>
                  </span>
                  {canTouch(r) && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setAssigning(r)}>
                        שיוך
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                        עריכה
                      </Button>
                    </>
                  )}
                </div>
                {holders.length > 0 && (
                  <ul className="ip-club-grants ip-club-holders">
                    {holders.map((a) => (
                      <li key={a.id}>
                        <span>
                          {a.full_name} · {a.scope_label}
                        </span>
                        {canTouch(r) && (
                          <Button variant="ghost" size="sm" onClick={() => run(() => unassignClubRole(a.id))}>
                            הסרה
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </Card>
      )}
      <p className="ip-muted ip-club-hint">
        <Icon name="shield" size={14} /> כל הרשאה נבדקת גם בשרת. תפקיד יכול לחול על כל המועדון, על מסגרת (ליגה / אקדמיה) או על קבוצה אחת. מידע של מועדון אחד לעולם לא נראה למועדון אחר.
      </p>

      {editing && (
        <RoleSheet
          club={club}
          role={editing === 'new' ? null : editing}
          domains={domains}
          isAdmin={access.is_admin}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {assigning && (
        <AssignSheet
          club={club}
          data={data}
          role={assigning}
          people={people}
          onClose={() => setAssigning(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}

function RoleSheet({
  club,
  role,
  domains,
  isAdmin,
  onClose,
  onSaved,
}: {
  club: Club;
  role: ClubRoleDef | null;
  domains: Domain[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Record<string, number>>(role?.perms ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveClubRole({ clubId: club.id, roleId: role?.id ?? null, name, description, perms });
      await onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!role || !window.confirm(`להעביר לארכיון את התפקיד "${role.name}"? מי שמחזיק בו יאבד את ההרשאות שלו.`)) return;
    setBusy(true);
    try {
      await archiveClubRole(role.id);
      await onSaved();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title={role ? `תפקיד · ${role.name}` : 'תפקיד חדש'}>
      <form className="ip-stack ip-stack--tight" onSubmit={submit}>
        <Field label="שם התפקיד">
          <input className="ip-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="תיאור (לא חובה)">
          <input className="ip-input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <h3 className="ip-club-h3">הרשאות</h3>
        <div className="ip-club-perms">
          {domains.map((d) => {
            const locked = d.domain === 'permissions' && !isAdmin;
            return (
              <label key={d.domain} className="ip-club-perm">
                <span>{d.label}</span>
                <select
                  className="ip-input ip-club-select"
                  value={perms[d.domain] ?? 0}
                  disabled={locked}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setPerms((p) => {
                      const next = { ...p };
                      if (v > 0) next[d.domain] = v;
                      else delete next[d.domain];
                      return next;
                    });
                  }}
                >
                  <option value={0}>אין</option>
                  {[1, 2, 3, 4].map((l) => (
                    <option key={l} value={l}>
                      {l === 4 ? 'ניהול ומחיקה / ארכוב' : levelLabel[l]}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <p className="ip-muted ip-club-hint">כל רמה כוללת את הרמות שלפניה: צפייה ← יצירה ← עריכה ← ניהול ומחיקה / ארכוב.</p>
        <Err error={error} />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? 'שומר…' : 'שמירה'}
        </Button>
        {role && (
          <Button variant="ghost" disabled={busy} onClick={archive}>
            העברה לארכיון
          </Button>
        )}
      </form>
    </BottomSheet>
  );
}

function AssignSheet({
  club,
  data,
  role,
  people,
  onClose,
  onChanged,
}: {
  club: Club;
  data: ClubData;
  role: ClubRoleDef;
  people: ClubPerson[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [scope, setScope] = useState('club');
  const [userId, setUserId] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const scopeIds = useMemo(() => {
    const [kind, id] = scope.split(':');
    return { programId: kind === 'program' ? id : null, teamId: kind === 'team' ? id : null };
  }, [scope]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title={`שיוך לתפקיד · ${role.name}`}>
      <div className="ip-stack ip-stack--tight">
        <Field label="היכן התפקיד חל">
          <select className="ip-input" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="club">כל המועדון</option>
            {data.programs.map((p) => (
              <option key={p.id} value={`program:${p.id}`}>
                כל ה{p.name}
              </option>
            ))}
            {data.teams.map((t) => (
              <option key={t.id} value={`team:${t.id}`}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        {people.length > 0 && (
          <>
            <h3 className="ip-club-h3">איש צוות קיים</h3>
            <div className="ip-club-search">
              <Field label="מי">
                <select className="ip-input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">בחירה…</option>
                  {people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                variant="primary"
                disabled={busy || !userId}
                onClick={() =>
                  run(async () => {
                    await assignClubRole({ clubId: club.id, roleId: role.id, userId, ...scopeIds });
                    await onChanged();
                    setDone('השיוך נשמר.');
                  })
                }
              >
                שיוך
              </Button>
            </div>
          </>
        )}

        <h3 className="ip-club-h3">אדם חדש</h3>
        <p className="ip-muted">קישור הזמנה אישי: מי שנכנס דרכו מצטרף לצוות המועדון עם התפקיד הזה. לשימוש אחד, תקף 14 יום.</p>
        <Button
          variant="secondary"
          icon="plus"
          disabled={busy}
          onClick={() => run(async () => setLink(staffInviteLink(await createRoleInvite({ clubId: club.id, roleId: role.id, ...scopeIds }))))}
        >
          יצירת קישור הזמנה
        </Button>
        {link && (
          <div className="ip-club-invite">
            <bdi dir="ltr">{link}</bdi>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                navigator.share
                  ? navigator.share({ text: `הזמנה לתפקיד ${role.name} ב${club.name} ב-iplays: ${link}` }).catch(() => undefined)
                  : navigator.clipboard.writeText(link).then(() => setDone('הקישור הועתק.'))
              }
            >
              שליחה
            </Button>
          </div>
        )}
        {done && <Tag tone="lime">{done}</Tag>}
        <Err error={error} />
      </div>
    </BottomSheet>
  );
}
