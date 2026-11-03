/**
 * #ifa — Super Admin: import IFA teams and rosters from saved pages, and see
 * every sync run (time, counts, errors). There is no live sync: the IFA site
 * blocks server requests, and we don't get around that.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, SectionHeader, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  getSyncOverview,
  getSyncRuns,
  isPlatformAdmin,
  parseRosterHtml,
  saveIfaCoaches,
  syncIfaRoster,
  type ParsedRoster,
  type RosterSyncResult,
  type SyncedTeam,
  type SyncRun,
} from '../lib/ifaApi';
import { IfaGamesAdmin, PushControl } from './IfaGamesAdmin';
import { IfaAgentAdmin, RosterCheck } from './IfaAgentAdmin';
import '../theme/club.css';
import '../theme/coach.css';

const runStatus: Record<string, { label: string; tone: 'lime' | 'warning' | 'live' | 'neutral' }> = {
  ok: { label: 'תקין', tone: 'lime' },
  partial: { label: 'חלקי', tone: 'warning' },
  failed: { label: 'נכשל', tone: 'live' },
  skipped: { label: 'דולג', tone: 'neutral' },
  dry_run: { label: 'בדיקה', tone: 'neutral' },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

export function IfaAdminScreen({ onBack }: { onBack: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [fileName, setFileName] = useState('');
  const [form, setForm] = useState({ teamId: '', seasonId: '', teamName: '' });
  const [check, setCheck] = useState<RosterSyncResult | null>(null);
  const [result, setResult] = useState<RosterSyncResult | null>(null);
  const [allowDrop, setAllowDrop] = useState(false);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [teams, setTeams] = useState<SyncedTeam[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([getSyncRuns(), getSyncOverview()]);
      setRuns(r);
      setTeams(t);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, []);

  useEffect(() => {
    void isPlatformAdmin().then((ok) => {
      setAllowed(ok);
      if (ok) void loadLog();
    });
  }, [loadLog]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setCheck(null);
    setAllowDrop(false);
    setError(null);
    if (!file) return;
    setFileName(file.name);
    const p = parseRosterHtml(await file.text());
    setParsed(p);
    setForm({ teamId: p.teamId ? String(p.teamId) : '', seasonId: p.seasonId ? String(p.seasonId) : '', teamName: p.teamName ?? '' });
  }

  // dry run first, then apply the same payload; nothing is ever deleted
  async function runSync(apply: boolean) {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const teamId = Number(form.teamId);
      const seasonId = Number(form.seasonId);
      const r = await syncIfaRoster(
        {
          teamId,
          seasonId,
          teamName: form.teamName.trim(),
          sourceUrl: `saved-page:${fileName} (https://www.football.org.il/team-details/?team_id=${teamId}&season_id=${seasonId})`,
          players: parsed.players,
          allowLargeDrop: allowDrop,
        },
        apply,
      );
      if (apply) {
        if (r.ok && parsed.coaches.length) await saveIfaCoaches(seasonId, teamId, parsed.coaches);
        setResult(r);
        setCheck(null);
      } else {
        setCheck(r);
        setResult(null);
      }
      await loadLog();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function editForm(next: typeof form) {
    setForm(next);
    setCheck(null);
  }

  const ready = parsed && parsed.players.length > 0 && /^\d+$/.test(form.teamId) && /^\d+$/.test(form.seasonId) && form.teamName.trim().length > 0;

  return (
    <div className="ip-stack">
      <div className="ip-backbar">
        <button type="button" className="ip-icon-btn ip-icon-btn--soft" aria-label="חזרה" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <h1>נתוני ההתאחדות</h1>
        <span />
      </div>

      {allowed === null ? (
        <p className="ip-muted">טוען…</p>
      ) : !allowed ? (
        <EmptyState icon="shield" title="למנהל המערכת בלבד" text="המסך הזה פתוח רק למנהלי iplays." />
      ) : (
        <>
          <Card className="ip-find-sent">
            <Tag tone="warning" icon="clock">אין סנכרון חי</Tag>
            <p>
              אתר ההתאחדות חוסם בקשות משרתים (403), ולכן אין משיכה אוטומטית. הייבוא כאן עובד מדפי סגל ומשחקים ששמרת בדפדפן. הצלחה כאן לא אומרת שסנכרון מול האתר החי עובד.
            </p>
          </Card>

          <section>
            <SectionHeader title="ייבוא סגל מדף שמור" icon="plus" />
            <Card>
              <div className="ip-form">
                <Field label="קובץ HTML של דף הסגל (Ctrl+S בדף הקבוצה)">
                  <input id="ifa-file" className="ip-input" type="file" accept=".html,.htm,text/html" onChange={(e) => void onFile(e)} />
                </Field>
                {parsed && (
                  <>
                    <div className="ip-field-row">
                      <Field label="מזהה קבוצה בהתאחדות">
                        <input id="ifa-team" className="ip-input" dir="ltr" inputMode="numeric" value={form.teamId} onChange={(e) => editForm({ ...form, teamId: e.target.value.replace(/\D/g, '') })} />
                      </Field>
                      <Field label="מזהה עונה">
                        <input id="ifa-season" className="ip-input" dir="ltr" inputMode="numeric" value={form.seasonId} onChange={(e) => editForm({ ...form, seasonId: e.target.value.replace(/\D/g, '') })} />
                      </Field>
                    </div>
                    <Field label="שם הקבוצה (מכותרת הדף)">
                      <input id="ifa-name" className="ip-input" value={form.teamName} onChange={(e) => editForm({ ...form, teamName: e.target.value.slice(0, 60) })} />
                    </Field>
                    <p className="ip-muted">
                      נמצאו <strong>{parsed.players.length}</strong> שחקנים ב-#teamPlayers. {parsed.staffSkipped} בעלי תפקידים ב-#teamStaff לא נכללו.
                    </p>
                    {parsed.problems.length > 0 && (
                      <ul className="ip-ifa-problems">
                        {parsed.problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {parsed.players.length > 0 && (
                      <ol className="ip-ifa-names">
                        {parsed.players.map((p) => (
                          <li key={p.ifa_player_id}>
                            {p.name} <span className="ip-muted" dir="ltr">#{p.ifa_player_id}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <p className="ip-footnote">
                      נשמרים רק מזהה, שם כפי שכתוב בדף וקישור לפרופיל. לא נשמרות תמונות, והשם לא מפוצל לשם פרטי ושם משפחה. ילד שאף הורה לא אישר לא יופיע בחיפוש הפתוח.
                    </p>
                    <Button variant="secondary" block disabled={!ready || busy} onClick={() => void runSync(false)}>
                      {busy && !check ? 'בודקים…' : 'בדיקה: מה ישתנה'}
                    </Button>
                    {check && <RosterCheck r={check} />}
                    {check && !check.ok && check.error?.startsWith('roster dropped') && (
                      <label className="ip-check">
                        <input type="checkbox" checked={allowDrop} onChange={(e) => { setAllowDrop(e.target.checked); setCheck(null); }} />
                        <span>בדקתי את הדף באתר, והסגל באמת קטן. לבדוק שוב עם אישור לירידה.</span>
                      </label>
                    )}
                    {check?.ok && (
                      <Button variant="primary" block disabled={busy} onClick={() => void runSync(true)}>
                        {busy ? 'מייבאים…' : 'ייבוא השינויים'}
                      </Button>
                    )}
                  </>
                )}
                <Err error={error} />
                {result && (
                  <div className="ip-find-sent">
                    <Tag tone={result.errors?.length ? 'warning' : 'lime'} icon="check">
                      {result.errors?.length ? 'יובא עם שגיאות' : 'יובא'}
                    </Tag>
                    <p>
                      {result.summary?.players_in_payload ?? 0} שחקנים בסגל. {result.summary?.added ?? 0} נוספו, {result.summary?.missing ?? 0} סומנו כלא מופיעים
                      (לא נמחקו), {result.summary?.returned ?? 0} חזרו, {result.summary?.renamed ?? 0} שינויי שם.
                      {result.errors?.length ? ` ${result.errors.length} שגיאות, ראו ביומן.` : ''}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </section>

          <IfaAgentAdmin onChanged={() => void loadLog()} />
          <IfaGamesAdmin onImported={() => void loadLog()} />
          <PushControl />

          <section>
            <SectionHeader title="קבוצות שיובאו" icon="team" />
            {teams.length === 0 ? (
              <p className="ip-muted">עוד לא יובאו קבוצות.</p>
            ) : (
              <Card padded={false}>
                {teams.map((t) => (
                  <a key={`${t.ifa_season_id}-${t.ifa_team_id}`} className="ip-club-row ip-dash-match" href={t.team_id ? `#t/${t.team_id}` : undefined}>
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">{t.name}</span>
                      <span className="ip-list-row-sub" dir="rtl">
                        קבוצה {t.ifa_team_id} · עונה {t.ifa_season_id} · {t.players} שחקנים · סנכרון אחרון {fmt(t.synced_at)}
                      </span>
                    </span>
                  </a>
                ))}
              </Card>
            )}
          </section>

          <section>
            <SectionHeader title="יומן סנכרונים" icon="clock" />
            {runs.length === 0 ? (
              <p className="ip-muted">אין עדיין הרצות.</p>
            ) : (
              <Card padded={false}>
                {runs.map((r) => (
                  <div key={r.id} className="ip-club-row">
                    <span className="ip-list-row-text">
                      <span className="ip-list-row-title">
                        {r.kind === 'games' ? 'משחקים' : 'סגל'}
                        {r.counts.ifa_team_id ? ` · קבוצה ${String(r.counts.ifa_team_id)}` : r.counts.ifa_league_id ? ` · ליגה ${String(r.counts.ifa_league_id)}` : ''} · {fmt(r.created_at)}
                      </span>
                      <span className="ip-list-row-sub">
                        {r.kind === 'games'
                          ? `${String(r.counts.new ?? 0)} חדשים · ${String(r.counts.changed ?? 0)} שינויים · ${String(r.counts.queued ?? 0)} התראות`
                          : r.kind === 'roster'
                            ? `${String(r.counts.players_in_payload ?? 0)} בדף · ${String(r.counts.added ?? 0)} נוספו · ${String(r.counts.missing ?? 0)} לא מופיעים · ${String(r.counts.returned ?? 0)} חזרו · ${String(r.counts.renamed ?? 0)} שינויי שם`
                            : `${String(r.counts.players_seen ?? 0)} בסגל · ${String(r.counts.new_players ?? 0)} חדשים`}
                        {r.errors.length > 0 && ` · ${r.errors.map((x) => x.error).join('; ')}`}
                      </span>
                    </span>
                    {(() => {
                      const st = runStatus[r.status ?? (r.errors.length ? 'partial' : 'ok')] ?? runStatus.ok;
                      return <Tag tone={st.tone}>{r.errors.length && st.tone !== 'live' ? `${st.label} · ${r.errors.length} שגיאות` : st.label}</Tag>;
                    })()}
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
