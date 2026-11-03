/**
 * Career page: the child's numbers on the IFA site.
 * A link opens the child's IFA player page (or the team page); the parent saves
 * a screenshot or PDF of it and loads it here. The file is read in the browser
 * (free, no AI), the parent checks every number, and the season is saved.
 * Shown next to the self-reported numbers, never added to them.
 */
import '../theme/career.css';
import '../theme/coach.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { BottomSheet } from '../components/shell';
import { Button, Card, SectionHeader } from '../components/ui';
import { Err, Field } from '../components/form';
import { IfaUpdateIcon, UploadIntro } from '../components/IfaSteps';
import { friendlyError } from '../lib/api';
import {
  currentSeason,
  getIfaLinks,
  getIfaStats,
  readIfaStatsFile,
  removeIfaStats,
  saveIfaStats,
  STAT_FIELDS,
  statLabel,
  type IfaLinks,
  type IfaStatsRow,
  type StatValues,
} from '../lib/ifaStats';
import { ACCEPT, ScheduleReadError } from '../lib/scheduleImport';

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });

export function IfaStatsSection({ playerId, name, teamName }: { playerId: string; name: string; teamName?: string }) {
  const [links, setLinks] = useState<IfaLinks | null>(null);
  const [rows, setRows] = useState<IfaStatsRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([getIfaLinks(playerId), getIfaStats(playerId)]);
      setLinks(l);
      setRows(r);
    } catch {
      setLinks(null); // not allowed, or the migration is not installed: hidden
    }
  }, [playerId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!links || rows === null) return null;
  if (!rows.length && !links.can_edit && !links.player_url && !links.team_url) return null;

  async function remove(id: string) {
    if (!window.confirm('למחוק את נתוני העונה הזו?')) return;
    try {
      await removeIfaStats(id);
      await load();
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const url = links.player_url ?? links.team_url;
  return (
    <section>
      <SectionHeader
        title="לפי ההתאחדות (מקובץ)"
        icon="shield"
        extra={links.can_edit ? <IfaUpdateIcon label="עדכון נתוני השחקן מההתאחדות" onClick={() => setLoading(true)} /> : undefined}
      />
      <Card>
        {rows.length === 0 ? (
          <p className="ip-muted">עוד לא נטענו נתונים מההתאחדות.</p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="ip-stack ip-stack--tight">
              <strong>
                עונת {r.season}
                {r.team_name ? ` · ${r.team_name}` : ''}
              </strong>
              <div className="ip-self-totals">
                {STAT_FIELDS.filter((f) => r[f] != null).map((f) => (
                  <div key={f}>
                    <strong>{r[f]}</strong>
                    <span>{statLabel[f]}</span>
                  </div>
                ))}
              </div>
              <span className="ip-list-row-sub">
                נטען מקובץ ב-{dateLabel(r.uploaded_at)}
                {links.can_edit && (
                  <>
                    {' · '}
                    <button type="button" className="ip-link" onClick={() => void remove(r.id)}>
                      מחיקה
                    </button>
                  </>
                )}
              </span>
            </div>
          ))
        )}
        <Err error={error} />
        <div className="ip-btn-row">
          {url && (
            <a className="ip-btn ip-btn--secondary ip-btn--sm" href={url} target="_blank" rel="noopener noreferrer">
              <Icon name="eye" size={18} />
              <span>{links.player_url ? `הכרטיס של ${name} באתר ההתאחדות` : 'דף הקבוצה באתר ההתאחדות'}</span>
            </a>
          )}
          {links.can_edit && (
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setLoading(true)}>
              טעינת צילום / PDF
            </Button>
          )}
        </div>
        <p className="ip-footnote">
          {links.can_edit
            ? 'פותחים את הדף באתר ההתאחדות, מצלמים מסך או שומרים כ-PDF, וטוענים כאן. הקובץ נקרא בטלפון ותוכלו לתקן כל מספר לפני השמירה. '
            : ''}
          המספרים מוצגים בנפרד מהדיווח העצמי ולא מתחברים אליו.
        </p>
      </Card>
      {links.can_edit && (
        <LoadSheet
          open={loading}
          playerId={playerId}
          teamName={teamName ?? ''}
          ifaUrl={url}
          ifaUrlLabel={links.player_url ? `הכרטיס של ${name}` : 'דף הקבוצה'}
          onClose={() => setLoading(false)}
          onSaved={load}
        />
      )}
    </section>
  );
}

