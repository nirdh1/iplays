/**
 * Parent side of club finances and activities: what I owe each club per
 * child (with "I paid"), payment history, and camps / clinics to sign up for.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Segmented, StatTile, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  activityKindLabel,
  cancelRegistration,
  chargeStateLabel,
  clubFinanceError,
  clubMethodLabel,
  dmy,
  ils,
  loadMyPayments,
  loadOpenActivities,
  myRegistrations,
  regStatusLabel,
  register,
  reportPayment,
  type Activity,
  type Charge,
  type ClubPayMethod,
  type ClubPayment,
  type Counts,
  type Registration,
} from '../lib/clubFinanceApi';
import { useMyKids } from './RealScreens';
import { ageLabel } from './ClubActivitiesSection';

const errText = (e: unknown) => clubFinanceError(e) ?? friendlyError(e);
type Kid = { id: string; first_name: string; last_name: string; birth_year: number | null };

export function PayScreen({ onBack }: { onBack: () => void }) {
  const kidsWithTeams = useMyKids();
  const kids = useMemo<Kid[]>(() => {
    const m = new Map<string, Kid>();
    for (const k of kidsWithTeams ?? []) m.set(k.id, k);
    return [...m.values()];
  }, [kidsWithTeams]);
  const [tab, setTab] = useState<'pay' | 'activities'>(() => (location.hash.includes('activities') ? 'activities' : 'pay'));
  const [charges, setCharges] = useState<(Charge & { club_name: string })[] | null>(null);
  const [payments, setPayments] = useState<ClubPayment[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [counts, setCounts] = useState<Map<string, Counts>>(new Map());
  const [regs, setRegs] = useState<Registration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [paying, setPaying] = useState<Charge | null>(null);
  const [signup, setSignup] = useState<Activity | null>(null);
  const key = kids.map((k) => k.id).join(',');

  const load = useCallback(async () => {
    if (!kidsWithTeams) return;
    try {
      const ids = key ? key.split(',') : [];
      const [p, a, r] = await Promise.all([loadMyPayments(ids), loadOpenActivities(), myRegistrations(ids)]);
      setCharges(p.charges);
      setPayments(p.payments);
      setActs(a.activities);
      setCounts(a.counts);
      setRegs(r);
      setError(null);
    } catch (e) {
      setError(errText(e));
      setCharges([]);
    }
  }, [key, kidsWithTeams]);

  useEffect(() => {
    void load();
  }, [load]);

  const kidName = (id: string) => kids.find((k) => k.id === id)?.first_name ?? '';
  const open = (charges ?? []).filter((c) => c.balance > 0 && c.status === 'open');
  const owed = open.reduce((s, c) => s + c.balance, 0);
  const overdue = open.filter((c) => c.due_on < new Date().toISOString().slice(0, 10));
  const done = (charges ?? []).filter((c) => !(c.balance > 0 && c.status === 'open'));

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>תשלומים ומחנות</h1>
        <span />
      </div>

      <Segmented
        label="תצוגה"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'pay', label: owed ? `תשלומים · ${ils(owed)}` : 'תשלומים' },
          { id: 'activities', label: 'מחנות וקייטנות' },
        ]}
      />
      <Err error={error} />
      {note && <p className="ip-muted" role="status">{note}</p>}
      {charges === null && !error && <p className="ip-muted">טוען…</p>}

      {charges && tab === 'pay' && (
        <>
          <div className="ip-stats ip-stats--compact">
            <StatTile value={owed ? ils(owed) : '✓'} label={owed ? 'פתוח לתשלום' : 'אין חוב פתוח'} accent={owed > 0} />
            <StatTile value={String(overdue.length)} label="באיחור" accent={overdue.length > 0} />
          </div>
          <section>
            <SectionHeader title="לתשלום" icon="wallet" />
            {open.length === 0 ? (
              <EmptyState icon="check" title="אין חיובים פתוחים" text="כשהמועדון יחייב דמי חבר או פעילות, החיוב יופיע כאן." />
            ) : (
              <Card padded={false}>
                {open.map((c) => (
                  <div key={c.id} className="ip-member">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">
                        {c.title} · {ils(c.balance)}
                      </span>
                      <span className="ip-list-row-sub">
                        {[kidName(c.player_id), c.club_name, `עד ${dmy(c.due_on)}`, chargeStateLabel[c.state], c.reported > 0 && `דיווחת ${ils(c.reported)}, ממתין לאישור`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {c.reported < c.balance && (
                      <Button variant="primary" size="sm" icon="check" onClick={() => setPaying(c)}>
                        שילמתי
                      </Button>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </section>
          {(done.length > 0 || payments.length > 0) && (
            <section>
              <SectionHeader title="היסטוריה" icon="clock" />
              <Card padded={false}>
                {payments.map((p) => (
                  <div key={p.id} className="ip-member">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{(charges ?? []).find((c) => c.id === p.charge_id)?.title ?? 'תשלום'}</span>
                      <span className="ip-list-row-sub">{[kidName(p.player_id), clubMethodLabel[p.method], dmy(p.paid_on), p.status === 'confirmed' ? 'אושר' : p.status === 'reported' ? 'ממתין לאישור' : p.status === 'rejected' ? 'לא נמצא אצל המועדון' : 'הוחזר'].join(' · ')}</span>
                    </span>
                    <strong>{ils(p.amount)}</strong>
                  </div>
                ))}
                {done
                  .filter((c) => c.state === 'waived')
                  .map((c) => (
                    <div key={c.id} className="ip-member">
                      <span className="ip-list-row-text">
                        <span className="ip-list-row-title">{c.title}</span>
                        <span className="ip-list-row-sub">{[kidName(c.player_id), c.club_name, 'פטור'].join(' · ')}</span>
                      </span>
                    </div>
                  ))}
              </Card>
            </section>
          )}
          <p className="ip-footnote">התשלום עצמו נעשה ישירות למועדון (העברה, ביט, מזומן וכו׳). iplays לא שומרת פרטי אשראי.</p>
        </>
      )}

      {charges && tab === 'activities' && (
        <>
          {acts.length === 0 ? (
            <EmptyState icon="calendar" title="אין כרגע פעילויות פתוחות" text="מחנות, קייטנות ואימונים מיוחדים שמועדונים יפרסמו יופיעו כאן." />
          ) : (
            <div className="ip-stack ip-stack--tight">
              {acts.map((a) => {
                const cnt = counts.get(a.id);
                const left = a.capacity != null ? Math.max(0, a.capacity - (cnt?.registered ?? 0)) : null;
                const mine = regs.filter((r) => r.activity_id === a.id);
                const closed = a.status !== 'open' || (a.registration_closes_on != null && a.registration_closes_on < new Date().toISOString().slice(0, 10));
                return (
                  <Card key={a.id}>
                    <div className="ip-carpool-head">
                      <strong>{a.title}</strong>
                      {closed ? <Tag tone="neutral">ההרשמה סגורה</Tag> : left === 0 ? <Tag tone="warning">מלא · רשימת המתנה</Tag> : left != null ? <Tag tone="lime">{left} מקומות</Tag> : <Tag tone="lime">פתוח</Tag>}
                    </div>
                    <p className="ip-muted">
                      {[activityKindLabel[a.kind], cnt?.club_name, `${dmy(a.starts_on)}–${dmy(a.ends_on)}`, a.daily_hours, a.location, ageLabel(a), a.price ? ils(a.price) : 'ללא תשלום', a.registration_closes_on && `הרשמה עד ${dmy(a.registration_closes_on)}`].filter(Boolean).join(' · ')}
                    </p>
                    {a.description && <p>{a.description}</p>}
                    {mine.map((r) => (
                      <div key={r.id} className="ip-carpool-head">
                        <span>
                          {kidName(r.player_id)}: {regStatusLabel[r.status]}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => confirm('לבטל את ההרשמה?') && cancelRegistration(r.id).then(load).catch((e) => setError(errText(e)))}>
                          ביטול הרשמה
                        </Button>
                      </div>
                    ))}
                    {!closed && kids.some((k) => !mine.some((r) => r.player_id === k.id)) && (
                      <div className="ip-btn-row">
                        <Button variant="primary" size="sm" icon="plus" onClick={() => setSignup(a)}>
                          הרשמה
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <ReportSheet
        charge={paying}
        onClose={() => setPaying(null)}
        onSave={async (m, n) => {
          await reportPayment(paying!.id, m, n);
          setPaying(null);
          setNote('הדיווח נשלח. המועדון יאשר כשיראה את התשלום.');
          await load();
        }}
      />
      <SignupSheet
        activity={signup}
        kids={kids.filter((k) => signup && !regs.some((r) => r.activity_id === signup.id && r.player_id === k.id))}
        onClose={() => setSignup(null)}
        onSave={async (kid, n) => {
          const st = await register(signup!.id, kid, n);
          setSignup(null);
          setNote(st === 'waitlist' ? 'הפעילות מלאה, נכנסתם לרשימת ההמתנה. נעדכן אם יתפנה מקום.' : signup!.price ? 'נרשמתם! החיוב מופיע בלשונית התשלומים.' : 'נרשמתם!');
          await load();
        }}
      />
    </div>
  );
}

function ReportSheet({ charge, onClose, onSave }: { charge: Charge | null; onClose: () => void; onSave: (m: ClubPayMethod, note: string) => Promise<void> }) {
  const [method, setMethod] = useState<ClubPayMethod>('transfer');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNote('');
    setError(null);
  }, [charge]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(method, note.trim());
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={charge !== null} onClose={onClose} title={charge ? `שילמתי: ${charge.title}` : 'שילמתי'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {charge && <p>{ils(charge.balance)}. המועדון יאשר כשיראה את התשלום.</p>}
        <Field label="איך שילמת">
          <select className="ip-input" value={method} onChange={(e) => setMethod(e.target.value as ClubPayMethod)}>
            {(['transfer', 'bit', 'paybox', 'cash', 'check', 'card_external', 'other'] as ClubPayMethod[]).map((m) => (
              <option key={m} value={m}>
                {clubMethodLabel[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="הערה">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לא חובה, למשל אסמכתא" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שולחים…' : 'דיווח על תשלום'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function SignupSheet({ activity, kids, onClose, onSave }: { activity: Activity | null; kids: Kid[]; onClose: () => void; onSave: (kid: string, note: string) => Promise<void> }) {
  const [kid, setKid] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setKid(kids[0]?.id ?? '');
    setNote('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!kid) return setError('בחרו ילד.');
    setBusy(true);
    try {
      await onSave(kid, note.trim());
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={activity !== null} onClose={onClose} title={activity ? `הרשמה: ${activity.title}` : 'הרשמה'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="מי נרשם">
          <select className="ip-input" value={kid} onChange={(e) => setKid(e.target.value)}>
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {`${k.first_name} ${k.last_name}`.trim()}
                {k.birth_year ? ` · ${k.birth_year}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="הערה למועדון">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לא חובה, למשל אלרגיות או הסעה" />
        </Field>
        {activity?.price ? <p className="ip-muted">מחיר: {ils(activity.price)}. החיוב יופיע בלשונית התשלומים.</p> : null}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'נרשמים…' : 'הרשמה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
