/**
 * Real team fund (backend mode): collections, "I paid" for my children,
 * treasurer review of every family, expenses and treasurers.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { BottomSheet } from '../components/shell';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError, getMembers, getRoster, roleLabel, type Member, type Player } from '../lib/api';
import {
  addExpense,
  appointTreasurer,
  collectionPresets,
  collectionTarget,
  createCollection,
  deleteExpense,
  fundError,
  loadFund,
  methodLabel,
  removeTreasurer,
  reportPayment,
  setCollectionStatus,
  setPaymentStatus,
  shekel,
  statusLabel,
  type Collection,
  type FundData,
  type PayMethod,
  type Payment,
} from '../lib/fundApi';

const errText = (e: unknown) => fundError(e) ?? friendlyError(e);
const dateLabel = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());

export function FundScreen({ teamId, onBack }: { teamId: string; onBack: () => void }) {
  const { session, teams } = useAuth();
  const me = session!.user.id;
  const team = teams.find((t) => t.id === teamId);
  const [data, setData] = useState<FundData | null>(null);
  const [roster, setRoster] = useState<Player[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'collection' | 'expense' | 'treasurers'>(null);
  const [paying, setPaying] = useState<{ c: Collection; p: Player } | null>(null);
  const [review, setReview] = useState<Collection | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, r, m] = await Promise.all([loadFund(teamId), getRoster(teamId), getMembers(teamId)]);
      setData(d);
      setRoster(r);
      setMembers(m);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = (p: Promise<unknown>) => p.then(load).catch((e) => setError(errText(e)));

  if (!team) {
    return (
      <div className="ip-stack">
        <BackBar onBack={onBack} title="קופת הקבוצה" />
        <EmptyState icon="team" title="הקבוצה לא נמצאה" text="ייתכן שיצאת מהקבוצה או שהקישור שגוי." />
      </div>
    );
  }

  const myKids = roster.filter((p) => p.guardians.includes(me));
  const open = data?.collections.filter((c) => c.status === 'open') ?? [];
  const past = data?.collections.filter((c) => c.status !== 'open') ?? [];
  const raised = data ? [...data.summary.values()].reduce((s, x) => s + x.raised, 0) : 0;
  const spent = data?.expenses.reduce((s, e) => s + e.amount, 0) ?? 0;
  const payOf = (c: Collection, p: Player) => data?.payments.find((x) => x.collection_id === c.id && x.player_id === p.id);
  const owed = open.reduce((s, c) => s + myKids.filter((k) => !['confirmed', 'exempt', 'reported'].includes(payOf(c, k)?.status ?? '')).length * c.amount_per_child, 0);
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.full_name ?? 'ללא שם';

  return (
    <div className="ip-stack">
      <BackBar onBack={onBack} title="קופת הקבוצה" />
      <p className="ip-muted">{team.name}</p>
      {error && <p className="ip-error" role="alert">{error}</p>}

      {data && (
        <>
          <div className="ip-stats ip-stats--compact">
            <div className="ip-stat">
              <span className="ip-stat-value">{shekel(raised)}</span>
              <span className="ip-stat-label">נאסף בקופה</span>
            </div>
            <div className="ip-stat">
              <span className="ip-stat-value">{shekel(raised - spent)}</span>
              <span className="ip-stat-label">יתרה אחרי הוצאות</span>
            </div>
            {myKids.length > 0 && (
              <div className={`ip-stat ${owed ? 'ip-stat--accent' : ''}`}>
                <span className="ip-stat-value">{owed ? shekel(owed) : '✓'}</span>
                <span className="ip-stat-label">{owed ? 'לתשלום שלכם' : 'אין חוב פתוח'}</span>
              </div>
            )}
          </div>

          {myKids.length > 0 && (
            <div className="ip-btn-row">
              {myKids.map((k) => (
                <Button key={k.id} variant="ghost" size="sm" icon="wallet" onClick={() => (window.location.hash = `costs/${k.id}`)}>
                  ההוצאות שלנו על {k.first_name}
                </Button>
              ))}
            </div>
          )}

          {!data.hasManager && (
            <Card>
              <strong>לקופה עוד אין גזבר/ית</strong>
              <p className="ip-muted">הגזבר/ית פותח/ת גביות, מאשר/ת תשלומים ורושם/ת הוצאות. כל ההורים רואים את הסכומים.</p>
              <div className="ip-btn-row">
                <Button variant="primary" icon="wallet" onClick={() => run(appointTreasurer(teamId))}>
                  אני אנהל את הקופה
                </Button>
              </div>
            </Card>
          )}

          {data.canManage && (
            <div className="ip-btn-row">
              <Button variant="primary" icon="plus" onClick={() => setSheet('collection')}>
                גבייה חדשה
              </Button>
              <Button variant="secondary" icon="wallet" onClick={() => setSheet('expense')}>
                הוצאה
              </Button>
              <Button variant="ghost" icon="team" onClick={() => setSheet('treasurers')}>
                גזברים
              </Button>
            </div>
          )}

          <section>
            <SectionHeader title="גביות פעילות" icon="wallet" />
            {open.length === 0 ? (
              <EmptyState icon="wallet" title="אין גבייה פתוחה" text={data.canManage ? 'פתחו גבייה חדשה, וההורים יראו אותה כאן.' : 'כשהגזבר/ית יפתח/תפתח גבייה, היא תופיע כאן.'} />
            ) : (
              <div className="ip-stack ip-stack--tight">
                {open.map((c) => (
                  <CollectionCard
                    key={c.id}
                    c={c}
                    data={data}
                    kids={myKids}
                    payOf={payOf}
                    onPay={(p) => setPaying({ c, p })}
                    onReview={data.canManage ? () => setReview(c) : undefined}
                  />
                ))}
              </div>
            )}
          </section>

          {data.expenses.length > 0 && (
            <section>
              <SectionHeader title="הוצאות מהקופה" icon="wallet" />
              <Card padded={false}>
                {data.expenses.map((e) => (
                  <div key={e.id} className="ip-member">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{e.title}</span>
                      <span className="ip-list-row-sub">
                        {[dateLabel(e.spent_on), e.collection_id && data.collections.find((c) => c.id === e.collection_id)?.title].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <strong>{shekel(e.amount)}</strong>
                    {data.canManage && (
                      <button type="button" className="ip-icon-btn ip-icon-btn--plain" aria-label={`מחיקת ההוצאה ${e.title}`} onClick={() => confirm('למחוק את ההוצאה?') && run(deleteExpense(e.id))}>
                        <Icon name="close" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </Card>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <SectionHeader title="גביות שנסגרו" icon="check" />
              <div className="ip-stack ip-stack--tight">
                {past.map((c) => (
                  <CollectionCard key={c.id} c={c} data={data} kids={myKids} payOf={payOf} onReview={data.canManage ? () => setReview(c) : undefined} />
                ))}
              </div>
            </section>
          )}

          <p className="ip-footnote">
            {data.treasurers.length ? `מנהלים את הקופה: ${data.treasurers.map(nameOf).join(', ')}. ` : ''}
            הסכומים וההוצאות גלויים לכל ההורים בקבוצה. כל הורה רואה רק את התשלומים של הילדים שלו. הכסף לא עובר דרך iplays.
          </p>
        </>
      )}
      {!data && !error && <p className="ip-muted">טוען…</p>}

      <CollectionSheet
        open={sheet === 'collection'}
        onClose={() => setSheet(null)}
        onSave={async (c) => {
          await createCollection(teamId, me, c);
          setSheet(null);
          await load();
        }}
      />
      <ExpenseSheet
        open={sheet === 'expense'}
        collections={data?.collections ?? []}
        onClose={() => setSheet(null)}
        onSave={async (e) => {
          await addExpense(teamId, me, e);
          setSheet(null);
          await load();
        }}
      />
      <TreasurersSheet
        open={sheet === 'treasurers'}
        members={members}
        treasurers={data?.treasurers ?? []}
        onClose={() => setSheet(null)}
        onAdd={(u) => run(appointTreasurer(teamId, u))}
        onRemove={(u) => run(removeTreasurer(teamId, u))}
      />
      <PaySheet
        target={paying}
        onClose={() => setPaying(null)}
        onSave={async (method, note) => {
          await reportPayment(paying!.c.id, paying!.p.id, method, note);
          setPaying(null);
          await load();
        }}
      />
      <ReviewSheet
        c={review}
        roster={roster}
        payments={data?.payments ?? []}
        onClose={() => setReview(null)}
        onSet={(p, status, method) => run(setPaymentStatus(review!.id, p, status, method))}
        onStatus={(s) =>
          run(setCollectionStatus(review!.id, s)).then(() => setReview(null))
        }
      />
    </div>
  );
}

function CollectionCard({
  c,
  data,
  kids,
  payOf,
  onPay,
  onReview,
}: {
  c: Collection;
  data: FundData;
  kids: Player[];
  payOf: (c: Collection, p: Player) => Payment | undefined;
  onPay?: (p: Player) => void;
  onReview?: () => void;
}) {
  const s = data.summary.get(c.id);
  const target = collectionTarget(c, s);
  const raised = s?.raised ?? 0;
  const pct = target ? Math.min(100, Math.round((raised / target) * 100)) : 0;
  return (
    <Card>
      <div className="ip-carpool-head">
        <strong>{c.title}</strong>
        {c.status === 'cancelled' ? (
          <Tag tone="neutral">בוטלה</Tag>
        ) : c.status === 'closed' ? (
          <Tag tone="neutral">נסגרה</Tag>
        ) : c.due_on ? (
          <Tag tone="warning">עד {dateLabel(c.due_on)}</Tag>
        ) : null}
      </div>
      {c.details && <p className="ip-muted">{c.details}</p>}
      <div className="ip-fund-amounts">
        <strong>{shekel(raised)}</strong>
        <span className="ip-muted">
          מתוך {shekel(target)} · {shekel(c.amount_per_child)} לילד · שילמו {s?.paid ?? 0} מתוך {s?.children ?? 0}
        </span>
      </div>
      <div className="ip-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.title}: ${pct}%`}>
        <div className="ip-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {c.status === 'open' && c.pay_link && (
        <p className="ip-muted">
          איך משלמים:{' '}
          {isUrl(c.pay_link) ? (
            <a href={c.pay_link.trim()} target="_blank" rel="noopener noreferrer" dir="ltr">
              {c.pay_link.trim()}
            </a>
          ) : (
            <span dir="auto">{c.pay_link}</span>
          )}
        </p>
      )}
      {kids.map((k) => {
        const p = payOf(c, k);
        const st = p?.status;
        return (
          <div key={k.id} className="ip-carpool-head">
            <span>
              {k.first_name}: {st ? statusLabel[st] : 'עוד לא שולם'}
              {st === 'reported' && p ? ` (${methodLabel[p.method]})` : ''}
            </span>
            {c.status === 'open' && onPay && (!st || st === 'rejected') && (
              <Button variant="primary" size="sm" icon="check" onClick={() => onPay(k)}>
                שילמתי
              </Button>
            )}
            {st === 'confirmed' && <Tag tone="lime" icon="check">שילמתם</Tag>}
          </div>
        );
      })}
      {onReview && (
        <div className="ip-btn-row">
          <Button variant="ghost" size="sm" icon="team" onClick={onReview}>
            מי שילם{s?.reported ? ` · ${s.reported} ממתינים` : ''}
          </Button>
        </div>
      )}
    </Card>
  );
}

function PaySheet({
  target,
  onClose,
  onSave,
}: {
  target: { c: Collection; p: Player } | null;
  onClose: () => void;
  onSave: (m: PayMethod, note: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<PayMethod>('bit');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNote('');
    setError(null);
  }, [target]);
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
    <BottomSheet open={target !== null} onClose={onClose} title={target ? `שילמתי: ${target.c.title}` : 'שילמתי'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        {target && (
          <p>
            {shekel(target.c.amount_per_child)} עבור {target.p.first_name}. הגזבר/ית יאשר/תאשר כשיראה/תראה את התשלום.
          </p>
        )}
        <Field label="איך שילמת">
          <select className="ip-input" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {(Object.keys(methodLabel) as PayMethod[]).map((m) => (
              <option key={m} value={m}>
                {methodLabel[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="הערה">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לא חובה, למשל: שילמתי גם על האח" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שולחים…' : 'דיווח על תשלום'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function ReviewSheet({
  c,
  roster,
  payments,
  onClose,
  onSet,
  onStatus,
}: {
  c: Collection | null;
  roster: Player[];
  payments: Payment[];
  onClose: () => void;
  onSet: (player: string, status: 'confirmed' | 'rejected' | 'exempt', method?: PayMethod) => void;
  onStatus: (s: 'open' | 'closed' | 'cancelled') => void;
}) {
  const rows = c ? roster.map((p) => ({ p, pay: payments.find((x) => x.collection_id === c.id && x.player_id === p.id) })) : [];
  // waiting for review first, then unpaid, then done
  const rank = (s?: string) => (s === 'reported' ? 0 : !s || s === 'rejected' ? 1 : 2);
  rows.sort((a, b) => rank(a.pay?.status) - rank(b.pay?.status));
  return (
    <BottomSheet open={c !== null} onClose={onClose} title={c ? `מי שילם: ${c.title}` : 'מי שילם'}>
      <div className="ip-form ip-form--sheet">
        {rows.length === 0 && <p className="ip-muted">אין שחקנים בסגל.</p>}
        {rows.map(({ p, pay }) => (
          <div key={p.id} className="ip-member">
            <span className="ip-list-row-text">
              <span className="ip-list-row-title">
                {p.first_name} {p.last_name}
              </span>
              <span className="ip-list-row-sub">
                {pay ? [statusLabel[pay.status], methodLabel[pay.method], pay.note].filter(Boolean).join(' · ') : 'עוד לא שולם'}
              </span>
            </span>
            <span className="ip-find-actions">
              {pay?.status === 'reported' && (
                <>
                  <Button variant="primary" size="sm" onClick={() => onSet(p.id, 'confirmed')}>
                    אישור
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSet(p.id, 'rejected')}>
                    לא התקבל
                  </Button>
                </>
              )}
              {(!pay || pay.status === 'rejected') && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onSet(p.id, 'confirmed', 'cash')}>
                    שולם במזומן
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onSet(p.id, 'exempt')}>
                    פטור
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
        {c && (
          <div className="ip-btn-row">
            {c.status === 'open' ? (
              <>
                <Button variant="secondary" onClick={() => onStatus('closed')}>
                  סגירת הגבייה
                </Button>
                <Button variant="ghost" onClick={() => confirm('לבטל את הגבייה? היא תישאר בהיסטוריה.') && onStatus('cancelled')}>
                  ביטול
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => onStatus('open')}>
                פתיחה מחדש
              </Button>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function CollectionSheet({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (c: Parameters<typeof createCollection>[2]) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [amount, setAmount] = useState('');
  const [goal, setGoal] = useState('');
  const [due, setDue] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle('');
      setDetails('');
      setAmount('');
      setGoal('');
      setDue('');
      setError(null);
    }
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = Number(amount);
    if (!title.trim()) return setError('צריך שם לגבייה.');
    if (!(a > 0)) return setError('צריך סכום לילד.');
    setBusy(true);
    try {
      await onSave({ title: title.trim(), details: details.trim(), amount_per_child: a, goal: Number(goal) > 0 ? Number(goal) : null, due_on: due || null, pay_link: link.trim() });
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="גבייה חדשה">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="על מה גובים">
          <input className="ip-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="לדוגמה: מתנה למאמן" />
        </Field>
        <div className="ip-btn-row">
          {collectionPresets.map((t) => (
            <Button key={t} type="button" variant={title === t ? 'secondary' : 'ghost'} size="sm" onClick={() => setTitle(t)}>
              {t}
            </Button>
          ))}
        </div>
        <div className="ip-field-row">
          <Field label="סכום לילד (₪)">
            <input className="ip-input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="50" />
          </Field>
          <Field label="יעד (לא חובה)">
            <input className="ip-input" inputMode="decimal" dir="ltr" value={goal} onChange={(e) => setGoal(e.target.value.replace(/[^\d.]/g, ''))} placeholder="₪" />
          </Field>
        </div>
        <Field label="לשלם עד (לא חובה)">
          <input className="ip-input" type="date" value={due} min={today()} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="איך משלמים">
          <input className="ip-input" dir="auto" value={link} onChange={(e) => setLink(e.target.value.slice(0, 300))} placeholder="קישור ביט / פייבוקס, טלפון או פרטי חשבון" />
        </Field>
        <p className="ip-footnote">פותחים קבוצת פייבוקס או בקשת תשלום בביט באפליקציה שלהם, ומדביקים כאן את הקישור. ההורים יקבלו כפתור שפותח אותו.</p>
        <Field label="פרטים">
          <input className="ip-input" value={details} onChange={(e) => setDetails(e.target.value.slice(0, 500))} placeholder="לא חובה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'פתיחת הגבייה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function ExpenseSheet({
  open,
  collections,
  onClose,
  onSave,
}: {
  open: boolean;
  collections: Collection[];
  onClose: () => void;
  onSave: (e: { title: string; amount: number; spent_on: string; collection_id: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [col, setCol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle('');
      setAmount('');
      setDate(today());
      setError(null);
    }
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('צריך לכתוב על מה הוצא הכסף.');
    if (!(Number(amount) > 0)) return setError('צריך סכום.');
    setBusy(true);
    try {
      await onSave({ title: title.trim(), amount: Number(amount), spent_on: date || today(), collection_id: col || null });
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title="הוצאה מהקופה">
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="על מה">
          <input className="ip-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="לדוגמה: עוגה לסוף העונה" />
        </Field>
        <div className="ip-field-row">
          <Field label="סכום (₪)">
            <input className="ip-input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="תאריך">
            <input className="ip-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {collections.length > 0 && (
          <Field label="מתוך גבייה">
            <select className="ip-input" value={col} onChange={(e) => setCol(e.target.value)}>
              <option value="">כללי</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}

function TreasurersSheet({
  open,
  members,
  treasurers,
  onClose,
  onAdd,
  onRemove,
}: {
  open: boolean;
  members: Member[];
  treasurers: string[];
  onClose: () => void;
  onAdd: (u: string) => void;
  onRemove: (u: string) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="מי מנהל את הקופה">
      <div className="ip-form ip-form--sheet">
        <p className="ip-muted">גזברים פותחים גביות, מאשרים תשלומים ורושמים הוצאות. גם מנהל/ת הקבוצה ומנהלי המועדון יכולים.</p>
        {members.map((m) => {
          const t = treasurers.includes(m.user_id);
          return (
            <div key={m.user_id} className="ip-member">
              <span className="ip-list-row-text">
                <span className="ip-list-row-title">{m.full_name}</span>
                <span className="ip-list-row-sub">{[roleLabel[m.role], t && 'גזבר/ית'].filter(Boolean).join(' · ')}</span>
              </span>
              {t ? (
                <Button variant="ghost" size="sm" onClick={() => onRemove(m.user_id)}>
                  הסרה
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => onAdd(m.user_id)}>
                  מינוי לגזבר/ית
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </BottomSheet>
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
