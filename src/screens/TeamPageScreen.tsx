/**
 * #t/<teamId>: the page a shared team link opens. Shows the team card and the
 * names on its roster (the same data the open search shows). From here a
 * parent asks to join ("this is my child" / "my child is not on the list")
 * with a parent declaration, and a relative asks to follow a child (the
 * child's parent approves).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag, TeamCrest } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import {
  birthYearsLabel,
  joinError,
  markOnboarded,
  myJoinRequests,
  myTeamClaim,
  requestTeamClaim,
  PARENT_DECLARATION,
  programLabel,
  requestJoin,
  teamPublic,
  teamRosterPublic,
  type MyRequest,
  type PublicTeam,
  type Relation,
  type RosterName,
} from '../lib/joinApi';
import { TeamLinkShare } from './TeamLinkShare';
import { IfaTeamLink } from './IfaTeamLink';

export function TeamPageScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const [team, setTeam] = useState<PublicTeam | null | undefined>(undefined);
  const [roster, setRoster] = useState<RosterName[]>([]);
  const [mine, setMine] = useState<MyRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { relation: Relation; player?: RosterName }>(null);
  const [sent, setSent] = useState<string | null>(null);
  const { refresh, teams } = useAuth();
  const [claim, setClaim] = useState<'none' | 'pending' | 'sheet'>('none');

  const load = useCallback(async () => {
    try {
      const [t, r, m] = await Promise.all([teamPublic(teamId), teamRosterPublic(teamId), myJoinRequests()]);
      setTeam(t);
      setRoster(r);
      setMine(m.filter((x) => x.team_id === teamId && x.status === 'pending'));
      const c = await myTeamClaim(teamId).catch(() => null);
      setClaim(c ? 'pending' : 'none');
    } catch (e) {
      setTeam(null);
      setError(joinError(e) ?? friendlyError(e));
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (team === undefined) return <p className="ip-muted ip-pad">טוען…</p>;
  // Who approves a parent's request: nobody when the team has no staff and the
  // child has no declared parent yet (the parent joins right away).
  const approverFor = (player?: RosterName): string | null =>
    team?.has_staff ? 'מאמן הקבוצה או מנהל המועדון' : player?.has_parent ? 'ההורה שכבר רשום לילד' : null;
  if (team === null) {
    return (
      <div className="ip-stack">
        <BackBar onBack={onBack} />
        {error && <p className="ip-error" role="alert">{error}</p>}
        <EmptyState icon="team" title="הקבוצה לא נמצאה" text="ייתכן שהקישור שגוי או שהקבוצה הועברה לארכיון. אפשר לחפש את הילד או את המועדון." />
        <Button variant="primary" icon="eye" onClick={() => (window.location.hash = 'find')}>
          חיפוש ילד או מועדון
        </Button>
      </div>
    );
  }

  return (
    <div className="ip-stack">
      <BackBar onBack={onBack} />
      <Card tone="navy" className="ip-team-hero">
        <div className="ip-team-hero-id">
          <TeamCrest name={team.club_name || team.name} tone="lime" size={56} />
          <div>
            <h1>{team.name}</h1>
            {team.club_name && (
              <p>
                {team.club_name} {team.club_status === 'verified' && <Tag tone="lime" icon="check">מאומת</Tag>}
              </p>
            )}
            <p className="ip-on-navy-muted">
              {[birthYearsLabel(team.birth_year_from, team.birth_year_to), team.program_kind && programLabel[team.program_kind], team.season && `עונת ${team.season}`, `${team.players} שחקנים`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <IfaTeamLink teamId={team.team_id} />
          </div>
        </div>
      </Card>

      {!team.has_staff && !team.is_member && (
        <Card className="ip-find-sent">
          <Tag tone="warning" icon="clock">עוד אין מאמן</Tag>
          <p>אף מאמן או מועדון לא מנהלים את הקבוצה עדיין. הורה שמצהיר שהוא ההורה נכנס מיד, בלי לחכות לאישור.</p>
        </Card>
      )}
      {error && <p className="ip-error" role="alert">{error}</p>}
      {sent && (
        <Card className="ip-find-sent">
          <Tag tone="lime" icon="check">{sent.startsWith('נכנסת') ? 'נוספת לקבוצה' : 'נשלח'}</Tag>
          <p>{sent}</p>
        </Card>
      )}

      {team.is_member ? (
        <Card>
          <p className="ip-muted">את/ה כבר בקבוצה הזו. בדף הקבוצה רואים את הילד שמקושר אליך (מסומן בירוק), ואפשר לסמן "זה הילד שלי" או להוסיף ילד נוסף.</p>
          <div className="ip-btn-row">
            <Button variant="primary" icon="team" onClick={() => (window.location.hash = `myteam/${team.team_id}`)}>
              לדף הקבוצה: הילדים שלי
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {mine.length > 0 && (
            <section>
              <SectionHeader title="הבקשות שלך לקבוצה" icon="clock" />
              <Card padded={false}>
                {mine.map((r) => (
                  <div key={r.id} className="ip-member">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{r.child_name}</span>
                      <span className="ip-list-row-sub">
                        {r.relation === 'parent' ? `בקשת הורה · ממתינה לאישור ${team.has_staff ? 'מאמן הקבוצה או מנהל המועדון' : 'ההורה שכבר רשום לילד'}` : 'בקשת מעקב · ממתינה לאישור ההורה'}
                      </span>
                    </span>
                    <Tag tone="warning">ממתין</Tag>
                  </div>
                ))}
              </Card>
            </section>
          )}
          <section>
            <SectionHeader title="הילד שלי בקבוצה" icon="user" />
            <Card padded={false}>
              {roster.length === 0 ? (
                <p className="ip-muted ip-pad">עוד אין שחקנים ברשימה.</p>
              ) : (
                <ul className="ip-roster">
                  {roster.map((p) => (
                    <li key={p.player_id} className={p.linked ? 'is-mine' : ''}>
                      <InitialsAvatar name={`${p.first_name} ${p.last_name}`} size={40} tone={p.linked ? 'lime' : 'blue'} />
                      <span className="ip-list-row-text">
                        <span className="ip-list-row-title">
                          {p.first_name} {p.last_name}
                        </span>
                        <span className="ip-list-row-sub">{p.birth_year ? `שנתון ${p.birth_year}` : ' '}</span>
                      </span>
                      {p.linked ? (
                        <Tag tone="lime">מקושר אליך</Tag>
                      ) : (
                        <span className="ip-find-actions">
                          <Button variant="secondary" size="sm" onClick={() => setSheet({ relation: 'parent', player: p })}>
                            זה הילד שלי
                          </Button>
                          {p.has_parent && (
                            <Button variant="ghost" size="sm" onClick={() => setSheet({ relation: 'family', player: p })}>
                              לעקוב
                            </Button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <div className="ip-btn-row">
              <Button variant="primary" icon="plus" onClick={() => setSheet({ relation: 'parent' })}>
                הילד שלי לא ברשימה
              </Button>
            </div>
            <p className="ip-footnote">
              {team.has_staff
                ? 'הורה מצהיר שהוא ההורה, ומאמן הקבוצה (או מנהל המועדון) מאשר. '
                : 'לקבוצה אין עדיין מאמן: הורה שמצהיר שהוא ההורה מתווסף מיד, בלי בקשה ובלי אישור. אם לילד כבר רשום הורה, ההורה הרשום מאשר. '}
              בני משפחה אחרים (סבא, סבתא, דודים) מבקשים לעקוב, וההורה הרשום מאשר.
            </p>
          </section>
        </>
      )}

      {!teams.some((t) => t.id === team.team_id && (t.role === 'admin' || t.role === 'coach')) && (
        <Card className="ip-find-open">
          {claim === 'pending' ? (
            <p>
              <Tag tone="warning" icon="clock">ממתין</Tag> ביקשת לנהל את הקבוצה כמאמן. מנהל המועדון או מנהל המערכת יאשרו.
            </p>
          ) : (
            <>
              <p>
                <strong>את/ה המאמן של הקבוצה?</strong> בקשו לנהל אותה. אחרי אישור של המועדון (או של מנהל המערכת, אם אין מועדון) תקבלו את ניהול הקבוצה, וההורים שכבר הצטרפו יישארו.
              </p>
              <Button variant="secondary" icon="whistle" onClick={() => setClaim('sheet')}>
                אני המאמן של הקבוצה
              </Button>
            </>
          )}
        </Card>
      )}

      <section>
        <SectionHeader title="שליחת הקבוצה להורים אחרים" icon="chat" />
        <Card>
          <TeamLinkShare teamId={team.team_id} teamName={team.name} />
        </Card>
      </section>

      <ClaimSheet
        open={claim === 'sheet'}
        teamName={team.name}
        onClose={() => setClaim('none')}
        onSend={async (message) => {
          await requestTeamClaim(team.team_id, message);
          setClaim('pending');
        }}
      />

      <RequestSheet
        open={sheet !== null}
        relation={sheet?.relation ?? 'parent'}
        player={sheet?.player}
        approver={approverFor(sheet?.player)}
        teamName={team.name}
        onClose={() => setSheet(null)}
        onSend={async (input) => {
          await requestJoin({ teamId: team.team_id, playerId: sheet?.player?.player_id, relation: sheet!.relation, ...input });
          markOnboarded();
          const now = await teamPublic(team.team_id);
          if (now?.is_member && !team.is_member) await refresh();
          setSent(
            now?.is_member && !team.is_member
              ? 'נכנסת לקבוצה. אפשר כבר למלא מספר חולצה וציוד ולשלוח את הקישור להורים נוספים.'
              : sheet?.relation === 'family'
              ? 'בקשת המעקב נשלחה להורה של הילד. אחרי האישור הקבוצה תופיע אצלך.'
              : `הבקשה נשלחה ל${approverFor(sheet?.player) ?? 'צוות הקבוצה'}. אחרי האישור הקבוצה תופיע אצלך, ואפשר יהיה למלא מספר חולצה וציוד.`,
          );
          setSheet(null);
          await load();
        }}
      />
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="ip-backbar">
      <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
        <Icon name="back" size={20} />
      </button>
      <h1>דף הקבוצה</h1>
      <span />
    </div>
  );
}

export function RequestSheet({
  open,
  relation,
  player,
  approver,
  teamName,
  onClose,
  onSend,
}: {
  open: boolean;
  relation: Relation;
  player?: { first_name: string; last_name: string };
  /** Who approves a parent request; null = the parent is added right away. */
  approver?: string | null;
  teamName: string;
  onClose: () => void;
  onSend: (input: { first?: string; last?: string; birthYear?: number | null; message: string; declareParent: boolean }) => Promise<void>;
}) {
  const [f, setF] = useState({ first: '', last: '', year: '', message: '' });
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !player;
  const autoJoin = relation === 'parent' && !approver;

  useEffect(() => {
    if (open) {
      setDeclared(false);
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSend({
        first: isNew ? f.first : undefined,
        last: isNew ? f.last : undefined,
        birthYear: isNew && f.year ? Number(f.year) : null,
        message: f.message,
        declareParent: relation === 'parent' && declared,
      });
      setF({ first: '', last: '', year: '', message: '' });
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const title = relation === 'family' ? 'בקשה לעקוב אחרי הילד' : isNew ? 'הוספת הילד שלי לקבוצה' : 'זה הילד שלי';
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {player && (
          <p className="ip-muted">
            {player.first_name} {player.last_name} · {teamName}
          </p>
        )}
        {isNew && (
          <>
            <div className="ip-field-row">
              <Field label="שם פרטי">
                <input id="rq-first" className="ip-input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} required />
              </Field>
              <Field label="שם משפחה">
                <input id="rq-last" className="ip-input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />
              </Field>
            </div>
            <Field label="שנת לידה">
              <input id="rq-year" className="ip-input" inputMode="numeric" dir="ltr" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="לדוגמה: 2016" />
            </Field>
          </>
        )}
        {!autoJoin && (
          <Field label={relation === 'family' ? 'מי את/ה לילד? (יוצג להורה)' : `הודעה ל${approver} (לא חובה)`}>
            <input id="rq-msg" className="ip-input" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value.slice(0, 300) })} placeholder={relation === 'family' ? 'לדוגמה: סבתא של נועם' : ''} required={relation === 'family'} />
          </Field>
        )}
        {relation === 'parent' && (
          <label className="ip-declare">
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <span>{PARENT_DECLARATION}</span>
          </label>
        )}
        {relation === 'parent' && (
          <p className="ip-footnote">
            {autoJoin
              ? 'לקבוצה אין עדיין מאמן, ולכן אחרי ההצהרה תתווספו לקבוצה מיד, בלי לחכות לאישור.'
              : `הבקשה תגיע ל${approver}. אחרי האישור הקבוצה תופיע אצלך.`}
          </p>
        )}
        {relation === 'family' && <p className="ip-footnote">ההורה הרשום של הילד יקבל את הבקשה ויאשר אותה. עוקבים רואים את הילד ואת לוח הקבוצה, בלי לערוך ובלי לדווח היעדרות.</p>}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy || (relation === 'parent' && !declared) || (isNew && !f.first.trim())}>
          {busy ? (autoJoin ? 'מצטרפים…' : 'שולחים…') : autoJoin ? 'הצטרפות לקבוצה' : 'שליחת בקשה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function ClaimSheet({ open, teamName, onClose, onSend }: { open: boolean; teamName: string; onClose: () => void; onSend: (message: string) => Promise<void> }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSend(message);
      setMessage('');
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="בקשה לנהל את הקבוצה">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <p className="ip-muted">{teamName}</p>
        <Field label="פרטים למאשר (תפקיד, טלפון במועדון)">
          <input id="claim-msg" className="ip-input" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 300))} placeholder="לדוגמה: מאמן ראשי, עונה שנייה בקבוצה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שולחים…' : 'שליחת בקשה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
