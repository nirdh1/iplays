/**
 * Real team management (backend mode): invite parents, roster with shirt
 * numbers, claim/add your child, member list with roles.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, SectionHeader, TeamCrest } from '../components/ui';
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
  isStaffRole,
} from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Err, Field } from '../components/form';
import { joinError, PARENT_DECLARATION, pendingJoinRequests, reviewJoinRequest, type PendingRequest } from '../lib/joinApi';
import { TeamLinkShare } from './TeamLinkShare';
import { ChildDetailsSheet } from './ChildDetailsSheet';
import { sportProfile } from '../lib/sports';

export function MyTeamScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { session, teams, refresh } = useAuth();
  const me = session!.user.id;
  const team = teams.find((t) => t.id === teamId);
  const staff = isStaffRole(team?.role);
  const [roster, setRoster] = useState<Player[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'player' | 'child'>(null);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [details, setDetails] = useState<Player | null>(null);
  const [claim, setClaim] = useState<Player | null>(null);
  const [showRoster, setShowRoster] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([getRoster(teamId), getMembers(teamId)]);
      setRoster(r);
      setMembers(m);
      if (staff) {
        // join requests need the search migration; without it the list stays empty
        setRequests(await pendingJoinRequests(teamId).catch(() => []));
        setCode((await getInviteCode(teamId)) ?? (await newInviteCode(teamId)));
      }
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
  // A parent whose child is already linked sees their child first; the full roster stays folded.
  const collapse = !staff && mineCount > 0;

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

      {staff && requests.length > 0 && (
        <section>
          <SectionHeader title={`בקשות הצטרפות · ${requests.length}`} icon="bell" />
          <Card padded={false}>
            {requests.map((r) => (
              <div key={r.id} className="ip-member ip-request">
                <InitialsAvatar name={r.requester || 'הורה'} size={40} tone="blue" />
                <span className="ip-list-row-text">
                  <span className="ip-list-row-title">
                    {r.requester || 'הורה'} · הורה של {r.child_name}
                  </span>
                  <span className="ip-list-row-sub">
                    {[r.birth_year && `שנתון ${r.birth_year}`, r.player_id ? 'ילד מהסגל' : 'ילד חדש', 'הצהיר/ה שהוא ההורה', r.message].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="ip-find-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      reviewJoinRequest(r.id, true)
                        .then(load)
                        .catch((e) => setError(joinError(e) ?? friendlyError(e)))
                    }
                  >
                    אישור
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      reviewJoinRequest(r.id, false)
                        .then(load)
                        .catch((e) => setError(joinError(e) ?? friendlyError(e)))
                    }
                  >
                    דחייה
                  </Button>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {staff && code && (
        <section>
          <SectionHeader title="הזמנת הורים" icon="plus" />
          <Card>
            <InviteShare code={code} teamName={team.name} />
          </Card>
        </section>
      )}

      <section>
        {collapse && (
          <>
            <SectionHeader title={mineCount > 1 ? 'הילדים שלי' : 'הילד שלי'} icon="user" />
            <Card padded={false}>
              <ul className="ip-roster">
                {roster!.filter((p) => p.guardians.includes(me)).map((p) => (
                  <li key={p.id} className="is-mine">
                    <span className="ip-roster-no">{p.shirt_number ?? '–'}</span>
                    <InitialsAvatar name={`${p.first_name} ${p.last_name}`} size={40} tone="lime" />
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">
                        {p.first_name} {p.last_name}
                      </span>
                      <span className="ip-list-row-sub">{[p.position, p.birth_year && `שנתון ${p.birth_year}`].filter(Boolean).join(' · ') || ' '}</span>
                    </span>
                    <Button variant="secondary" size="sm" icon="user" onClick={() => setDetails(p)}>
                      חולצה וציוד
                    </Button>
                    <Button variant="ghost" size="sm" icon="wallet" onClick={() => (window.location.hash = `costs/${p.id}`)}>
                      הוצאות
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
            <button type="button" className="ip-link" onClick={() => setShowRoster((v) => !v)} aria-expanded={showRoster}>
              {showRoster ? 'הסתרת הסגל' : `הסגל המלא · ${roster!.length} שחקנים`}
            </button>
          </>
        )}
        {(!collapse || showRoster) && (
        <>
        {!collapse && <SectionHeader title={roster ? `סגל · ${roster.length} שחקנים` : 'סגל'} icon="team" />}
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
                      <Button variant="secondary" size="sm" icon="user" onClick={() => setDetails(p)}>
                        חולצה וציוד
                      </Button>
                    ) : p.guardians.length === 0 ? (
                      <Button variant="secondary" size="sm" onClick={() => setClaim(p)}>
                        זה הילד שלי
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        </>
        )}
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
        <SectionHeader title="שליחת דף הקבוצה להורים" icon="chat" />
        <Card>
          <TeamLinkShare teamId={teamId} teamName={team.name} />
        </Card>
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

      <section className="ip-stack ip-stack--tight">
        <button type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = `matches/${teamId}`)}>
          <span className="ip-icon-tile ip-icon-tile--blue">
            <Icon name={sportProfile(team.sport).hasMatches ? 'ball' : 'check'} size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">{sportProfile(team.sport).hasMatches ? 'משחקים והרכבים' : 'נוכחות'}</span>
            <span className="ip-list-row-sub">
              {sportProfile(team.sport).hasMatches
                ? staff
                  ? 'הוספת משחקים, בניית הרכבים, נוכחות ותוצאות'
                  : 'לוח משחקים, הרכבים שפורסמו ותוצאות'
                : 'נוכחות באימונים לאורך זמן'}
            </span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
        <button type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = `fund/${teamId}`)}>
          <span className="ip-icon-tile ip-icon-tile--blue">
            <Icon name="wallet" size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">קופת הקבוצה</span>
            <span className="ip-list-row-sub">גביות, מי שילם והוצאות מהקופה</span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
        <button type="button" className="ip-card ip-card--padded ip-coach-entry" onClick={() => (window.location.hash = `coach/${teamId}`)}>
          <span className="ip-icon-tile ip-icon-tile--lime">
            <Icon name="whistle" size={20} />
          </span>
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">לוח המאמן</span>
            <span className="ip-list-row-sub">{staff ? 'פרסום הודעות, ניהול ימי אימון ודיווחי היעדרות' : 'הודעות מהמאמן, ימי אימון ודיווח איחור / אי־הגעה'}</span>
          </span>
          <Icon name="chevron" size={18} className="ip-muted" />
        </button>
      </section>

      <ChildDetailsSheet player={details} teamId={teamId} onClose={() => setDetails(null)} onSaved={load} />
      <DeclareSheet
        player={claim}
        onClose={() => setClaim(null)}
        onConfirm={async () => {
          await claimPlayer(claim!.id);
          setClaim(null);
          await load();
        }}
      />

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
  const [declared, setDeclared] = useState(false);

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
      setDeclared(false);
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
        {mode === 'child' && (
          <label className="ip-declare">
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <span>{PARENT_DECLARATION}</span>
          </label>
        )}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || !f.first.trim() || (mode === 'child' && !declared)}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/** "This is my child" on the roster: the parent confirms the declaration first. */
function DeclareSheet({ player, onClose, onConfirm }: { player: Player | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDeclared(false);
    setError(null);
  }, [player]);
  return (
    <BottomSheet open={player !== null} onClose={onClose} title="זה הילד שלי">
      <div className="ip-form ip-form--sheet">
        {player && (
          <p className="ip-muted">
            {player.first_name} {player.last_name}
            {player.birth_year ? ` · שנתון ${player.birth_year}` : ''}
          </p>
        )}
        <label className="ip-declare">
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
          <span>{PARENT_DECLARATION}</span>
        </label>
        <Err error={error} />
        <Button
          variant="primary"
          block
          disabled={!declared || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
            } catch (e) {
              setError(joinError(e) ?? friendlyError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          אישור
        </Button>
      </div>
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
