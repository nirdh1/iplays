/**
 * "טעינת לוח משחקים מקובץ": pick a screenshot / photo, PDF, Excel or CSV of the
 * team's schedule, review and fix every game, then save the chosen ones.
 * Staff and any member of the team (a parent too) can use it.
 */
import { useRef, useState } from 'react';
import { BottomSheet } from '../components/shell';
import { Button, Tag } from '../components/ui';
import { Err } from '../components/form';
import { friendlyError } from '../lib/api';
import { competitionLabel, type Competition, type Match } from '../lib/matchApi';
import { ACCEPT, importGames, markDuplicates, readScheduleFile, ScheduleReadError, type DraftGame } from '../lib/scheduleImport';
import { IfaSteps } from '../components/IfaSteps';
import '../theme/coach.css';

export function ScheduleImportSheet({
  open,
  teamId,
  teamName,
  existing,
  onClose,
  onDone,
}: {
  open: boolean;
  teamId: string;
  teamName: string;
  existing: Match[];
  onClose: () => void;
  onDone: (added: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [games, setGames] = useState<DraftGame[] | null>(null);
  const [warning, setWarning] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  function reset() {
    setGames(null);
    setWarning('');
    setFileName('');
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy('reading');
    try {
      const r = await readScheduleFile(file, teamName, setProgress);
      setGames(markDuplicates(r.games, existing));
      setWarning(r.warning);
      if (r.games.length === 0) setError(`לא מצאנו בקובץ משחקים של ${teamName}.`);
    } catch (e) {
      setError(e instanceof ScheduleReadError ? e.message : friendlyError(e));
    } finally {
      setBusy('');
      setProgress('');
    }
  }

  const edit = (key: string, patch: Partial<DraftGame>) => setGames((gs) => gs?.map((g) => (g.key === key ? { ...g, ...patch } : g)) ?? null);
  const chosen = (games ?? []).filter((g) => g.include && g.opponent.trim() && g.date);

  async function save() {
    setBusy('saving');
    setError(null);
    try {
      const r = await importGames(teamId, chosen);
      setResult(r);
      setGames(null);
      onDone(r.added);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <BottomSheet open={open} onClose={close} title="טעינת לוח משחקים מקובץ">
      <div className="ip-form ip-form--sheet">
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} />

        {result ? (
          <>
            <p className="ip-success" role="status">
              נוספו {result.added} משחקים ללוח של {teamName}.
              {result.skipped > 0 && ` ${result.skipped} כבר היו בלוח ודולגו.`}
            </p>
            <Button variant="secondary" block onClick={reset}>
              טעינת קובץ נוסף
            </Button>
            <Button variant="primary" block onClick={close}>
              סיום
            </Button>
          </>
        ) : !games ? (
          <>
            <IfaSteps teamId={teamId} kind="games" />
            <p className="ip-muted">
              צלמו מסך של לוח המשחקים (למשל מאתר ההתאחדות), או בחרו קובץ PDF, אקסל או CSV. הקובץ נקרא בטלפון עצמו, בחינם. נציג את המשחקים של {teamName} ותוכלו לבדוק ולתקן לפני השמירה. צילום מסך חד וישר נקרא הכי טוב.
            </p>
            <Button variant="primary" icon="plus" block disabled={!!busy} onClick={() => fileRef.current?.click()}>
              {busy === 'reading' ? `קוראים את ${fileName || 'הקובץ'}…` : 'בחירת תמונה או קובץ'}
            </Button>
            {busy === 'reading' && <p className="ip-muted" role="status">{progress || 'קוראים…'} מתמונה זה יכול לקחת עד דקה.</p>}
          </>
        ) : (
          <>
            <p className="ip-muted">
              מצאנו {games.length} משחקים ב{fileName ? `־${fileName}` : 'קובץ'}. בדקו תאריך, שעה ויריבה. משחק בלי שעה יופיע כ"שעה טרם נקבעה".
            </p>
            {warning && <p className="ip-muted">{warning}</p>}
            <div className="ip-stack ip-stack--tight">
              {games.map((g) => (
                <GameRow key={g.key} g={g} onChange={(p) => edit(g.key, p)} />
              ))}
            </div>
            <Err error={error} />
            <Button variant="primary" block disabled={!!busy || chosen.length === 0} onClick={() => void save()}>
              {busy === 'saving' ? 'שומרים…' : `הוספת ${chosen.length} משחקים ללוח`}
            </Button>
            <Button variant="ghost" block disabled={!!busy} onClick={reset}>
              קובץ אחר
            </Button>
          </>
        )}
        {!games && <Err error={error} />}
      </div>
    </BottomSheet>
  );
}

function GameRow({ g, onChange }: { g: DraftGame; onChange: (p: Partial<DraftGame>) => void }) {
  return (
    <div className="ip-card ip-card--default ip-card--padded" style={{ opacity: g.include ? 1 : 0.6 }}>
      <label className="ip-check">
        <input type="checkbox" checked={g.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <strong>{g.opponent || 'יריבה'}</strong>
        {g.round && <Tag>{/^\d+$/.test(g.round) ? `מחזור ${g.round}` : g.round}</Tag>}
        {g.duplicate && <Tag tone="warning">כבר בלוח</Tag>}
      </label>
      {g.include && (
        <div className="ip-stack ip-stack--tight">
          <div className="ip-field-row">
            <input className="ip-input" type="date" dir="ltr" aria-label="תאריך" value={g.date} onChange={(e) => onChange({ date: e.target.value })} />
            <input className="ip-input" type="time" dir="ltr" aria-label="שעה" value={g.time} onChange={(e) => onChange({ time: e.target.value })} />
          </div>
          <input className="ip-input" aria-label="יריבה" value={g.opponent} onChange={(e) => onChange({ opponent: e.target.value.slice(0, 60) })} placeholder="יריבה" />
          <div className="ip-field-row">
            <select className="ip-input" aria-label="בית או חוץ" value={g.home ? 'home' : 'away'} onChange={(e) => onChange({ home: e.target.value === 'home' })}>
              <option value="home">בית</option>
              <option value="away">חוץ</option>
            </select>
            <select className="ip-input" aria-label="סוג" value={g.competition} onChange={(e) => onChange({ competition: e.target.value as Competition })}>
              {(Object.keys(competitionLabel) as Competition[]).map((c) => (
                <option key={c} value={c}>
                  {competitionLabel[c]}
                </option>
              ))}
            </select>
          </div>
          <input className="ip-input" aria-label="מגרש" value={g.venue} onChange={(e) => onChange({ venue: e.target.value.slice(0, 80) })} placeholder="מגרש / אולם (לא חובה)" />
        </div>
      )}
    </div>
  );
}
