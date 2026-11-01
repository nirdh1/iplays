/**
 * Club panel → "צוות והרשאות": invite staff, set each person's role in the
 * club's teams, and give extra permissions by club / program / team, domain
 * and level (view / create / edit / manage). The database enforces all of it
 * (permission_grants + can() in RLS); this screen only edits the grants.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  clubError,
  clubRoleLabel,
  createClubInvite,
  getClubPeople,
  getDomains,
  getGrants,
  levelLabel,
  setPermission,
  setTeamRole,
  staffInviteLink,
  teamRoleLabel,
  type Club,
  type ClubData,
  type ClubPerson,
  type Domain,
  type Grant,
  type StaffTeamRole,
  type TeamRole,
} from '../lib/clubApi';

const errText = (e: unknown) => clubError(e) ?? friendlyError(e);
const staffRoles: StaffTeamRole[] = ['coach', 'assistant_coach', 'instructor', 'team_manager'];

export function ClubStaffSection({ club, data }: { club: Club; data: ClubData }) {
  const [people, setPeople] = useState<ClubPerson[] | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, g, d] = await Promise.all([getClubPeople(club.id), getGrants(club.id), getDomains()]);
      setPeople(p);
      setGrants(g);
      setDomains(d);
    } catch (e) {
      setError(errText(e));
    }
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const teamName = useMemo(() => new Map(data.teams.map((t) => [t.id, t.name])), [data.teams]);
  const person = people?.find((p) => p.user_id === selected) ?? null;

  return (
    <section className="ip-stack">
      <InviteCard club={club} data={data} />
      <Err error={error} />
      <SectionHeader title={people ? `צוות המועדון · ${people.length}` : 'צוות המועדון'} icon="shield" />
      <Card padded={false}>
        {people === null ? (
          <p className="ip-muted ip-pad">טוען…</p>
        ) : people.length === 0 ? (
          <EmptyState icon="user" title="עוד אין צוות" text="הזמינו מאמנים ומדריכים עם קישור הזמנה." />
        ) : (
          <ul className="ip-roster">
            {people.map((p) => {
              const extra = grants.filter((g) => g.user_id === p.user_id).length;
              return (
                <li key={p.user_id}>
                  <InitialsAvatar name={p.full_name} size={40} tone={p.club_role === 'owner' || p.club_role === 'admin' ? 'lime' : 'blue'} />
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">{p.full_name}</span>
                    <span className="ip-club-tags">
                      {p.club_role && <Tag tone="navy">{clubRoleLabel[p.club_role]}</Tag>}
                      {p.team_roles.map((r) => (
                        <Tag key={r.team_id}>
                          {teamRoleLabel[r.role]} · {teamName.get(r.team_id) ?? 'קבוצה'}
                        </Tag>
                      ))}
                      {extra > 0 && <Tag tone="blue">{extra} הרשאות נוספות</Tag>}
                    </span>
                  </span>
                  {p.club_role !== 'owner' && p.club_role !== 'admin' && (
                    <Button variant="secondary" size="sm" onClick={() => setSelected(p.user_id)}>
                      הרשאות
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="ip-muted ip-club-hint">
        <Icon name="shield" size={14} /> בעלים ומנהלי מועדון רואים ומנהלים הכול. מאמן רואה רק את הקבוצה שלו, אלא אם נתתם לו הרשאה נוספת כאן.
      </p>

      {person && (
        <PersonSheet
          club={club}
          data={data}
          person={person}
          grants={grants.filter((g) => g.user_id === person.user_id)}
          domains={domains}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}

/* --------------------------------------------------------------- invite */

