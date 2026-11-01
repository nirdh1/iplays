/**
 * A family's own costs for one child: the program's annual fee and what was
 * paid toward it, plus kit, tournaments, rides etc., and the confirmed team
 * fund payments. Private to the child's parents (RLS on child_costs).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, SectionHeader } from '../components/ui';
import { BottomSheet } from '../components/shell';
import { Err, Field } from '../components/form';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import { supabase } from '../lib/supabase';
import {
  addChildCost,
  costKindLabel,
  deleteChildCost,
  fundError,
  loadChildCosts,
  shekel,
  type ChildCost,
  type CostKind,
  type FundPaid,
} from '../lib/fundApi';

const errText = (e: unknown) => fundError(e) ?? friendlyError(e);
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });

export function CostsScreen({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const { session, teams } = useAuth();
  const me = session!.user.id;
  const [name, setName] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [costs, setCosts] = useState<ChildCost[] | null>(null);
  const [fund, setFund] = useState<FundPaid[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | CostKind>(null);

  const load = useCallback(async () => {
    try {
      const [p, a, c] = await Promise.all([
        supabase!.from('players').select('first_name, last_name').eq('id', playerId).maybeSingle(),
        supabase!.from('player_assignments').select('team_id').eq('player_id', playerId).is('ended_on', null),
        loadChildCosts(playerId),
      ]);
      if (p.data) setName(`${p.data.first_name} ${p.data.last_name}`.trim());
      setTeamIds((a.data ?? []).map((x) => x.team_id as string));
      setCosts(c.costs);
      setFund(c.fund);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [playerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myTeams = teams.filter((t) => teamIds.includes(t.id));
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name;
  const fees = costs?.filter((c) => c.kind === 'annual_fee') ?? [];
  const feePaid = costs?.filter((c) => c.kind === 'fee_payment').reduce((s, c) => s + c.amount, 0) ?? 0;
  const feeTotal = fees.reduce((s, c) => s + c.amount, 0);
  const other = costs?.filter((c) => c.kind !== 'annual_fee' && c.kind !== 'fee_payment') ?? [];
  const spent = feePaid + other.reduce((s, c) => s + c.amount, 0) + fund.reduce((s, f) => s + f.amount, 0);

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>{name ? `ההוצאות על ${name.split(' ')[0]}` : 'ההוצאות שלנו'}</h1>
        <span />
      </div>
      <p className="ip-muted">רק את/ה וההורים האחרים של הילד רואים את הנתונים האלה.</p>
      {error && <p className="ip-error" role="alert">{error}</p>}

      {costs && (
        <>
          <div className="ip-stats ip-stats--compact">
            <div className="ip-stat">
              <span className="ip-stat-value">{shekel(feeTotal)}</span>
              <span className="ip-stat-label">עלות שנתית למסגרת</span>
            </div>
            <div className={`ip-stat ${feeTotal - feePaid > 0 ? 'ip-stat--accent' : ''}`}>
              <span className="ip-stat-value">{feeTotal - feePaid > 0 ? shekel(feeTotal - feePaid) : '✓'}</span>
              <span className="ip-stat-label">{feeTotal - feePaid > 0 ? 'נשאר לשלם למסגרת' : 'שולם למסגרת'}</span>
            </div>
            <div className="ip-stat">
              <span className="ip-stat-value">{shekel(spent)}</span>
              <span className="ip-stat-label">שולם בסך הכל</span>
            </div>
          </div>

          <div className="ip-btn-row">
            <Button variant="primary" icon="plus" onClick={() => setSheet(fees.length ? 'fee_payment' : 'annual_fee')}>
              {fees.length ? 'תשלום למסגרת' : 'עלות שנתית'}
            </Button>
            <Button variant="secondary" icon="wallet" onClick={() => setSheet('kit')}>
              הוצאה אחרת
            </Button>
            {fees.length > 0 && (
              <Button variant="ghost" onClick={() => setSheet('annual_fee')}>
                עלות למסגרת נוספת
              </Button>
            )}
          </div>

          <section>
            <SectionHeader title="המסגרת" icon="team" />
            {fees.length === 0 ? (
              <EmptyState icon="wallet" title="עוד לא הוזנה עלות שנתית" text="הוסיפו כמה עולה המסגרת לעונה, ורשמו כל תשלום. נראה לכם כמה נשאר." />
            ) : (
              <CostList items={costs.filter((c) => c.kind === 'annual_fee' || c.kind === 'fee_payment')} teamName={teamName} onDelete={(id) => deleteChildCost(id).then(load).catch((e) => setError(errText(e)))} />
            )}
          </section>

          {(other.length > 0 || fund.length > 0) && (
            <section>
              <SectionHeader title="הוצאות נוספות" icon="wallet" />
              {other.length > 0 && <CostList items={other} teamName={teamName} onDelete={(id) => deleteChildCost(id).then(load).catch((e) => setError(errText(e)))} />}
              {fund.length > 0 && (
                <Card padded={false}>
                  {fund.map((f) => (
                    <div key={f.id} className="ip-member">
                      <span className="ip-list-row-text">
                        <span className="ip-list-row-title">{f.title}</span>
                        <span className="ip-list-row-sub">{['קופת הקבוצה', teamName(f.team_id), f.at && dateLabel(f.at)].filter(Boolean).join(' · ')}</span>
                      </span>
                      <strong>{shekel(f.amount)}</strong>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          )}
        </>
      )}
      {!costs && !error && <p className="ip-muted">טוען…</p>}

      <CostSheet
        kind={sheet}
        teams={myTeams}
        onClose={() => setSheet(null)}
        onSave={async (c) => {
          await addChildCost(me, { ...c, player_id: playerId });
          setSheet(null);
          await load();
        }}
      />
    </div>
  );
}

function CostList({ items, teamName, onDelete }: { items: ChildCost[]; teamName: (id: string | null) => string | undefined; onDelete: (id: string) => void }) {
  return (
    <Card padded={false}>
      {items.map((c) => (
        <div key={c.id} className="ip-member">
          <span className="ip-list-row-text">
            <span className="ip-list-row-title">{c.title || costKindLabel[c.kind]}</span>
            <span className="ip-list-row-sub">
              {[c.title && costKindLabel[c.kind], teamName(c.team_id), c.season && `עונת ${c.season}`, dateLabel(c.spent_on), c.note].filter(Boolean).join(' · ')}
            </span>
          </span>
          <strong>{shekel(c.amount)}</strong>
          <button type="button" className="ip-icon-btn ip-icon-btn--plain" aria-label="מחיקה" onClick={() => confirm('למחוק את השורה?') && onDelete(c.id)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </Card>
  );
}

function CostSheet({
  kind,
  teams,
  onClose,
  onSave,
}: {
  kind: CostKind | null;
  teams: { id: string; name: string; season: string }[];
  onClose: () => void;
  onSave: (c: Omit<ChildCost, 'id' | 'player_id'>) => Promise<void>;
}) {
  const [k, setK] = useState<CostKind>('kit');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [team, setTeam] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!kind) return;
    setK(kind);
    setTitle('');
    setAmount('');
    setDate(today());
    setNote('');
    setTeam(teams[0]?.id ?? '');
    setError(null);
  }, [kind, teams]);
  const isFee = k === 'annual_fee';
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(Number(amount) > 0)) return setError('צריך סכום.');
    setBusy(true);
    try {
      const t = teams.find((x) => x.id === team);
      await onSave({ kind: k, title: title.trim(), amount: Number(amount), spent_on: date || today(), team_id: t?.id ?? null, season: t?.season ?? '', note: note.trim() });
    } catch (x) {
      setError(errText(x));
    } finally {
      setBusy(false);
    }
  }
  const kinds = (Object.keys(costKindLabel) as CostKind[]).filter((x) => (kind === 'annual_fee' || kind === 'fee_payment' ? x === 'annual_fee' || x === 'fee_payment' : x !== 'annual_fee' && x !== 'fee_payment'));
  return (
    <BottomSheet open={kind !== null} onClose={onClose} title={isFee ? 'עלות שנתית למסגרת' : k === 'fee_payment' ? 'תשלום למסגרת' : 'הוצאה'}>
      <form className="ip-form ip-form--sheet" onSubmit={submit}>
        <Field label="סוג">
          <select className="ip-input" value={k} onChange={(e) => setK(e.target.value as CostKind)}>
            {kinds.map((x) => (
              <option key={x} value={x}>
                {costKindLabel[x]}
              </option>
            ))}
          </select>
        </Field>
        {teams.length > 0 && (
          <Field label="מסגרת">
            <select className="ip-input" value={team} onChange={(e) => setTeam(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="">אחר / לא קשור לקבוצה</option>
            </select>
          </Field>
        )}
        <div className="ip-field-row">
          <Field label={isFee ? 'עלות לעונה (₪)' : 'סכום (₪)'}>
            <input className="ip-input" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder={isFee ? '3200' : ''} />
          </Field>
          <Field label="תאריך">
            <input className="ip-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="תיאור">
          <input className="ip-input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder={isFee ? 'לדוגמה: דמי השתתפות באקדמיה' : k === 'fee_payment' ? 'לדוגמה: תשלום 2 מתוך 10' : 'לדוגמה: נעלי כדורגל'} />
        </Field>
        <Field label="הערה">
          <input className="ip-input" value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="לא חובה" />
        </Field>
        <Err error={error} />
        <Button type="submit" variant="primary" block disabled={busy}>
          {busy ? 'שומרים…' : 'שמירה'}
        </Button>
      </form>
    </BottomSheet>
  );
}
