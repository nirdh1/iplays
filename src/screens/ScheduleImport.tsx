/**
 * "טעינת לוח משחקים מקובץ": pick a screenshot / photo, PDF, Excel or CSV of the
 * team's schedule, review and fix every game, then save the chosen ones.
 * Staff and any member of the team (a parent too) can use it.
 */
import { useEffect, useRef, useState } from 'react';
import { getTeamLeagueTable, ourRow } from '../lib/leagueApi';
import { BottomSheet } from '../components/shell';
import { Button, Tag } from '../components/ui';
import { Err } from '../components/form';
import { friendlyError } from '../lib/api';
import { competitionLabel, type Competition, type Match } from '../lib/matchApi';
import { ACCEPT, applyGameUpdates, changeLabel, importGames, markDuplicates, readScheduleFile, ScheduleReadError, type DraftGame } from '../lib/scheduleImport';
import { UploadIntro } from '../components/IfaSteps';
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
  // the team's name on the IFA site (e.g. "הפועל ר״ג צפון"), matched as well as the app name
  const [ifaName, setIfaName] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true;
    void getTeamLeagueTable(teamId)
      .then((t) => live && setIfaName((t && ourRow(t)?.name) || ''))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, teamId]);
  const [games, setGames] = useState<DraftGame[] | null>(null);
  const [warning, setWarning] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: number; updated: number; failed: number } | null>(null);

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
      const r = await readScheduleFile(file, teamName, setProgress, ifaName ? [ifaName] : []);
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
  const chosen = (games ?? []).filter((g) => !g.duplicate && g.include && g.opponent.trim() && g.date);
  const updates = (games ?? []).filter((g) => g.duplicate && g.update && g.changes?.length && g.date);
  const known = (games ?? []).filter((g) => g.duplicate);
  const unchanged = known.filter((g) => !g.changes?.length).length;
  const withChanges = known.length - unchanged;

  async function save() {
    setBusy('saving');
    setError(null);
    try {
      const u = updates.length ? await applyGameUpdates(updates) : { updated: 0, failed: 0 };
      const r = chosen.length ? await importGames(teamId, chosen) : { added: 0, skipped: 0 };
      setResult({ ...r, ...u });
      setGames(null);
      onDone(r.added + u.updated);
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
              {result.added > 0 || result.updated === 0 ? `נוספו ${result.added} משחקים ללוח של ${teamName}.` : ''}
              {result.updated > 0 && ` עודכנו ${result.updated} משחקים שכבר היו בלוח.`}
              {result.skipped > 0 && ` ${result.skipped} כבר היו בלוח ודולגו.`}
              {result.failed > 0 && ` ${result.failed} עדכונים לא נשמרו (אין הרשאה לשנות את המשחק).`}
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
            <UploadIntro
              teamId={teamId}
              kind="games"
              busy={busy === 'reading'}
              progress={progress}
              fileName={fileName}
              onPick={() => fileRef.current?.click()}
              fallback={`צלמו מסך של לוח המשחקים, או בחרו PDF, אקסל או CSV. הקובץ נקרא בטלפון, בחינם. נציג את המשחקים של ${teamName} ותוכלו לתקן לפני השמירה.`}
            />
          </>
        ) : (
          <>
            <p className="ip-muted">
              מצאנו {games.length} משחקים ב{fileName ? `־${fileName}` : 'קובץ'}. בדקו תאריך, שעה ויריבה. משחק בלי שעה יופיע כ"שעה טרם נקבעה".
            </p>
            {known.length > 0 && (
              <p className="ip-muted" role="status">
                {known.length} כבר בלוח:{' '}
                {withChanges === 0
                  ? 'אין בהם שינוי.'
                  : `${unchanged > 0 ? `${unchanged} בלי שינוי, ` : ''}ב־${withChanges} יש פרטים חדשים (מסומנים בצהוב).`}
              </p>
            )}
            {warning && <p className="ip-muted">{warning}</p>}
            <div className="ip-stack ip-stack--tight">
              {games.map((g) => (
                <GameRow key={g.key} g={g} onChange={(p) => edit(g.key, p)} />
              ))}
            </div>
            <Err error={error} />
            <Button variant="primary" block disabled={!!busy || chosen.length + updates.length === 0} onClick={() => void save()}>
              {busy === 'saving' ? 'שומרים…' : saveLabel(chosen.length, updates.length)}
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

function saveLabel(add: number, upd: number) {
  if (add && upd) return `הוספת ${add} משחקים ועדכון ${upd}`;
  if (upd) return upd === 1 ? 'עדכון משחק אחד בלוח' : `עדכון ${upd} משחקים בלוח`;
  if (!add) return 'אין מה לשמור';
  return `הוספת ${add} משחקים ללוח`;
}

const roundLabel = (r: string) => (/^\d+$/.test(r) ? `מחזור ${r}` : r);

function GameRow({ g, onChange }: { g: DraftGame; onChange: (p: Partial<DraftGame>) => void }) {
  if (g.duplicate) return <KnownGameRow g={g} onChange={onChange} />;
  return (
    <div className="ip-card ip-card--default ip-card--padded" style={{ opacity: g.include ? 1 : 0.6 }}>
      <label className="ip-check">
        <input type="checkbox" checked={g.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <strong>{g.opponent || 'יריבה'}</strong>
        {g.round && <Tag>{roundLabel(g.round)}</Tag>}
        <Tag tone="lime">חדש</Tag>
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

/** A game that is already in the schedule: "no change", or what changed (old ← new) and whether to apply it. */
function KnownGameRow({ g, onChange }: { g: DraftGame; onChange: (p: Partial<DraftGame>) => void }) {
  const changes = g.changes ?? [];
  const day = g.date.split('-').reverse().slice(0, 2).map(Number).join('.');
  return (
    <div className="ip-card ip-card--default ip-card--padded" style={{ opacity: changes.length && g.update ? 1 : 0.75 }}>
      <div className="ip-check">
        <strong>{g.opponent || 'יריבה'}</strong>
        {g.round && <Tag>{roundLabel(g.round)}</Tag>}
        {changes.length ? <Tag tone="warning">יש עדכון</Tag> : <Tag>כבר בלוח · ללא שינוי</Tag>}
      </div>
      {changes.length === 0 ? (
        <p className="ip-muted">
          {day}
          {g.time ? ` · ${g.time}` : ''}
          {g.venue ? ` · ${g.venue}` : ''}: כמו בלוח.
        </p>
      ) : (
        <div className="ip-stack ip-stack--tight">
          <ul className="ip-game-changes">
            {changes.map((c) => (
              <li key={c.field}>
                <span className="ip-muted">{changeLabel[c.field]}:</span> <s>{c.old}</s> ← <strong>{c.new}</strong>
              </li>
            ))}
          </ul>
          <label className="ip-check">
            <input type="checkbox" checked={!!g.update} onChange={(e) => onChange({ update: e.target.checked })} />
            לעדכן את המשחק בלוח
          </label>
          {g.moved && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ duplicate: false, match: undefined, changes: undefined, update: false, moved: false, include: true })}>
              זה משחק אחר? להוסיף כחדש
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