function InviteCard({ club, data }: { club: Club; data: ClubData }) {
  const [clubRole, setClubRole] = useState<'staff' | 'admin'>('staff');
  const [teamId, setTeamId] = useState('');
  const [teamRole, setTeamRoleState] = useState<StaffTeamRole>('coach');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const code = await createClubInvite({ clubId: club.id, clubRole, teamId: teamId || null, teamRole });
      setLink(staffInviteLink(code));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!link) return;
    const text = `הזמנה לצוות ${club.name} ב-iplays: ${link}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <Card>
      <form className="ip-stack ip-stack--tight" onSubmit={submit}>
        <h2 className="ip-club-h2">הזמנת איש צוות</h2>
        <div className="ip-club-grid">
          <Field label="תפקיד במועדון">
            <select className="ip-input" value={clubRole} onChange={(e) => setClubRole(e.target.value as 'staff' | 'admin')}>
              <option value="staff">צוות</option>
              {club.role === 'owner' && <option value="admin">מנהל/ת מועדון</option>}
            </select>
          </Field>
          <Field label="קבוצה (לא חובה)">
            <select className="ip-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">בלי קבוצה</option>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          {teamId && (
            <Field label="תפקיד בקבוצה">
              <select className="ip-input" value={teamRole} onChange={(e) => setTeamRoleState(e.target.value as StaffTeamRole)}>
                {staffRoles.map((r) => (
                  <option key={r} value={r}>
                    {teamRoleLabel[r]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Err error={error} />
        <Button type="submit" variant="primary" icon="plus" disabled={busy}>
          {busy ? 'יוצר…' : 'יצירת קישור הזמנה'}
        </Button>
        {link && (
          <div className="ip-club-invite">
            <bdi dir="ltr">{link}</bdi>
            <Button variant="secondary" size="sm" onClick={share}>
              {copied ? 'הועתק' : 'שליחה'}
            </Button>
            <p className="ip-muted">הקישור לשימוש אחד ותקף 14 יום.</p>
          </div>
        )}
      </form>
    </Card>
  );
}

/* --------------------------------------------------------- person sheet */

function PersonSheet({
  club,
  data,
  person,
  grants,
  domains,
  onClose,
  onChanged,
}: {
  club: Club;
  data: ClubData;
  person: ClubPerson;
  grants: Grant[];
  domains: Domain[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [scope, setScope] = useState('club');
  const [domain, setDomain] = useState(domains[0]?.domain ?? 'roster');
  const [level, setLevel] = useState(1);
  const [roleTeam, setRoleTeam] = useState(data.teams[0]?.id ?? '');
  const [role, setRole] = useState<TeamRole>('coach');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const domainLabel = (d: string) => domains.find((x) => x.domain === d)?.label ?? d;
  const scopeLabel = (g: Grant) =>
    g.team_id
      ? data.teams.find((t) => t.id === g.team_id)?.name ?? 'קבוצה'
      : g.program_id
        ? `כל ה${data.programs.find((p) => p.id === g.program_id)?.name ?? 'מסגרת'}`
        : 'כל המועדון';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const addGrant = (e: FormEvent) => {
    e.preventDefault();
    const [kind, id] = scope.split(':');
    void run(() =>
      setPermission({
        clubId: club.id,
        userId: person.user_id,
        domain,
        level,
        programId: kind === 'program' ? id : null,
        teamId: kind === 'team' ? id : null,
      }),
    );
  };

  return (
    <BottomSheet open onClose={onClose} title={`הרשאות · ${person.full_name}`}>
      <div className="ip-stack ip-stack--tight">
        <h3 className="ip-club-h3">תפקידים בקבוצות</h3>
        {person.team_roles.length === 0 ? (
          <p className="ip-muted">לא משויך לאף קבוצה.</p>
        ) : (
          <ul className="ip-club-grants">
            {person.team_roles.map((r) => (
              <li key={r.team_id}>
                <span>
                  {data.teams.find((t) => t.id === r.team_id)?.name} · {teamRoleLabel[r.role]}
                </span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => setTeamRole(r.team_id, person.user_id, 'parent'))}>
                  הסרה מהצוות
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="ip-club-grid">
          <Field label="קבוצה">
            <select className="ip-input" value={roleTeam} onChange={(e) => setRoleTeam(e.target.value)}>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="תפקיד">
            <select className="ip-input" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              {staffRoles.map((r) => (
                <option key={r} value={r}>
                  {teamRoleLabel[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button variant="secondary" disabled={busy || !roleTeam} onClick={() => run(() => setTeamRole(roleTeam, person.user_id, role))}>
          שיוך לקבוצה
        </Button>

        <h3 className="ip-club-h3">הרשאות נוספות</h3>
        {grants.length === 0 ? (
          <p className="ip-muted">אין הרשאות מעבר לתפקיד בקבוצה.</p>
        ) : (
          <ul className="ip-club-grants">
            {grants.map((g) => (
              <li key={g.id}>
                <span>
                  {domainLabel(g.domain)} · {levelLabel[g.level]} · {scopeLabel(g)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      setPermission({ clubId: club.id, userId: person.user_id, domain: g.domain, level: 0, programId: g.program_id, teamId: g.team_id }),
                    )
                  }
                >
                  ביטול
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form className="ip-stack ip-stack--tight" onSubmit={addGrant}>
          <div className="ip-club-grid">
            <Field label="היכן">
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
            <Field label="תחום">
              <select className="ip-input" value={domain} onChange={(e) => setDomain(e.target.value)}>
                {domains.map((d) => (
                  <option key={d.domain} value={d.domain}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="פעולה">
              <select className="ip-input" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {[1, 2, 3, 4].map((l) => (
                  <option key={l} value={l}>
                    {levelLabel[l]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Err error={error} />
          <Button type="submit" variant="primary" icon="plus" disabled={busy}>
            הוספת הרשאה
          </Button>
        </form>
      </div>
    </BottomSheet>
  );
}
