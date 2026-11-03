/**
 * Updates from a screenshot (or PDF / Excel / CSV), read for free in the phone:
 *  - LeagueSnapshotSheet: the league table. Any member of the team can save it;
 *    it is shown next to the table computed from IFA results, marked as a
 *    screenshot, and never changes that table.
 *  - RosterFromFileSheet: the team roster (staff). Names are compared with the
 *    roster; staff pick who to add and who to take off (history kept).
 * Every row is shown for review and can be fixed before anything is saved.
 */
import { useRef, useState } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Tag } from '../components/ui';
import { Err } from '../components/form';
import { addPlayer, friendlyError, type Player } from '../lib/api';
import { endAssignment } from '../lib/clubApi';
import type { LeagueRow } from '../lib/leagueApi';
import {
  ACCEPT,
  compareRoster,
  fullName,
  orientWithComputed,
  readLeagueTableFile,
  readRosterFile,
  saveLeagueSnapshot,
  splitName,
  TableReadError,
  type DraftLeagueRow,
  type RosterCompare,
} from '../lib/screenshotTables';
import '../theme/coach.css';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const errText = (e: unknown) => (e instanceof TableReadError ? e.message : friendlyError(e));

function usePicker() {
  const ref = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('');
  return { ref, fileName, setFileName, progress, setProgress, open: () => ref.current?.click(), clear: () => ref.current && (ref.current.value = '') };
}

/* ------------------------------------------------------------ league */

