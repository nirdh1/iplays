/**
 * #t/<teamId>: the page a shared team link opens. Shows the team card and the
 * names on its roster (the same data the open search shows). From here a
 * parent asks to join ("this is my child" / "my child is not on the list")
 * with a parent declaration, and a relative asks to follow a child (the
 * child's parent approves). A player finds themselves on the roster and says
 * "this is me", or brings their own profile from another team.
 * A Super Admin also gets a "פרטים" button per child: the player's full card.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { InitialsAvatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Tag, TeamCrest } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import { useIsPlatformAdmin } from '../lib/ifaApi';
import {
  birthYearsLabel,
  joinError,
  markOnboarded,
  myChildren,
  myJoinRequests,
  mySelfClaims,
  myTeamClaim,
  requestPlayerSelf,
  selfApproverLabel,
  requestTeamClaim,
  PARENT_DECLARATION,
  programLabel,
  requestJoin,
  requestJoinWithChild,
  teamPublic,
  teamRosterPublic,
  type MyChild,
  type MyRequest,
  type PublicTeam,
  type Relation,
  type RosterName,
  type SelfApprover,
} from '../lib/joinApi';
import { TeamLinkShare } from './TeamLinkShare';
import { IfaTeamLink } from './IfaTeamLink';

export function TeamPageScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const [team, setTeam] = useState<PublicTeam | null | undefined>(undefined);
  const [roster, setRoster] = useState<RosterName[]>([]);
  const [mine, setMine] = useState<MyRequest[]>([]);
  const [kids, setKids] = useState<MyChild[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { relation: Relation; player?: RosterName }>(null);
  const [sent, setSent] = useState<string | null>(null);
  const { refresh, teams, profile } = useAuth();
  const [claim, setClaim] = useState<'none' | 'pending' | 'sheet'>('none');
  const isAdmin = useIsPlatformAdmin();
  // the player themselves: "this is me" on a roster name, or moving with their own profile
  const kinds = profile?.account_types ?? [];
  const isPlayer = kinds.includes('player');
  const playerOnly = isPlayer && !kinds.includes('parent');
  const [myself, setMyself] = useState<MyChild | null>(null);
  const [hasSelf, setHasSelf] = useState(false);
  const [selfPending, setSelfPending] = useState<string[]>([]);
  const [selfSheet, setSelfSheet] = useState<RosterName | null>(null);
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, r, m] = await Promise.all([teamPublic(teamId), teamRosterPublic(teamId), myJoinRequests()]);
      setTeam(t);
      setRoster(r);
      setMine(m.filter((x) => x.team_id === teamId && x.status === 'pending'));
      const all = await myChildren().catch(() => []);
      setKids(all.filter((k) => !k.is_self && !k.team_ids.includes(teamId)));
      const me = all.find((k) => k.is_self);
      setHasSelf(!!me);
      setMyself(me && !me.team_ids.includes(teamId) ? me : null);
      setSelfPending((await mySelfClaims().catch(() => [])).filter((c) => c.status === 'pending').map((c) => c.player_id));
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
  // Who approves "this is me" (the server decides; this is the same rule for the text):
  // under 18 the child's parent, else the team's staff, else the platform admin.
  const selfApprover = (p: RosterName): SelfApprover => {
    const minor = !p.birth_year || new Date().getFullYear() - p.birth_year < 18;
    return minor && p.has_parent ? 'parent' : team?.has_staff ? 'staff' : 'admin';
  };
  const moveWithProfile = async () => {
    if (!team || !myself) return;
    setMoving(true);
    setError(null);
    try {
      await requestJoinWithChild(team.team_id, myself.player_id, '');
      const now = await teamPublic(team.team_id);
      if (now?.is_member && !team.is_member) await refresh();
      setSent(
        now?.is_member && !team.is_member
          ? 'נכנסת לקבוצה עם הפרופיל שלך. הקריירה וההיסטוריה עברו איתך.'
          : 'הבקשה נשלחה למאמן הקבוצה או למנהל המועדון. אחרי האישור תופיע/י ברשימה עם הפרופיל שלך.',
      );
      await load();
    } catch (e) {
      setError(joinError(e) ?? friendlyError(e));
    } finally {
      setMoving(false);
    }
  };
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

      {myself && (
        <Card className="ip-find-open">
          <p>
            <strong>עוברים לקבוצה הזו?</strong> מצטרפים עם הפרופיל שלך ({myself.team_names.length ? `כרגע ב${myself.team_names.join(', ')}` : 'לא בקבוצה כרגע'}). הקריירה, ההיסטוריה והציוד עוברים איתך. מהקבוצה הקודמת אפשר לסמן עזיבה בדף הקריירה.
          </p>
          <Button variant="primary" icon="user" disabled={moving} onClick={() => void moveWithProfile()}>
            {moving ? 'שולחים…' : 'להצטרף עם הפרופיל שלי'}
          </Button>
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
            <SectionHeader title={playerOnly ? 'אני ברשימת הקבוצה' : 'הילד שלי בקבוצה'} icon="user" />
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
                      {isAdmin && (
                        <Button variant="ghost" size="sm" onClick={() => (window.location.hash = `career/${p.player_id}`)}>
                          פרטים
                        </Button>
                      )}
                      {p.linked ? (
                        <Tag tone="lime">מקושר אליך</Tag>
                      ) : selfPending.includes(p.player_id) ? (
                        <Tag tone="warning">ממתין לאישור</Tag>
                      ) : (
                        <span className="ip-find-actions">
                          {isPlayer && !hasSelf && (
                            <Button variant={playerOnly ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelfSheet(p)}>
                              זה אני
                            </Button>
                          )}
                          {!playerOnly && (
                            <Button variant="secondary" size="sm" onClick={() => setSheet({ relation: 'parent', player: p })}>
                              זה הילד שלי
                            </Button>
                          )}
                          {p.has_parent && !playerOnly && (
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
            {playerOnly ? (
              <p className="ip-footnote">
                לא מוצא/ת את עצמך? אולי את/ה בקבוצה אחרת: חפשו לפי שם ושנתון. אם את/ה לא רשום/ה באף קבוצה, ההורה או המאמן מוסיפים אותך לרשימה, ואז לוחצים "זה אני".
              </p>
            ) : (
            <div className="ip-btn-row">
              <Button variant="primary" icon="plus" onClick={() => setSheet({ relation: 'parent' })}>
                הילד שלי לא ברשימה
              </Button>
            </div>
            )}
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

      <SelfClaimSheet
        player={selfSheet}
        teamName={team.name}
        approver={selfSheet ? selfApprover(selfSheet) : 'staff'}
        onClose={() => setSelfSheet(null)}
        onSend={async (message) => {
          await requestPlayerSelf(selfSheet!.player_id, message);
          markOnboarded();
          await refresh();
          setSent(`הבקשה נשלחה ל${selfApproverLabel[selfApprover(selfSheet!)]}. אחרי האישור הפרופיל שלך יופיע אצלך, עם הקבוצה, הלוח והקריירה.`);
          setSelfSheet(null);
          await load();
        }}
      />

      <RequestSheet
        open={sheet !== null}
        relation={sheet?.relation ?? 'parent'}
        player={sheet?.player}
        myKids={kids}
        approver={approverFor(sheet?.player)}
        teamName={team.name}
        onClose={() => setSheet(null)}
        onSend={async (input) => {
          if (input.existingPlayerId) await requestJoinWithChild(team.team_id, input.existingPlayerId, input.message);
          else await requestJoin({ teamId: team.team_id, playerId: sheet?.player?.player_id, relation: sheet!.relation, ...input });
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
  myKids = [],
  approver,
  teamName,
  onClose,
  onSend,
}: {
  open: boolean;
  relation: Relation;
  player?: { first_name: string; last_name: string };
  /** The parent's children who are not in this team: one of them can join with their existing profile. */
  myKids?: MyChild[];
  /** Who approves a parent request; null = the parent is added right away. */
  approver?: string | null;
  teamName: string;
  onClose: () => void;
  onSend: (input: { first?: string; last?: string; birthYear?: number | null; message: string; declareParent: boolean; existingPlayerId?: string }) => Promise<void>;
}) {
  const [f, setF] = useState({ first: '', last: '', year: '', message: '' });
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // '' = a new child; otherwise the id of one of the parent's existing children
  const [existing, setExisting] = useState('');
  const canBring = relation === 'parent' && !player && myKids.length > 0;
  const bringing = canBring && existing !== '';
  const isNew = !player && !bringing;
  const autoJoin = relation === 'parent' && !approver;

  useEffect(() => {
    if (open) {
      setDeclared(false);
      setError(null);
      setExisting(canBring ? myKids[0].player_id : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        existingPlayerId: bringing ? existing : undefined,
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
        {canBring && (
          <Field label="איזה ילד/ה?">
            <select id="rq-child" className="ip-input" value={existing} onChange={(e) => setExisting(e.target.value)}>
              {myKids.map((k) => (
                <option key={k.player_id} value={k.player_id}>
                  {`${k.first_name} ${k.last_name}`.trim()}
                  {k.team_names.length ? ` (כרגע ב${k.team_names.join(', ')})` : ' (לא בקבוצה כרגע)'}
                </option>
              ))}
              <option value="">ילד/ה אחר/ת, שעוד לא רשום/ה אצלי</option>
            </select>
          </Field>
        )}
        {bringing && <p className="ip-footnote">הילד/ה מצטרף/ת עם הפרופיל הקיים: הקריירה, ההיסטוריה ופרטי הציוד עוברים איתו/ה. אם הוא/היא עדיין בקבוצה אחרת, שם זה לא משתנה.</p>}
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
        {relation === 'parent' && !bringing && (
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
        <Button type="submit" variant="primary" block disabled={busy || (relation === 'parent' && !declared && !bringing) || (isNew && !f.first.trim())}>
          {busy ? (autoJoin ? 'מצטרפים…' : 'שולחים…') : autoJoin ? 'הצטרפות לקבוצה' : 'שליחת בקשה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

/** A player: "this is me". Approved by the parent (under 18), else the team's staff. */
function SelfClaimSheet({
  player,
  teamName,
  approver,
  onClose,
  onSend,
}: {
  player: RosterName | null;
  teamName: string;
  approver: SelfApprover;
  onClose: () => void;
  onSend: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (player) {
      setMessage('');
      setError(null);
    }
  }, [player]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSend(message);
    } catch (err) {
      setError(joinError(err) ?? friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={player !== null} onClose={onClose} title="זה אני">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {player && (
          <p className="ip-muted">
            {player.first_name} {player.last_name}
            {player.birth_year ? ` · שנתון ${player.birth_year}` : ''} · {teamName}
          </p>
        )}
        <p>
          אחרי האישור את/ה בעל/ת הפרופיל: רואה את הקבוצה, הלוח וההודעות, מדווח/ת היעדרות ומעדכן/ת את הקריירה (עמדות, גולים ובישולים). אפשר גם לעזוב קבוצה ולעבור לקבוצה אחרת עם כל ההיסטוריה.
        </p>
        <Field label={`הודעה ל${selfApproverLabel[approver]} (לא חובה)`}>
          <input id="self-msg" className="ip-input" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 300))} placeholder="לדוגמה: אמא, זה אני, תאשרי" />
        </Field>
        <p className="ip-footnote">
          הבקשה תגיע ל{selfApproverLabel[approver]}. ההורים נשארים מחוברים כמו קודם, ומדדי גוף, תשלומים וניהול המשפחה נשארים אצלם.
        </p>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שולחים…' : 'שליחת בקשה'}
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