function LoadSheet({
  open,
  playerId,
  teamName,
  ifaUrl,
  ifaUrlLabel,
  onClose,
  onSaved,
}: {
  open: boolean;
  playerId: string;
  teamName: string;
  ifaUrl?: string | null;
  ifaUrlLabel: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const playerLinks = useMemo(() => (ifaUrl ? [{ label: ifaUrlLabel, href: ifaUrl }] : undefined), [ifaUrl, ifaUrlLabel]);
  const [values, setValues] = useState<StatValues | null>(null);
  const [season, setSeason] = useState(currentSeason());
  const [team, setTeam] = useState(teamName);
  const [fileName, setFileName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setValues(null);
    setNote('');
    setError(null);
    setSeason(currentSeason());
    setTeam(teamName);
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
      const r = await readIfaStatsFile(file, setProgress);
      setValues(r.values);
      if (r.season) setSeason(r.season);
      setNote(
        r.found === 0
          ? 'לא זיהינו מספרים בקובץ. אפשר למלא אותם ידנית לפי הדף.'
          : r.fromImage
            ? 'הנתונים זוהו מתמונה וייתכנו טעויות. השוו לדף ההתאחדות ותקנו לפני השמירה.'
            : 'בדקו שהמספרים תואמים לדף ההתאחדות.',
      );
    } catch (e) {
      setError(e instanceof ScheduleReadError ? e.message : friendlyError(e));
    } finally {
      setBusy('');
      setProgress('');
    }
  }

  async function save() {
    if (!values) return;
    setBusy('saving');
    setError(null);
    try {
      await saveIfaStats(playerId, season, team, values, fileName);
      await onSaved();
      reset();
      onClose();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? '';
      setError(msg.includes('season must') ? 'עונה בפורמט 2026/27.' : friendlyError(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <BottomSheet open={open} onClose={close} title="נתונים מההתאחדות">
      <div className="ip-form ip-form--sheet">
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files?.[0])} />
        {!values ? (
          <>
            <UploadIntro
              kind="player"
              links={playerLinks}
              busy={busy === 'reading'}
              progress={progress}
              fileName={fileName}
              onPick={() => fileRef.current?.click()}
              fallback="בחרו צילום מסך או PDF של כרטיס השחקן באתר ההתאחדות."
            />
            <Button variant="ghost" block disabled={!!busy} onClick={() => setValues({})}>
              מילוי ידני
            </Button>
          </>
        ) : (
          <>
            {note && <p className="ip-muted">{note}</p>}
            <div className="ip-field-row">
              <Field label="עונה">
                <input className="ip-input" dir="ltr" value={season} onChange={(e) => setSeason(e.target.value.trim())} placeholder="2026/27" />
              </Field>
              <Field label="קבוצה">
                <input className="ip-input" value={team} onChange={(e) => setTeam(e.target.value.slice(0, 80))} />
              </Field>
            </div>
            <div className="ip-field-row" style={{ flexWrap: 'wrap' }}>
              {STAT_FIELDS.map((f) => (
                <Field key={f} label={statLabel[f]}>
                  <input
                    className="ip-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    dir="ltr"
                    value={values[f] ?? ''}
                    onChange={(e) => setValues({ ...values, [f]: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
                  />
                </Field>
              ))}
            </div>
            <Err error={error} />
            <Button variant="primary" block disabled={!!busy || !/^\d{4}\/\d{2}$/.test(season)} onClick={() => void save()}>
              {busy === 'saving' ? 'שומרים…' : 'שמירה'}
            </Button>
            <Button variant="ghost" block disabled={!!busy} onClick={reset}>
              קובץ אחר
            </Button>
          </>
        )}
        {!values && <Err error={error} />}
      </div>
    </BottomSheet>
  );
}
