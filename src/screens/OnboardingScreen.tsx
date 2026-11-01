/**
 * First-run flow after login: your name → join a team with a code (parents)
 * or open a new team (coach / team manager) → add your child.
 * Nothing is refreshed globally until the flow finishes, so the steps stay put.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Err, Field } from '../components/form';
import { Logo } from '../components/Logo';
import { Icon } from '../components/Icon';
import { Button, Card } from '../components/ui';
import { addMyChild, claimPlayer, createTeam, friendlyError, getRoster, joinTeam, sportLabel, updateMyAccountTypes, updateMyName, type AccountType, type Player, type Sport } from '../lib/api';
import { clearPendingInvite, readPendingInvite, useAuth } from '../auth/AuthContext';
import { InviteShare } from './MyTeamScreen';
import { joinError, markOnboarded, PARENT_DECLARATION, setShirtNumber } from '../lib/joinApi';

type Step = 'name' | 'choose' | 'join' | 'create' | 'created' | 'child' | 'done';

/** skipTeamStep: the user opened a shared team page or the search, so only the name is asked. */
export function OnboardingScreen({ onDone, skipTeamStep = false }: { onDone: () => void; skipTeamStep?: boolean }) {
  const { session, profile, teams, refresh, signOut } = useAuth();
  const userId = session!.user.id;
  const pending = readPendingInvite();
  const [step, setStep] = useState<Step>(!profile?.full_name ? 'name' : teams.length ? 'child' : pending ? 'join' : 'choose');
  const [name, setName] = useState(profile?.full_name ?? '');
  const [kinds, setKinds] = useState<AccountType[]>(profile?.account_types?.length ? profile.account_types : ['parent']);
  const toggleKind = (k: AccountType) =>
    setKinds((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur, k]));
  const [code, setCode] = useState(pending ?? '');
  const [teamId, setTeamId] = useState<string | null>(teams[0]?.id ?? null);
  const [invite, setInvite] = useState<string | null>(null);
  const [team, setTeam] = useState({ name: '', club: '', season: '2026/27', sport: 'football' as Sport });
  const [child, setChild] = useState({ first: '', last: '', number: '', position: '', birthYear: '' });
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Child step: the team's roster (an imported league team already lists the
  // children), so the parent picks their child instead of adding a duplicate.
  const [roster, setRoster] = useState<Player[] | null>(null);
  const [picked, setPicked] = useState<Player | null>(null);
  useEffect(() => {
    if (step !== 'child' || !teamId) return;
    getRoster(teamId).then(setRoster).catch(() => setRoster([]));
  }, [step, teamId]);
  const mine = roster?.filter((p) => p.guardians.includes(userId)) ?? [];
  const unclaimed = roster?.filter((p) => p.guardians.length === 0) ?? [];
  const childTeam = teams.find((t) => t.id === teamId);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const finish = () => run(async () => {
    clearPendingInvite();
    markOnboarded();
    await refresh();
    onDone();
  });

  // No invite code: search the child or the club and send a request from there.
  const goSearch = () => {
    markOnboarded();
    window.location.hash = 'find';
    onDone();
  };

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await updateMyName(userId, name);
      // before the account-types migration the column is missing; the choice then simply isn't saved
      await updateMyAccountTypes(userId, kinds).catch(() => undefined);
      if (!kinds.includes('parent') && !pending) {
        // club only: no child / team step
        markOnboarded();
        await refresh();
        window.location.hash = 'club';
        onDone();
        return;
      }
      if (skipTeamStep && !teams.length && !pending) {
        await refresh();
        onDone();
        return;
      }
      setStep(teams.length ? 'child' : pending ? 'join' : 'choose');
    });
  };

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const id = await joinTeam(code);
      clearPendingInvite();
      setTeamId(id);
      setStep('child');
    });
  };

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await createTeam(team);
      setTeamId(r.teamId);
      setInvite(r.inviteCode);
      setStep('created');
    });
  };

  const submitChild = (e: FormEvent) => {
    e.preventDefault();
    if (picked) {
      setError(null);
      setBusy(true);
      (async () => {
        try {
          await claimPlayer(picked.id);
          if (child.number) await setShirtNumber(picked.id, teamId!, Number(child.number)).catch(() => undefined);
          markOnboarded();
          await refresh();
          onDone();
        } catch (err) {
          setError(joinError(err) ?? friendlyError(err));
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    run(async () => {
      await addMyChild(teamId!, {
        first: child.first,
        last: child.last,
        number: child.number ? Number(child.number) : null,
        position: child.position,
        birthYear: child.birthYear ? Number(child.birthYear) : null,
      });
      markOnboarded();
      await refresh();
      onDone();
    });
  };

  return (
    <div className="ip-onboard">
      <header className="ip-onboard-head">
        <Logo height={30} />
        <button type="button" className="ip-link" onClick={() => void signOut()}>
          יציאה
        </button>
      </header>

      {step === 'name' && (
        <form className="ip-form" onSubmit={submitName}>
          <h1>נעים להכיר!</h1>
          <p className="ip-muted">איך לקרוא לך? השם יופיע להורים ולמאמנים בקבוצה.</p>
          <Field label="שם מלא">
            <input id="ob-name" className="ip-input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: רונית לוי" required />
          </Field>
          <AccountTypePicker value={kinds} onToggle={toggleKind} />
          <Err error={error} />
          <Button type="submit" variant="primary" block disabled={busy || name.trim().length < 2}>
            המשך
          </Button>
        </form>
      )}

      {step === 'choose' && (
        <div className="ip-form">
          <h1>איך מתחילים?</h1>
          <p className="ip-muted">הצטרפו לקבוצה של הילד שלכם, או פתחו קבוצה חדשה אם אתם המאמן או מנהל הקבוצה.</p>
          <button type="button" className="ip-choice-card" onClick={() => setStep('join')}>
            <span className="ip-icon-tile ip-icon-tile--lime ip-icon-tile--lg">
              <Icon name="family" size={26} />
            </span>
            <span>
              <strong>אני הורה</strong>
              <span className="ip-muted">יש לי קוד הזמנה מהמאמן</span>
            </span>
            <Icon name="chevron" size={20} />
          </button>
          <button type="button" className="ip-choice-card" onClick={goSearch}>
            <span className="ip-icon-tile ip-icon-tile--blue ip-icon-tile--lg">
              <Icon name="eye" size={26} />
            </span>
            <span>
              <strong>אני הורה, ואין לי קוד</strong>
              <span className="ip-muted">חיפוש הילד לפי שם ושנתון, או חיפוש המועדון</span>
            </span>
            <Icon name="chevron" size={20} />
          </button>
          <button type="button" className="ip-choice-card" onClick={() => setStep('create')}>
            <span className="ip-icon-tile ip-icon-tile--navy ip-icon-tile--lg">
              <Icon name="whistle" size={26} />
            </span>
            <span>
              <strong>אני מאמן או מנהל קבוצה</strong>
              <span className="ip-muted">פתיחת קבוצה חדשה והזמנת הורים</span>
            </span>
            <Icon name="chevron" size={20} />
          </button>
        </div>
      )}

      {step === 'join' && (
        <form className="ip-form" onSubmit={submitJoin}>
          <h1>הצטרפות לקבוצה</h1>
          <p className="ip-muted">הקלידו את הקוד בן 6 התווים שקיבלתם מהמאמן, או פתחו את קישור ההזמנה.</p>
          <Field label="קוד הזמנה">
            <input
              id="ob-code"
              className="ip-input ip-input--otp"
              dir="ltr"
              autoCapitalize="characters"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ABC234"
            />
          </Field>
          <Err error={error} />
          <Button type="submit" variant="primary" block disabled={busy || code.length !== 6}>
            הצטרפות
          </Button>
          {!teams.length && (
            <button type="button" className="ip-link ip-center-self" onClick={() => setStep('choose')}>
              חזרה
            </button>
          )}
        </form>
      )}

      {step === 'create' && (
        <form className="ip-form" onSubmit={submitCreate}>
          <h1>פתיחת קבוצה</h1>
          <Field label="שם הקבוצה">
            <input id="ob-team" className="ip-input" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="לדוגמה: ילדים א׳" required />
          </Field>
          <Field label="מועדון">
            <input id="ob-club" className="ip-input" value={team.club} onChange={(e) => setTeam({ ...team, club: e.target.value })} placeholder="לדוגמה: הכוכבים כפר סבא" />
          </Field>
          <div className="ip-field-row">
            <Field label="ענף">
              <select id="ob-sport" className="ip-input" value={team.sport} onChange={(e) => setTeam({ ...team, sport: e.target.value as Sport })}>
                {(Object.keys(sportLabel) as Sport[]).map((s) => (
                  <option key={s} value={s}>
                    {sportLabel[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="עונה">
              <input id="ob-season" className="ip-input" dir="ltr" value={team.season} onChange={(e) => setTeam({ ...team, season: e.target.value })} />
            </Field>
          </div>
          <Err error={error} />
          <Button type="submit" variant="primary" block disabled={busy || !team.name.trim()}>
            פתיחת הקבוצה
          </Button>
          <button type="button" className="ip-link ip-center-self" onClick={() => setStep('choose')}>
            חזרה
          </button>
        </form>
      )}

      {step === 'created' && invite && (
        <div className="ip-form">
          <h1>הקבוצה נפתחה 🎉</h1>
          <p className="ip-muted">שלחו להורים את הקישור או את הקוד. מי שמצטרף רואה את הקבוצה ומוסיף את הילד שלו.</p>
          <InviteShare code={invite} teamName={team.name} />
          <Button variant="primary" block onClick={() => setStep('child')}>
            גם הילד שלי בקבוצה
          </Button>
          <Button variant="ghost" block onClick={finish} disabled={busy}>
            סיום, אוסיף שחקנים אחר כך
          </Button>
        </div>
      )}

      {step === 'child' && (
        <form className="ip-form" onSubmit={submitChild}>
          <h1>הוספת הילד שלך</h1>
          <p className="ip-muted">
            {childTeam ? `בקבוצה ${childTeam.name}. ` : ''}אפשר להוסיף עוד ילדים אחר כך, ולשנות את הפרטים בכל זמן.
          </p>
          {mine.length > 0 && (
            <Card>
              <p>
                <strong>כבר מקושר אליך:</strong> {mine.map((p) => `${p.first_name} ${p.last_name}`.trim()).join(', ')}
              </p>
              <Button variant="primary" block onClick={finish} disabled={busy}>
                כניסה לאפליקציה
              </Button>
            </Card>
          )}
          {unclaimed.length > 0 && (
            <Field label="הילד כבר ברשימת הקבוצה? בחרו אותו">
              <div className="ip-pick-list">
                {unclaimed.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`ip-choice-chip ${picked?.id === p.id ? 'is-on' : ''}`}
                    aria-pressed={picked?.id === p.id}
                    onClick={() => setPicked(picked?.id === p.id ? null : p)}
                  >
                    {`${p.first_name} ${p.last_name}`.trim()}
                    {p.birth_year ? ` · ${p.birth_year}` : ''}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {picked ? (
            <Field label="מספר חולצה">
              <input id="ob-child-number" className="ip-input" inputMode="numeric" dir="ltr" value={child.number} onChange={(e) => setChild({ ...child, number: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="לא חובה" />
            </Field>
          ) : (
          <>
          {unclaimed.length > 0 && <p className="ip-footnote">לא ברשימה? מלאו את הפרטים:</p>}
          <div className="ip-field-row">
            <Field label="שם פרטי">
              <input id="ob-child-first" className="ip-input" value={child.first} onChange={(e) => setChild({ ...child, first: e.target.value })} required />
            </Field>
            <Field label="שם משפחה">
              <input id="ob-child-last" className="ip-input" value={child.last} onChange={(e) => setChild({ ...child, last: e.target.value })} />
            </Field>
          </div>
          <div className="ip-field-row">
            <Field label="מספר חולצה">
              <input id="ob-child-number" className="ip-input" inputMode="numeric" dir="ltr" value={child.number} onChange={(e) => setChild({ ...child, number: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="לא חובה" />
            </Field>
            <Field label="שנת לידה">
              <input id="ob-child-year" className="ip-input" inputMode="numeric" dir="ltr" value={child.birthYear} onChange={(e) => setChild({ ...child, birthYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="לדוגמה: 2015" />
            </Field>
          </div>
          <Field label="תפקיד במגרש">
            <input id="ob-child-pos" className="ip-input" value={child.position} onChange={(e) => setChild({ ...child, position: e.target.value })} placeholder="לא חובה" />
          </Field>
          </>
          )}
          <label className="ip-declare">
            <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <span>{PARENT_DECLARATION}</span>
          </label>
          <Err error={error} />
          <Button type="submit" variant="primary" block disabled={busy || (!picked && !child.first.trim()) || !teamId || !declared}>
            {picked ? `זה הילד שלי: ${picked.first_name}` : 'שמירה וכניסה לאפליקציה'}
          </Button>
          <button type="button" className="ip-link ip-center-self" onClick={finish} disabled={busy}>
            אוסיף אחר כך
          </button>
        </form>
      )}

      {busy && <p className="ip-footnote ip-center">רגע…</p>}
      <Card className="ip-onboard-note" padded>
        <p className="ip-footnote">
          iplays שומרת רק את מה שצריך כדי לנהל את הקבוצה. בחיפוש מופיעים רק שם, שנתון, קבוצה ומועדון. כל השאר גלוי לאנשי הקבוצה בלבד.
        </p>
      </Card>
    </div>
  );
}

/** "I'm here as": parent of a player and / or club (multi-select, at least one). */
export function AccountTypePicker({ value, onToggle }: { value: AccountType[]; onToggle: (k: AccountType) => void }) {
  const opts: { id: AccountType; title: string; sub: string }[] = [
    { id: 'parent', title: 'הורה לשחקן', sub: 'הילד שלי, אימונים, משחקים והודעות' },
    { id: 'club', title: 'מועדון', sub: 'ניהול מועדון, קבוצות וצוות' },
  ];
  return (
    <fieldset className="ip-kind-picker">
      <legend>אני משתמש/ת באפליקציה בתור (אפשר לבחור את שניהם)</legend>
      {opts.map((o) => (
        <label key={o.id} className={`ip-declare ${value.includes(o.id) ? '' : 'is-off'}`}>
          <input type="checkbox" checked={value.includes(o.id)} onChange={() => onToggle(o.id)} />
          <span>
            <strong>{o.title}</strong>
            <br />
            <span className="ip-muted">{o.sub}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
