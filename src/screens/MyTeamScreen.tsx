/**
 * Real team management (backend mode): invite parents, roster with shirt
 * numbers, claim/add your child, member list with roles.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, SectionHeader, Tag, TeamCrest } from '../components/ui';
import { BottomSheet } from '../components/shell';
import {
  addMyChild,
  addPlayer,
  claimPlayer,
  friendlyError,
  getInviteCode,
  getMembers,
  getRoster,
  inviteLink,
  newInviteCode,
  roleLabel,
  sportLabel,
  type Member,
  type Player,
} from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Err, Field } from '../components/form';

export function MyTeamScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { session, teams, refresh } = useAuth();
  const me = session!.user.id;
  const team = teams.find((t) => t.id === teamId);
  const staff = team?.role === 'admin' || team?.role === 'coach';
  const [roster, setRoster] = useState<Player[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'player' | 'child'>(null);

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([getRoster(teamId), getMembers(teamId)]);
      setRoster(r);
      setMembers(m);
      if (staff) setCode((await getInviteCode(teamId)) ?? (await newInviteCode(teamId)));
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [teamId, staff]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!team) {
    return (
      <div className="ip-stack">
        <BackBar onBack={onBack} title="הקבוצה" />
        <EmptyState icon="team" title="הקבוצה לא נמצאה" text="ייתכן שיצאת מהקבוצה או שהקישור שגוי." />
      </div>
    );
  }

  const mineCount = roster?.filter((p) => p.guardians.includes(me)).length ?? 0;

  return (
    <div className="ip-stack">
      <BackBar onBack={onBack} title="ניהול הקבוצה" />

      <Card tone="navy" className="ip-team-hero">
        <div className="ip-team-hero-id">
          <TeamCrest name={team.club || team.name} tone="lime" size={56} />
          <div>
            <h1>{team.name}</h1>
            {team.club && <p>{team.club}</p>}
            <p className="ip-on-navy-muted">
              {sportLabel[team.sport]} · עונת {team.season} · {roleLabel[team.role]}
            </p>
          </div>
        </div>
      </Card>

      {error && <p className="ip-error" role="alert">{error}</p>}

      {staff && code && (
        <section>
          <SectionHeader title="הזמנת הורים" icon="plus" />
          <Card>
            <InviteShare code={code} teamName={team.name} />
          </Card>
        </section>
      )}

      <section>
        <SectionHeader title={roster ? `סגל · ${roster.length} שחקנים` : 'סגל'} icon="team" />
        <Card padded={false}>
          {roster === null ? (
            <p className="ip-muted ip-pad">טוען…</p>
          ) : roster.length === 0 ? (
            <EmptyState icon="team" title="עוד אין שחקנים" text={staff ? 'הוסיפו שחקנים או חכו שההורים יוסיפו את הילדים שלהם.' : 'הוסיפו את הילד שלכם כדי שיופיע בסגל.'} />
          ) : (
            <ul className="ip-roster">
              {roster.map((p) => {
                const mine = p.guardians.includes(me);
                return (
                  <li key={p.id} className={mine ? 'is-mine' : ''}>
                    <span className="ip-roster-no">{p.shirt_number ?? '–'}</span>
                    <InitialsAvatar name={`${p.first_name} ${p.last_name}`} size={40} tone={mine ? 'lime' : 'blue'} />
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">
                        {p.first_name} {p.last_name}
                      </span>
                      <span className="ip-list-row-sub">{[p.position, p.birth_year && `שנתון ${p.birth_year}`].filter(Boolean).join(' · ') || ' '}</span>
                    </span>
                    {mine ? (
                      <Tag tone="lime">הילד שלי</Tag>
                    ) : p.guardians.length === 0 ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          try {
                            await claimPlayer(p.id);
                            await load();
                          } catch (e) {
                            setError(friendlyError(e));
                          }
                        }}
                      >
                        זה הילד שלי
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="ip-btn-row">
          {staff && (
            <Button variant="primary" icon="plus" onClick={() => setSheet('player')}>
              הוספת שחקן
            </Button>
          )}
          <Button variant={staff ? 'secondary' : 'primary'} icon="user" onClick={() => setSheet('child')}>
            {mineCount ? 'הוספת ילד נוסף' : 'הוספת הילד שלי'}
          </Button>
        </div>
      </section>

      <section>
        <SectionHeader title={`חברי הקבוצה · ${members.length}`} icon="family" />
        <Card padded={false}>
          {members.map((m) => (
            <div key={m.user_id} className="ip-member">
              <InitialsAvatar name={m.full_name} size={40} tone={m.role === 'parent' ? 'blue' : 'navy'} />
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">
                  {m.full_name}
                  {m.user_id === me && <span className="ip-muted"> (אני)</span>}
                </span>
                <span className="ip-list-row-sub">{roleLabel[m.role]}</span>
              </span>
            </div>
          ))}
        </Card>
      </section>

      <PlayerSheet
        mode={sheet}
        onClose={() => setSheet(null)}
        onSave={async (p) => {
          if (sheet === 'player') await addPlayer(teamId, p);
          else await addMyChild(teamId, p);
          setSheet(null);
          await Promise.all([load(), refresh()]);
        }}
      />
    </div>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="ip-backbar">
      <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
        <Icon name="back" size={20} />
      </button>
      <h1>{title}</h1>
      <span />
    </div>
  );
}

function PlayerSheet({
  mode,
  onClose,
  onSave,
}: {
  mode: null | 'player' | 'child';
  onClose: () => void;
  onSave: (p: { first: string; last: string; number: number | null; position: string; birthYear: number | null }) => Promise<void>;
}) {
  const [f, setF] = useState({ first: '', last: '', number: '', position: '', birthYear: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        first: f.first,
        last: f.last,
        number: f.number ? Number(f.number) : null,
        position: f.position,
        birthYear: f.birthYear ? Number(f.birthYear) : null,
      });
      setF({ first: '', last: '', number: '', position: '', birthYear: '' });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={mode !== null} onClose={onClose} title={mode === 'child' ? 'הוספת הילד שלי' : 'הוספת שחקן לסגל'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <div className="ip-field-row">
          <Field label="שם פרטי">
            <input id="pl-first" className="ip-input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} required />
          </Field>
          <Field label="שם משפחה">
            <input id="pl-last" className="ip-input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />
          </Field>
        </div>
        <div className="ip-field-row">
          <Field label="מספר חולצה">
            <input id="pl-number" className="ip-input" inputMode="numeric" dir="ltr" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
          </Field>
          <Field label="שנת לידה">
            <input id="pl-year" className="ip-input" inputMode="numeric" dir="ltr" value={f.birthYear} onChange={(e) => setF({ ...f, birthYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </Field>
        </div>
        <Field label="תפקיד">
          <input id="pl-pos" className="ip-input" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="לא חובה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !f.first.trim()}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/** Invite code + link with copy and native share. */
export function InviteShare({ code, teamName }: { code: string; teamName: string }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(code);
  const text = `הצטרפו לקבוצה ${teamName} ב-iplays: ${link}`;

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
      <span className="ip-invite-label">קוד הזמנה</span>
      <strong className="ip-invite-code" dir="ltr">
        {code}
      </strong>
      <input className="ip-input ip-invite-link" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="קישור הזמנה" />
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
