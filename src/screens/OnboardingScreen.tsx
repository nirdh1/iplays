/**
 * First-run flow after login: your name → join a team with a code (parents)
 * or open a new team (coach / team manager) → add your child.
 * Nothing is refreshed globally until the flow finishes, so the steps stay put.
 */
import { useState, type FormEvent } from 'react';
import { Err, Field } from '../components/form';
import { Logo } from '../components/Logo';
import { Icon } from '../components/Icon';
import { Button, Card } from '../components/ui';
import { addMyChild, createTeam, friendlyError, joinTeam, sportLabel, updateMyName, type Sport } from '../lib/api';
import { clearPendingInvite, readPendingInvite, useAuth } from '../auth/AuthContext';
import { InviteShare } from './MyTeamScreen';

type Step = 'name' | 'choose' | 'join' | 'create' | 'created' | 'child' | 'done';

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const { session, profile, teams, refresh, signOut } = useAuth();
  const userId = session!.user.id;
  const pending = readPendingInvite();
  const [step, setStep] = useState<Step>(!profile?.full_name ? 'name' : teams.length ? 'child' : pending ? 'join' : 'choose');
  const [name, setName] = useState(profile?.full_name ?? '');
  const [code, setCode] = useState(pending ?? '');
  const [teamId, setTeamId] = useState<string | null>(teams[0]?.id ?? null);
  const [invite, setInvite] = useState<string | null>(null);
  const [team, setTeam] = useState({ name: '', club: '', season: '2026/27', sport: 'football' as Sport });
  const [child, setChild] = useState({ first: '', last: '', number: '', position: '', birthYear: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    await refresh();
    onDone();
  });

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await updateMyName(userId, name);
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
    run(async () => {
      await addMyChild(teamId!, {
        first: child.first,
        last: child.last,
        number: child.number ? Number(child.number) : null,
        position: child.position,
        birthYear: child.birthYear ? Number(child.birthYear) : null,
      });
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
          <p className="ip-muted">הפרטים גלויים רק לאנשי הקבוצה. אפשר לשנות אותם בכל זמן.</p>
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
          <Err error={error} />
          <Button type="submit" variant="primary" block disabled={busy || !child.first.trim() || !teamId}>
            שמירה וכניסה לאפליקציה
          </Button>
          <button type="button" className="ip-link ip-center-self" onClick={finish} disabled={busy}>
            אוסיף אחר כך
          </button>
        </form>
      )}

      {busy && <p className="ip-footnote ip-center">רגע…</p>}
      <Card className="ip-onboard-note" padded>
        <p className="ip-footnote">
          iplays שומרת רק את מה שצריך כדי לנהל את הקבוצה. פרטי הילדים גלויים לאנשי הקבוצה בלבד.
        </p>
      </Card>
    </div>
  );
}