export function LeagueSnapshotSheet({
  open,
  teamId,
  computed,
  onClose,
  onSaved,
}: {
  open: boolean;
  teamId: string;
  computed?: LeagueRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const pk = usePicker();
  const [rows, setRows] = useState<DraftLeagueRow[] | null>(null);
  const [warning, setWarning] = useState('');
  const [takenOn, setTakenOn] = useState(today());
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setRows(null);
    setWarning('');
    setError(null);
    setDone(false);
    setTakenOn(today());
    pk.setFileName('');
    pk.clear();
  }
  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    reset();
    pk.setFileName(file.name);
    setBusy('reading');
    try {
      const r = await readLeagueTableFile(file, pk.setProgress);
      setRows(orientWithComputed(r.rows, computed));
      setWarning(r.warning);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
      pk.setProgress('');
    }
  }

  const edit = (key: string, patch: Partial<DraftLeagueRow>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const chosen = (rows ?? []).filter((r) => r.include && r.name.trim());

  async function save() {
    setBusy('saving');
    setError(null);
    try {
      await saveLeagueSnapshot(teamId, chosen, takenOn);
      setDone(true);
      setRows(null);
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <BottomSheet open={open} onClose={close} title="עדכון הטבלה מצילום מסך">
      <div className="ip-form ip-form--sheet">
        <input ref={pk.ref} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} />
        {done ? (
          <>
            <p className="ip-success" role="status">
              הטבלה נשמרה. היא מופיעה בעמוד הקבוצה, מסומנת כ"מצילום מסך", ליד הטבלה שמחושבת מתוצאות ההתאחדות.
            </p>
            <Button variant="primary" block onClick={close}>
              סיום
            </Button>
          </>
        ) : !rows ? (
          <>
            <p className="ip-muted">
              צלמו מסך של טבלת הליגה (למשל באתר ההתאחדות, בדפדפן שלכם) או בחרו PDF / אקסל. הקובץ נקרא בטלפון עצמו, בחינם, ותוכלו לבדוק ולתקן כל שורה לפני השמירה. הטבלה מצילום לא משנה את הטבלה שמחושבת מהתוצאות; היא מוצגת לידה.
            </p>
            <Button variant="primary" icon="photo" block disabled={!!busy} onClick={pk.open}>
              {busy === 'reading' ? `קוראים את ${pk.fileName || 'הקובץ'}…` : 'בחירת צילום מסך או קובץ'}
            </Button>
            {busy === 'reading' && <p className="ip-muted" role="status">{pk.progress || 'קוראים…'} מתמונה זה יכול לקחת עד דקה.</p>}
            <Err error={error} />
          </>
        ) : (
          <>
            <p className="ip-muted">
              מצאנו {rows.length} קבוצות. בדקו שם, משחקים, נ-ת-ה, שערים ונקודות. שורה עם סימן ⚠ כדאי לבדוק במיוחד.
            </p>
            {warning && <p className="ip-muted">{warning}</p>}
            <label className="ip-field">
              <span className="ip-field-label">מתי צולמה הטבלה</span>
              <input className="ip-input" type="date" dir="ltr" value={takenOn} max={today()} onChange={(e) => setTakenOn(e.target.value)} />
            </label>
            <div className="ip-stack ip-stack--tight">
              {rows.map((r) => (
                <LeagueDraftRow key={r.key} r={r} onChange={(p) => edit(r.key, p)} />
              ))}
            </div>
            <Err error={error} />
            <Button variant="primary" block disabled={!!busy || chosen.length < 2 || !takenOn} onClick={() => void save()}>
              {busy === 'saving' ? 'שומרים…' : `שמירת הטבלה (${chosen.length} קבוצות)`}
            </Button>
            <Button variant="ghost" block disabled={!!busy} onClick={reset}>
              קובץ אחר
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

const numVal = (v: number | null) => (v == null ? '' : String(v));
const toNum = (s: string): number | null => (s.trim() === '' || Number.isNaN(+s) ? null : Math.max(0, Math.min(999, Math.round(+s))));

function LeagueDraftRow({ r, onChange }: { r: DraftLeagueRow; onChange: (p: Partial<DraftLeagueRow>) => void }) {
  const num = (field: keyof DraftLeagueRow, label: string) => (
    <label className="ip-snap-num">
      <span>{label}</span>
      <input
        className="ip-input"
        inputMode="numeric"
        dir="ltr"
        aria-label={label}
        value={numVal(r[field] as number | null)}
        onChange={(e) => onChange({ [field]: toNum(e.target.value) } as Partial<DraftLeagueRow>)}
      />
    </label>
  );
  return (
    <div className="ip-card ip-card--default ip-card--padded" style={{ opacity: r.include ? 1 : 0.6 }}>
      <label className="ip-check">
        <input type="checkbox" checked={r.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <strong>
          {r.pos}. {r.name || 'קבוצה'}
        </strong>
        {r.doubt && <Tag tone="warning">⚠ לבדוק</Tag>}
      </label>
      {r.include && (
        <div className="ip-stack ip-stack--tight">
          {r.doubt && <p className="ip-muted">{r.doubt}</p>}
          <div className="ip-field-row">
            <input className="ip-input ip-snap-pos" inputMode="numeric" dir="ltr" aria-label="מקום" value={r.pos || ''} onChange={(e) => onChange({ pos: toNum(e.target.value) ?? 0 })} />
            <input className="ip-input" aria-label="שם הקבוצה" value={r.name} onChange={(e) => onChange({ name: e.target.value.slice(0, 60) })} />
          </div>
          <div className="ip-snap-nums">
            {num('played', 'מש׳')}
            {num('won', 'נ׳')}
            {num('drawn', 'ת׳')}
            {num('lost', 'ה׳')}
            {num('goals_for', 'זכות')}
            {num('goals_against', 'חובה')}
            {num('points', 'נק׳')}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ roster */

export function RosterFromFileSheet({
  open,
  teamId,
  teamName,
  roster,
  onClose,
  onDone,
}: {
  open: boolean;
  teamId: string;
  teamName: string;
  roster: Player[];
  onClose: () => void;
  onDone: () => void;
}) {
  const pk = usePicker();
  const [cmp, setCmp] = useState<RosterCompare | null>(null);
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; removed: number; failed: string[] } | null>(null);

  function reset() {
    setCmp(null);
    setWarning('');
    setError(null);
    setResult(null);
    pk.setFileName('');
    pk.clear();
  }
  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    reset();
    pk.setFileName(file.name);
    setBusy('reading');
    try {
      const r = await readRosterFile(file, teamName, pk.setProgress);
      setCmp(compareRoster(r.players, roster));
      setWarning(r.warning);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
      pk.setProgress('');
    }
  }

  const toAdd = cmp?.added.filter((p) => p.include && p.name.trim()) ?? [];
  const toRemove = cmp?.missing.filter((p) => p.include) ?? [];

  async function apply() {
    if (toRemove.length && !window.confirm(`להוציא ${toRemove.length} שחקנים מהקבוצה? ההיסטוריה שלהם נשמרת.`)) return;
    setBusy('saving');
    setError(null);
    const failed: string[] = [];
    let added = 0;
    let removed = 0;
    // a shirt number already taken in the team is left empty (numbers are unique per team)
    const taken = new Set(roster.filter((r) => !toRemove.some((x) => x.id === r.id)).map((r) => r.shirt_number).filter((n) => n != null));
    for (const p of toAdd) {
      const { first, last } = splitName(p.name);
      const number = p.shirt != null && !taken.has(p.shirt) ? p.shirt : null;
      if (number != null) taken.add(number);
      try {
        await addPlayer(teamId, { first: first.slice(0, 40), last: last.slice(0, 40), number, position: p.position, birthYear: p.birth_year });
        added++;
      } catch (e) {
        failed.push(`${p.name}: ${friendlyError(e)}`);
      }
    }
    for (const p of toRemove) {
      try {
        await endAssignment(p.id, teamId, 'לא מופיע בסגל מצילום מסך (אושר בצוות)');
        removed++;
      } catch (e) {
        failed.push(`${fullName(p)}: ${friendlyError(e)}`);
      }
    }
    setBusy('');
    setResult({ added, removed, failed });
    setCmp(null);
    if (added || removed) onDone();
  }

  return (
    <BottomSheet open={open} onClose={close} title="עדכון הסגל מצילום מסך">
      <div className="ip-form ip-form--sheet">
        <input ref={pk.ref} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} />
        {result ? (
          <>
            <p className="ip-success" role="status">
              {result.added || result.removed
                ? `הסגל עודכן: ${result.added} נוספו, ${result.removed} הוצאו.`
                : 'לא בוצע שינוי בסגל.'}
            </p>
            {result.failed.length > 0 && (
              <p className="ip-error" role="alert">
                לא הצליח: {result.failed.join(' · ')}
              </p>
            )}
            <Button variant="primary" block onClick={close}>
              סיום
            </Button>
          </>
        ) : !cmp ? (
          <>
            <p className="ip-muted">
              צלמו מסך של רשימת השחקנים (למשל עמוד הסגל באתר ההתאחדות, בדפדפן שלכם) או בחרו PDF / אקסל. נשווה לסגל של {teamName} ונציג מי חדש ומי לא מופיע. שום דבר לא משתנה עד שתאשרו.
            </p>
            <Button variant="primary" icon="photo" block disabled={!!busy} onClick={pk.open}>
              {busy === 'reading' ? `קוראים את ${pk.fileName || 'הקובץ'}…` : 'בחירת צילום מסך או קובץ'}
            </Button>
            {busy === 'reading' && <p className="ip-muted" role="status">{pk.progress || 'קוראים…'} מתמונה זה יכול לקחת עד דקה.</p>}
            <Err error={error} />
          </>
        ) : (
          <>
            <p className="ip-muted">
              בקובץ {cmp.added.length + cmp.same.length} שחקנים: {cmp.same.length} כבר בסגל, {cmp.added.length} חדשים. {cmp.missing.length} שחקנים מהסגל לא מופיעים בקובץ.
            </p>
            {warning && <p className="ip-muted">{warning}</p>}

            {cmp.added.length > 0 && (
              <div className="ip-stack ip-stack--tight">
                <strong>חדשים להוספה</strong>
                {cmp.added.map((p) => (
                  <div key={p.key} className="ip-card ip-card--default ip-card--padded" style={{ opacity: p.include ? 1 : 0.6 }}>
                    <label className="ip-check">
                      <input
                        type="checkbox"
                        checked={p.include}
                        onChange={(e) => setCmp((c) => c && { ...c, added: c.added.map((x) => (x.key === p.key ? { ...x, include: e.target.checked } : x)) })}
                      />
                      <strong>{p.name || 'שחקן'}</strong>
                      {p.birth_year && <Tag>שנתון {p.birth_year}</Tag>}
                      {p.shirt != null && <Tag>#{p.shirt}</Tag>}
                    </label>
                    {p.include && (
                      <input
                        className="ip-input"
                        aria-label="שם מלא"
                        value={p.name}
                        onChange={(e) => setCmp((c) => c && { ...c, added: c.added.map((x) => (x.key === p.key ? { ...x, name: e.target.value.slice(0, 60) } : x)) })}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {cmp.missing.length > 0 && (
              <div className="ip-stack ip-stack--tight">
                <strong>בסגל אבל לא בקובץ</strong>
                <p className="ip-muted">ייתכן שעזבו, וייתכן שהם פשוט לא נכנסו לצילום. סמנו רק את מי שבאמת צריך להוציא; ההיסטוריה שלהם נשמרת.</p>
                {cmp.missing.map((p) => (
                  <label key={p.id} className="ip-check ip-card ip-card--default ip-card--padded">
                    <input
                      type="checkbox"
                      checked={p.include}
                      onChange={(e) => setCmp((c) => c && { ...c, missing: c.missing.map((x) => (x.id === p.id ? { ...x, include: e.target.checked } : x)) })}
                    />
                    <span>להוציא את {fullName(p)}</span>
                  </label>
                ))}
              </div>
            )}

            {cmp.same.length > 0 && (
              <details>
                <summary className="ip-muted">כבר בסגל · {cmp.same.length}</summary>
                <p className="ip-muted">{cmp.same.map((s) => fullName(s.player)).join(' · ')}</p>
              </details>
            )}

            <Err error={error} />
            <Button variant="primary" block disabled={!!busy || toAdd.length + toRemove.length === 0} onClick={() => void apply()}>
              {busy === 'saving'
                ? 'מעדכנים…'
                : toAdd.length + toRemove.length === 0
                  ? 'אין מה לעדכן'
                  : `עדכון הסגל (${[toAdd.length && `${toAdd.length} להוספה`, toRemove.length && `${toRemove.length} להוצאה`].filter(Boolean).join(', ')})`}
            </Button>
            <Button variant="ghost" block disabled={!!busy} onClick={reset}>
              קובץ אחר
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
