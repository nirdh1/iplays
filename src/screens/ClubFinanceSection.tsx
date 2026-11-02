/**
 * Club treasurer: fee plans (membership, monthly / periodic, one-time),
 * charges per child, payments (recorded or reported by parents), reminders
 * and reports (by team, debtors, CSV).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Card, EmptyState, SectionHeader, Segmented, StatTile, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import type { ClubData } from '../lib/clubApi';
import {
  addCharge,
  archivePlan,
  assignPlan,
  canClubFinance,
  chargeStateLabel,
  clubFinanceError,
  clubMethodLabel,
  createPlan,
  dmy,
  downloadCsv,
  ils,
  loadClubFinance,
  personName,
  planKindLabel,
  recordPayment,
  reviewPayment,
  sendReminders,
  setChargeStatus,
  type Charge,
  type ClubFinance,
  type ClubPayMethod,
  type PlanInput,
  type PlanKind,
} from '../lib/clubFinanceApi';

const errText = (e: unknown) => clubFinanceError(e) ?? friendlyError(e);
const today = () => new Date().toISOString().slice(0, 10);
type View = 'debts' | 'reported' | 'plans' | 'report';

export function ClubFinanceSection({ clubId, clubName, data }: { clubId: string; clubName: string; data: ClubData }) {
  const { session } = useAuth();
  const me = session!.user.id;
  const [fin, setFin] = useState<ClubFinance | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<View>('debts');
  const [teamFilter, setTeamFilter] = useState('');
  const [sheet, setSheet] = useState<null | 'plan' | 'charge'>(null);
  const [paying, setPaying] = useState<Charge | null>(null);

  const load = useCallback(async () => {
    try {
      const [l3, l2, l1] = await Promise.all([canClubFinance(clubId, 3), canClubFinance(clubId, 2), canClubFinance(clubId, 1)]);
      setLevel(l3 ? 3 : l2 ? 2 : l1 ? 1 : 0);
      setFin(await loadClubFinance(clubId));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const teamName = useCallback((id: string | null) => data.teams.find((t) => t.id === id)?.name ?? '', [data.teams]);
  const live = useMemo(() => (fin?.charges ?? []).filter((c) => c.state !== 'cancelled' && c.state !== 'waived'), [fin]);
  const filtered = live.filter((c) => !teamFilter || c.team_id === teamFilter);
  const totals = useMemo(() => {
    const charged = filtered.reduce((s, c) => s + c.amount, 0);
    const paid = filtered.reduce((s, c) => s + c.paid, 0);
    const overdue = filtered.filter((c) => c.state === 'overdue' || (c.state === 'partial' && c.due_on < today()));
    return { charged, paid, open: charged - paid, overdue: overdue.reduce((s, c) => s + c.balance, 0), overdueCount: overdue.length };
  }, [filtered]);
  const reported = (fin?.payments ?? []).filter((p) => p.status === 'reported');
  const chargeById = useMemo(() => new Map((fin?.charges ?? []).map((c) => [c.id, c])), [fin]);

  if (!fin) return error ? <Err error={error} /> : <p className="ip-muted">טוען…</p>;
  if (level === 0) return <EmptyState icon="wallet" title="אין לך גישה לכספי המועדון" text="מנהל המועדון יכול לתת לך הרשאת 'תשלומים ויתרות' בלשונית הצוות." />;

  const debts = filtered.filter((c) => c.balance > 0).sort((a, b) => a.due_on.localeCompare(b.due_on));

  return (
    <section className="ip-stack">
      <div className="ip-stats ip-stats--compact">
        <StatTile value={ils(totals.paid)} label="נגבה" />
        <StatTile value={ils(totals.open)} label="פתוח לגבייה" />
        <StatTile value={ils(totals.overdue)} label={`באיחור · ${totals.overdueCount}`} accent={totals.overdue > 0} />
      </div>

      {data.teams.length > 1 && (
        <Field label="קבוצה">
          <select className="ip-input" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">כל המועדון</option>
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Segmented
        label="כספים"
        value={view}
        onChange={setView}
        items={[
          { id: 'debts', label: 'חובות' },
          { id: 'reported', label: reported.length ? `לאישור · ${reported.length}` : 'לאישור' },
          { id: 'plans', label: 'דמי חבר' },
          { id: 'report', label: 'דוח' },
        ]}
      />
      <Err error={error} />
      {note && <p className="ip-muted" role="status">{note}</p>}

      {view === 'debts' && (
        <>
          {level >= 3 && (
            <div className="ip-btn-row">
              <Button variant="primary" icon="bell" disabled={!totals.overdueCount} onClick={() => run(() => sendReminders(clubId).then((n) => setNote(n ? `נשלחה תזכורת להורים של ${n} חיובים.` : 'אין חיובים באיחור שלא קיבלו תזכורת ב־3 הימים האחרונים.')))}>
                תזכורת לכל מי שבאיחור
              </Button>
              <Button variant="secondary" icon="plus" onClick={() => setSheet('charge')}>
                חיוב ידני
              </Button>
            </div>
          )}
          {debts.length === 0 ? (
            <EmptyState icon="check" title="אין חובות פתוחים" text={fin.plans.length ? 'כל החיובים שולמו.' : 'הגדירו דמי חבר בלשונית "דמי חבר" וצרו חיובים לשחקנים.'} />
          ) : (
            <Card padded={false}>
              {debts.map((c) => {
                const p = fin.people.get(c.player_id);
                const last = fin.lastReminder.get(c.id);
                return (
                  <div key={c.id} className="ip-member">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">
                        {personName(p)} · {ils(c.balance)}
                      </span>
                      <span className="ip-list-row-sub">
                        {[c.title, teamName(c.team_id), `עד ${dmy(c.due_on)}`, chargeStateLabel[c.state], c.reported > 0 && `דווח ${ils(c.reported)}`, last && `תזכורת ${dmy(last)}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="ip-find-actions">
                      {level >= 2 && (
                        <Button variant="primary" size="sm" onClick={() => setPaying(c)}>
                          תשלום
                        </Button>
                      )}
                      {level >= 3 && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => run(() => sendReminders(clubId, [c.id]).then((n) => setNote(n ? 'התזכורת נשלחה.' : 'כבר נשלחה תזכורת ב־3 הימים האחרונים.')))}>
                            תזכורת
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => confirm('לפטור את החיוב הזה?') && run(() => setChargeStatus(c.id, 'waived'))}>
                            פטור
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      {view === 'reported' &&
        (reported.length === 0 ? (
          <EmptyState icon="check" title="אין תשלומים שממתינים לאישור" text="כשהורה מדווח שילם, הדיווח יופיע כאן לאישור." />
        ) : (
          <Card padded={false}>
            {reported.map((p) => {
              const c = chargeById.get(p.charge_id);
              return (
                <div key={p.id} className="ip-member">
                  <span className="ip-list-row-text">
                    <span className="ip-list-row-title">
                      {personName(fin.people.get(p.player_id))} · {ils(p.amount)}
                    </span>
                    <span className="ip-list-row-sub">{[c?.title, clubMethodLabel[p.method], dmy(p.created_at), p.note].filter(Boolean).join(' · ')}</span>
                  </span>
                  {level >= 3 && (
                    <span className="ip-find-actions">
                      <Button variant="primary" size="sm" onClick={() => run(() => reviewPayment(p.id, 'confirmed'))}>
                        אישור
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => run(() => reviewPayment(p.id, 'rejected'))}>
                        לא התקבל
                      </Button>
                    </span>
                  )}
                </div>
              );
            })}
          </Card>
        ))}

      {view === 'plans' && (
        <>
          {level >= 3 && (
            <div className="ip-btn-row">
              <Button variant="primary" icon="plus" onClick={() => setSheet('plan')}>
                דמי חבר / תשלום חדש
              </Button>
            </div>
          )}
          {fin.plans.length === 0 ? (
            <EmptyState icon="wallet" title="עוד לא הוגדרו תשלומים" text="למשל: דמי חבר לעונה, 10 תשלומים חודשיים, או תשלום חד־פעמי לציוד." />
          ) : (
            <div className="ip-stack ip-stack--tight">
              {fin.plans.map((pl) => {
                const of = fin.charges.filter((c) => c.plan_id === pl.id && c.state !== 'cancelled');
                const kids = new Set(of.map((c) => c.player_id)).size;
                const paid = of.reduce((s, c) => s + c.paid, 0);
                const total = of.filter((c) => c.state !== 'waived').reduce((s, c) => s + c.amount, 0);
                return (
                  <Card key={pl.id}>
                    <div className="ip-carpool-head">
                      <strong>{pl.title}</strong>
                      <Tag tone="blue">{planKindLabel[pl.kind]}</Tag>
                    </div>
                    <p className="ip-muted">
                      {[
                        pl.installments > 1 ? `${pl.installments} תשלומים של ${ils(pl.amount)} כל ${pl.interval_months === 1 ? 'חודש' : `${pl.interval_months} חודשים`}` : ils(pl.amount),
                        `ראשון ב־${dmy(pl.first_due_on)}`,
                        pl.team_id ? teamName(pl.team_id) : pl.program_id ? data.programs.find((x) => x.id === pl.program_id)?.name : 'כל המועדון',
                        pl.season && `עונת ${pl.season}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="ip-muted">
                      {kids} שחקנים · נגבו {ils(paid)} מתוך {ils(total)}
                    </p>
                    {level >= 3 && (
                      <div className="ip-btn-row">
                        <Button variant="secondary" size="sm" onClick={() => run(() => assignPlan(pl.id).then((n) => setNote(n ? `נוצרו ${n} חיובים חדשים.` : 'כל השחקנים כבר מחויבים בתשלום הזה.')))}>
                          חיוב כל השחקנים
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => confirm('להעביר לארכיון? חיובים קיימים נשארים.') && run(() => archivePlan(pl.id))}>
                          ארכיון
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

      {view === 'report' && <Report fin={fin} data={data} clubName={clubName} teamName={teamName} />}

      <PlanSheet
        open={sheet === 'plan'}
        data={data}
        onClose={() => setSheet(null)}
        onSave={async (p, assign) => {
          const id = await createPlan(clubId, me, p);
          const n = assign ? await assignPlan(id) : 0;
          setSheet(null);
          setNote(assign ? `התשלום נוצר, ונוצרו ${n} חיובים לשחקנים.` : 'התשלום נוצר.');
          await load();
        }}
      />
      <ChargeSheet
        open={sheet === 'charge'}
        data={data}
        onClose={() => setSheet(null)}
        onSave={async (c) => {
          await addCharge(clubId, c);
          setSheet(null);
          await load();
        }}
      />
      <RecordSheet
        charge={paying}
        who={paying ? personName(fin.people.get(paying.player_id)) : ''}
        onClose={() => setPaying(null)}
        onSave={async (amount, method, on, n) => {
          await recordPayment(paying!.id, amount, method, on, n);
          setPaying(null);
          await load();
        }}
      />
    </section>
  );
}

function Report({ fin, data, clubName, teamName }: { fin: ClubFinance; data: ClubData; clubName: string; teamName: (id: string | null) => string }) {
  const live = fin.charges.filter((c) => c.state !== 'cancelled' && c.state !== 'waived');
  const byTeam = new Map<string, { charged: number; paid: number; debtors: Set<string> }>();
  for (const c of live) {
    const k = c.team_id ?? '';
    const r = byTeam.get(k) ?? { charged: 0, paid: 0, debtors: new Set<string>() };
    r.charged += c.amount;
    r.paid += c.paid;
    if (c.balance > 0 && c.due_on < today()) r.debtors.add(c.player_id);
    byTeam.set(k, r);
  }
  const csv = () =>
    downloadCsv(`${clubName}-כספים-${today()}.csv`, [
      ['שחקן', 'שנתון', 'הורים', 'קבוצה', 'חיוב', 'סכום', 'שולם', 'יתרה', 'מועד', 'מצב'],
      ...fin.charges.map((c) => {
        const p = fin.people.get(c.player_id);
        return [personName(p), p?.birth_year ?? '', p?.parents ?? '', teamName(c.team_id), c.title, c.amount, c.paid, c.balance, c.due_on, chargeStateLabel[c.state]];
      }),
    ]);
  return (
    <>
      <div className="ip-btn-row">
        <Button variant="secondary" icon="arrow" onClick={csv}>
          הורדת דוח (Excel)
        </Button>
      </div>
      <SectionHeader title="לפי קבוצה" icon="team" />
      <Card padded={false}>
        {[...byTeam.entries()].map(([team, r]) => (
          <div key={team} className="ip-member">
            <span className="ip-list-row-text">
              <span className="ip-list-row-title">{teamName(team || null) || (team ? 'קבוצה' : 'ללא קבוצה (מחנות וחיובים כלליים)')}</span>
              <span className="ip-list-row-sub">
                נגבו {ils(r.paid)} מתוך {ils(r.charged)} · {r.debtors.size} משפחות באיחור
              </span>
            </span>
            <strong>{r.charged ? Math.round((r.paid / r.charged) * 100) : 100}%</strong>
          </div>
        ))}
        {byTeam.size === 0 && <p className="ip-muted ip-pad">אין עדיין חיובים.</p>}
      </Card>
      <SectionHeader title="תשלומים אחרונים" icon="wallet" />
      <Card padded={false}>
        {fin.payments.filter((p) => p.status === 'confirmed').slice(0, 20).map((p) => (
          <div key={p.id} className="ip-member">
            <span className="ip-list-row-text">
              <span className="ip-list-row-title">{personName(fin.people.get(p.player_id))}</span>
              <span className="ip-list-row-sub">{[fin.charges.find((c) => c.id === p.charge_id)?.title, clubMethodLabel[p.method], dmy(p.paid_on)].join(' · ')}</span>
            </span>
            <strong>{ils(p.amount)}</strong>
          </div>
        ))}
        {!fin.payments.some((p) => p.status === 'confirmed') && <p className="ip-muted ip-pad">עוד לא נרשמו תשלומים.</p>}
      </Card>
      <p className="ip-footnote">
        {data.teams.length} קבוצות במועדון. התשלום עצמו נעשה מחוץ לאפליקציה; לא נשמרים כאן פרטי כרטיסי אשראי. חיבור לספק סליקה יתווסף בהמשך.
      </p>
    </>
  );
}

function PlanSheet({ open, data, onClose, onSave }: { open: boolean; data: ClubData; onClose: () => void; onSave: (p: PlanInput, assign: boolean) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<PlanKind>('membership');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('10');
  const [every, setEvery] = useState('1');
  const [first, setFirst] = useState(today());
  const [scope, setScope] = useState('');
  const [season, setSeason] = useState('');
  const [assign, setAssign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle('');
      setAmount('');
      setError(null);
    }
  }, [open]);
  const multi = kind === 'monthly' || kind === 'periodic';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('צריך שם לתשלום.');
    if (!(Number(amount) > 0)) return setError('צריך סכום.');
    const [kindOfScope, id] = scope.split(':');
    setBusy(true);
    try {
      await onSave(
        {
          title: title.trim(),
          kind,
          amount: Number(amount),
          installments: multi ? Math.max(1, Math.min(24, Number(count) || 1)) : 1,
          interval_months: kind === 'monthly' ? 1 : multi ? Math.max(1, Math.min(12, Number(every) || 1)) : 1,
          first_due_on: first || today(),
          season: season.trim(),
          notes: '',
          program_id: kindOfScope === 'p' ? id : null,
          team_id: kindOfScope === 't' ? id : null,
        },
        assign,
      );
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="דמי חבר / תשלום חדש">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="שם">
          <input className="ip-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="לדוגמה: דמי חבר 2026/27" />
        </Field>
        <Field label="סוג">
          <select className="ip-input" value={kind} onChange={(e) => setKind(e.target.value as PlanKind)}>
            {(Object.keys(planKindLabel) as PlanKind[]).map((k) => (
              <option key={k} value={k}>
                {planKindLabel[k]}
              </option>
            ))}
          </select>
        </Field>
        <div className="ip-field-row">
          <Field label={multi ? 'סכום לכל תשלום (₪)' : 'סכום (₪)'}>
            <input className="ip-input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          {multi && (
            <Field label="מספר תשלומים">
              <input className="ip-input" inputMode="numeric" dir="ltr" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </Field>
          )}
          {kind === 'periodic' && (
            <Field label="כל כמה חודשים">
              <input className="ip-input" inputMode="numeric" dir="ltr" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            </Field>
          )}
        </div>
        <div className="ip-field-row">
          <Field label={multi ? 'מועד התשלום הראשון' : 'מועד תשלום'}>
            <input className="ip-input" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label="עונה">
            <input className="ip-input" dir="ltr" value={season} onChange={(e) => setSeason(e.target.value.slice(0, 20))} placeholder="2026/27" />
          </Field>
        </div>
        <Field label="למי">
          <select className="ip-input" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">כל השחקנים במועדון</option>
            {data.programs.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                מסגרת: {p.name}
              </option>
            ))}
            {data.teams.map((t) => (
              <option key={t.id} value={`t:${t.id}`}>
                קבוצה: {t.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="ip-check">
          <input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} /> ליצור עכשיו חיובים לכל השחקנים הפעילים
        </label>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function ChargeSheet({ open, data, onClose, onSave }: { open: boolean; data: ClubData; onClose: () => void; onSave: (c: { player: string; title: string; amount: number; due: string; team: string | null }) => Promise<void> }) {
  const players = useMemo(() => {
    const m = new Map<string, { id: string; name: string; team: string }>();
    for (const a of data.assignments) if (!m.has(a.player_id) || a.is_primary) m.set(a.player_id, { id: a.player_id, name: `${a.player.first_name} ${a.player.last_name}`.trim(), team: a.team_id });
    return [...m.values()].sort((x, y) => x.name.localeCompare(y.name, 'he'));
  }, [data.assignments]);
  const [player, setPlayer] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPlayer(players[0]?.id ?? '');
      setTitle('');
      setAmount('');
      setError(null);
    }
  }, [open, players]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!player) return setError('בחרו שחקן.');
    if (!title.trim() || !(Number(amount) > 0)) return setError('צריך שם וסכום.');
    setBusy(true);
    try {
      await onSave({ player, title: title.trim(), amount: Number(amount), due, team: players.find((p) => p.id === player)?.team ?? null });
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="חיוב ידני">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="שחקן">
          <select className="ip-input" value={player} onChange={(e) => setPlayer(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="על מה">
          <input className="ip-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="לדוגמה: ערכת אימון" />
        </Field>
        <div className="ip-field-row">
          <Field label="סכום (₪)">
            <input className="ip-input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="מועד תשלום">
            <input className="ip-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'הוספת החיוב'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function RecordSheet({ charge, who, onClose, onSave }: { charge: Charge | null; who: string; onClose: () => void; onSave: (amount: number, method: ClubPayMethod, on: string, note: string) => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ClubPayMethod>('cash');
  const [on, setOn] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (charge) {
      setAmount(String(charge.balance));
      setOn(today());
      setNote('');
      setError(null);
    }
  }, [charge]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(Number(amount) > 0)) return setError('צריך סכום.');
    setBusy(true);
    try {
      await onSave(Number(amount), method, on, note.trim());
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={charge !== null} onClose={onClose} title={charge ? `תשלום: ${who}` : 'תשלום'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {charge && (
          <p>
            {charge.title} · נשאר {ils(charge.balance)}
          </p>
        )}
        <div className="ip-field-row">
          <Field label="סכום (₪)">
            <input className="ip-input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="תאריך">
            <input className="ip-input" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
        </div>
        <Field label="אמצעי">
          <select className="ip-input" value={method} onChange={(e) => setMethod(e.target.value as ClubPayMethod)}>
            {(Object.keys(clubMethodLabel) as ClubPayMethod[])
              .filter((m) => m !== 'provider')
              .map((m) => (
                <option key={m} value={m}>
                  {clubMethodLabel[m]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="הערה">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לא חובה, למשל מספר קבלה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'רישום התשלום'}
        </Button>
      </form>
    </BottomSheet>
  );
}
