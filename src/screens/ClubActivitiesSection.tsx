/**
 * Club activities with registration: summer camps, day camps, goalkeeper
 * camps, special trainings, workshops. Staff create them, open / close
 * registration and see who signed up, the waitlist, payments and free places.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import {
  activityKindLabel,
  activityStatusLabel,
  canClubActivities,
  cancelRegistration,
  clubFinanceError,
  dmy,
  downloadCsv,
  ils,
  loadClubActivities,
  personName,
  regStatusLabel,
  saveActivity,
  type Activity,
  type ActivityInput,
  type ActivityKind,
  type ActivityStatus,
  type Person,
  type Registration,
} from '../lib/clubFinanceApi';
import { supabase } from '../lib/supabase';

const errText = (e: unknown) => clubFinanceError(e) ?? friendlyError(e);
const today = () => new Date().toISOString().slice(0, 10);

export function ClubActivitiesSection({ clubId }: { clubId: string }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [regs, setRegs] = useState<Registration[]>([]);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [paid, setPaid] = useState<Map<string, number>>(new Map());
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Activity | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, edit] = await Promise.all([loadClubActivities(clubId), canClubActivities(clubId, 3)]);
      setActs(d.activities);
      setRegs(d.registrations);
      setPeople(d.people);
      setCanEdit(edit);
      const chargeIds = d.registrations.map((r) => r.charge_id).filter((x): x is string => !!x);
      if (chargeIds.length) {
        // finance staff see payment state; others simply get nothing back
        const b = await supabase!.from('club_charge_balances').select('id, paid').in('id', chargeIds);
        setPaid(new Map((b.data ?? []).map((x) => [x.id as string, Number(x.paid)])));
      }
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!acts) return error ? <Err error={error} /> : <p className="ip-muted">טוען…</p>;

  return (
    <section className="ip-stack">
      {canEdit && (
        <div className="ip-btn-row">
          <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
            פעילות חדשה
          </Button>
        </div>
      )}
      <Err error={error} />
      {acts.length === 0 ? (
        <EmptyState icon="calendar" title="אין עדיין פעילויות" text="מחנה קיץ, קייטנה, מחנה שוערים, אימון מיוחד או סדנה: ההורים יוכלו לרשום את הילדים כאן." />
      ) : (
        <div className="ip-stack ip-stack--tight">
          {acts.map((a) => {
            const mine = regs.filter((r) => r.activity_id === a.id && r.status !== 'cancelled');
            const registered = mine.filter((r) => r.status === 'registered');
            const waitlist = mine.filter((r) => r.status === 'waitlist');
            const shown = open === a.id;
            return (
              <Card key={a.id}>
                <div className="ip-carpool-head">
                  <strong>{a.title}</strong>
                  <Tag tone={a.status === 'open' ? 'lime' : a.status === 'draft' ? 'warning' : 'neutral'}>{activityStatusLabel[a.status]}</Tag>
                </div>
                <p className="ip-muted">
                  {[activityKindLabel[a.kind], `${dmy(a.starts_on)}–${dmy(a.ends_on)}`, a.daily_hours, a.location, ageLabel(a), a.price ? ils(a.price) : 'ללא תשלום', a.visibility === 'club' ? 'רק למשפחות המועדון' : 'פתוח לכולם'].filter(Boolean).join(' · ')}
                </p>
                <p>
                  <strong>{registered.length}</strong>
                  {a.capacity ? ` מתוך ${a.capacity} רשומים · ${Math.max(0, a.capacity - registered.length)} מקומות פנויים` : ' רשומים'}
                  {waitlist.length ? ` · ${waitlist.length} בהמתנה` : ''}
                </p>
                <div className="ip-btn-row">
                  <Button variant="ghost" size="sm" icon="team" onClick={() => setOpen(shown ? null : a.id)} aria-expanded={shown}>
                    {shown ? 'הסתרת הנרשמים' : 'הנרשמים'}
                  </Button>
                  {canEdit && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>
                        עריכה
                      </Button>
                      {a.status !== 'open' && a.status !== 'cancelled' && (
                        <Button variant="primary" size="sm" onClick={() => saveActivity(clubId, me, { ...strip(a), status: 'open' }, a.id).then(load).catch((e) => setError(errText(e)))}>
                          פתיחת ההרשמה
                        </Button>
                      )}
                      {a.status === 'open' && (
                        <Button variant="ghost" size="sm" onClick={() => saveActivity(clubId, me, { ...strip(a), status: 'closed' }, a.id).then(load).catch((e) => setError(errText(e)))}>
                          סגירת ההרשמה
                        </Button>
                      )}
                    </>
                  )}
                  {mine.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="arrow"
                      onClick={() =>
                        downloadCsv(`${a.title}-נרשמים.csv`, [
                          ['שם', 'שנתון', 'הורים', 'מצב', 'שולם', 'הערה'],
                          ...mine.map((r) => {
                            const p = people.get(r.player_id);
                            return [personName(p), p?.birth_year ?? '', p?.parents ?? '', regStatusLabel[r.status], r.charge_id ? (paid.get(r.charge_id) ?? '') : '', r.note];
                          }),
                        ])
                      }
                    >
                      רשימה לאקסל
                    </Button>
                  )}
                </div>
                {shown && (
                  <ul className="ip-roster">
                    {mine.length === 0 && <li className="ip-muted">עוד אין נרשמים.</li>}
                    {mine.map((r) => {
                      const p = people.get(r.player_id);
                      const pd = r.charge_id ? paid.get(r.charge_id) : undefined;
                      return (
                        <li key={r.id}>
                          <span className="ip-list-row-text">
                            <span className="ip-list-row-title">{personName(p)}</span>
                            <span className="ip-list-row-sub">
                              {[regStatusLabel[r.status], p?.birth_year && `שנתון ${p.birth_year}`, p?.parents, a.price ? (pd != null ? (pd >= a.price ? 'שולם' : pd > 0 ? `שולם ${ils(pd)}` : 'לא שולם') : '') : '', r.note].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {canEdit && (
                            <Button variant="ghost" size="sm" onClick={() => confirm('לבטל את ההרשמה?') && cancelRegistration(r.id).then(load).catch((e) => setError(errText(e)))}>
                              ביטול
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="ip-footnote">כשמתמלאים המקומות, הנרשמים הבאים נכנסים לרשימת המתנה. ביטול הרשמה מעביר אוטומטית את הראשון בהמתנה. פעילות בתשלום יוצרת חיוב בלשונית הכספים.</p>

      <ActivitySheet
        value={editing}
        onClose={() => setEditing(null)}
        onSave={async (a) => {
          await saveActivity(clubId, me, a, editing && editing !== 'new' ? editing.id : undefined);
          setEditing(null);
          await load();
        }}
      />
    </section>
  );
}

export function ageLabel(a: Pick<Activity, 'birth_year_min' | 'birth_year_max'>) {
  if (a.birth_year_min && a.birth_year_max) return a.birth_year_min === a.birth_year_max ? `שנתון ${a.birth_year_min}` : `שנתונים ${a.birth_year_min}–${a.birth_year_max}`;
  if (a.birth_year_min) return `שנתון ${a.birth_year_min} ומטה`;
  if (a.birth_year_max) return `שנתון ${a.birth_year_max} ומעלה`;
  return '';
}

function strip(a: Activity): ActivityInput {
  const { id: _id, club_id: _c, clubs: _cl, ...rest } = a;
  void _id;
  void _c;
  void _cl;
  return rest;
}

function ActivitySheet({ value, onClose, onSave }: { value: Activity | 'new' | null; onClose: () => void; onSave: (a: ActivityInput) => Promise<void> }) {
  const blank: ActivityInput = useMemo(
    () => ({
      kind: 'summer_camp',
      title: '',
      description: '',
      starts_on: today(),
      ends_on: today(),
      daily_hours: '',
      location: '',
      birth_year_min: null,
      birth_year_max: null,
      capacity: null,
      price: 0,
      status: 'draft',
      registration_closes_on: null,
      visibility: 'public',
    }),
    [],
  );
  const [f, setF] = useState<ActivityInput>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setF(value === 'new' ? blank : strip(value));
    setError(null);
  }, [value, blank]);
  const set = <K extends keyof ActivityInput>(k: K, v: ActivityInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\D/g, '')));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return setError('צריך שם לפעילות.');
    if (f.ends_on < f.starts_on) return setError('תאריך הסיום לפני תאריך ההתחלה.');
    setBusy(true);
    try {
      await onSave({ ...f, title: f.title.trim() });
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={value !== null} onClose={onClose} title={value === 'new' ? 'פעילות חדשה' : 'עריכת פעילות'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <div className="ip-field-row">
          <Field label="סוג">
            <select className="ip-input" value={f.kind} onChange={(e) => set('kind', e.target.value as ActivityKind)}>
              {(Object.keys(activityKindLabel) as ActivityKind[]).map((k) => (
                <option key={k} value={k}>
                  {activityKindLabel[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="מצב">
            <select className="ip-input" value={f.status} onChange={(e) => set('status', e.target.value as ActivityStatus)}>
              {(Object.keys(activityStatusLabel) as ActivityStatus[]).map((k) => (
                <option key={k} value={k}>
                  {activityStatusLabel[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="שם">
          <input className="ip-input" value={f.title} onChange={(e) => set('title', e.target.value.slice(0, 80))} placeholder="לדוגמה: מחנה קיץ שבוע 1" />
        </Field>
        <Field label="תיאור">
          <textarea className="ip-input" rows={3} value={f.description} onChange={(e) => set('description', e.target.value.slice(0, 1000))} />
        </Field>
        <div className="ip-field-row">
          <Field label="מתאריך">
            <input className="ip-input" type="date" value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} />
          </Field>
          <Field label="עד תאריך">
            <input className="ip-input" type="date" value={f.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
          </Field>
        </div>
        <div className="ip-field-row">
          <Field label="שעות">
            <input className="ip-input" dir="ltr" value={f.daily_hours} onChange={(e) => set('daily_hours', e.target.value.slice(0, 40))} placeholder="08:00–13:00" />
          </Field>
          <Field label="מקום">
            <input className="ip-input" value={f.location} onChange={(e) => set('location', e.target.value.slice(0, 120))} />
          </Field>
        </div>
        <div className="ip-field-row">
          <Field label="משנתון">
            <input className="ip-input" inputMode="numeric" dir="ltr" value={f.birth_year_min ?? ''} onChange={(e) => set('birth_year_min', numOrNull(e.target.value.slice(0, 4)))} placeholder="2014" />
          </Field>
          <Field label="עד שנתון">
            <input className="ip-input" inputMode="numeric" dir="ltr" value={f.birth_year_max ?? ''} onChange={(e) => set('birth_year_max', numOrNull(e.target.value.slice(0, 4)))} placeholder="2017" />
          </Field>
        </div>
        <div className="ip-field-row">
          <Field label="מקומות">
            <input className="ip-input" inputMode="numeric" dir="ltr" value={f.capacity ?? ''} onChange={(e) => set('capacity', numOrNull(e.target.value.slice(0, 4)))} placeholder="ללא הגבלה" />
          </Field>
          <Field label="מחיר (₪)">
            <input className="ip-input" inputMode="decimal" dir="ltr" value={f.price || ''} onChange={(e) => set('price', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} placeholder="0" />
          </Field>
        </div>
        <div className="ip-field-row">
          <Field label="ההרשמה נסגרת ב־">
            <input className="ip-input" type="date" value={f.registration_closes_on ?? ''} onChange={(e) => set('registration_closes_on', e.target.value || null)} />
          </Field>
          <Field label="מי רואה">
            <select className="ip-input" value={f.visibility} onChange={(e) => set('visibility', e.target.value as 'public' | 'club')}>
              <option value="public">כל ההורים באפליקציה</option>
              <option value="club">רק משפחות המועדון</option>
            </select>
          </Field>
        </div>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
