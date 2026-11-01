/**
 * Super Admin: IFA games from a saved page (team games or league games),
 * dry run first, then import; the push sending switch and queue health.
 * Nothing here talks to the IFA site.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import { Button, Card, SectionHeader, Segmented, Tag } from '../components/ui';
import { Err, Field } from '../components/form';
import { friendlyError } from '../lib/api';
import {
  getPushMode,
  getQueueStats,
  importIfaGames,
  parseGamesHtml,
  setPushMode,
  setTeamCategory,
  type GamesImportResult,
  type ParsedGames,
  type PushMode,
} from '../lib/ifaApi';
import { changeFieldLabel, TIME_TBD, VENUE_TBD } from '../lib/matchApi';

const showDate = (ymd: string) => ymd.split('-').reverse().join('/');

export function IfaGamesAdmin({ onImported }: { onImported: () => void }) {
  const [gamesHtml, setGamesHtml] = useState<string | null>(null);
  const [leagueHtml, setLeagueHtml] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedGames | null>(null);
  const [dry, setDry] = useState<GamesImportResult | null>(null);
  const [done, setDone] = useState<GamesImportResult | null>(null);
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDry(null);
    setDone(null);
    const p = gamesHtml ? parseGamesHtml(gamesHtml, leagueHtml ?? undefined) : null;
    setParsed(p);
    // suggest the age group the league name states (e.g. "ליגת ילדים טרום ב' דן" -> "טרום ב׳"); the admin confirms
    // "טרום" first: in "ליגת ילדים טרום ב'" the age group is "טרום ב׳", not "ילדים ט"
    const name = p?.leagueName ?? '';
    const m = /(טרום [א-ת])['׳]/.exec(name) ?? /(ילדים [א-ת]|נערים [א-ת]|ילדות [א-ת]|נערות [א-ת])['׳]/.exec(name) ?? /(נוער)/.exec(name);
    if (m) setCategory(/\s[א-ת]$/.test(m[1]) ? `${m[1]}׳` : m[1]);
  }, [gamesHtml, leagueHtml]);

  const read = (set: (s: string | null) => void) => async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    set(f ? await f.text() : null);
  };

  async function run(apply: boolean) {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importIfaGames(parsed, apply);
      if (apply) {
        setDone(r);
        onImported();
      } else setDry(r);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory() {
    if (!parsed?.seasonId || !parsed.teamId) return;
    try {
      setLabel(await setTeamCategory(parsed.seasonId, parsed.teamId, category));
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const ok = parsed && parsed.seasonId && parsed.games.length > 0;

  return (
    <section>
      <SectionHeader title="ייבוא משחקים מדף שמור" icon="calendar" />
      <Card>
        <div className="ip-form">
          <Field label='דף "כל משחקי קבוצה" או דף משחקי ליגה (Ctrl+S)'>
            <input id="ifa-games-file" className="ip-input" type="file" accept=".html,.htm,text/html" onChange={(e) => void read(setGamesHtml)(e)} />
          </Field>
          <Field label="דף משחקי הליגה, בשביל מזהי הקבוצות (מהתפריט שבו)">
            <input id="ifa-league-file" className="ip-input" type="file" accept=".html,.htm,text/html" onChange={(e) => void read(setLeagueHtml)(e)} />
          </Field>

          {parsed && (
            <>
              <p className="ip-muted">
                {parsed.teamId ? `דף קבוצה ${parsed.teamId}` : 'דף ליגה'} · עונה {parsed.seasonId ?? '?'}
                {parsed.leagueId ? ` · ליגה ${parsed.leagueId}` : ''}. <strong>{parsed.games.length}</strong> משחקים מתוך {parsed.rows} שורות,{' '}
                {parsed.games.filter((g) => g.ifa_game_id !== '-1').length} עם מזהה משחק,{' '}
                {parsed.games.filter((g) => !g.time || g.time === '00:00').length} בלי שעה, {parsed.games.filter((g) => !g.venue).length} בלי מגרש.{' '}
                {parsed.teamsInDropdown} קבוצות בתפריט.
              </p>
              {parsed.teamsInDropdown === 0 && <p className="ip-error">אין מזהי קבוצות: צרפו גם את דף משחקי הליגה.</p>}
              {(parsed.unmatched.length > 0 || parsed.problems.length > 0) && (
                <ul className="ip-ifa-problems">
                  {parsed.unmatched.map((u) => (
                    <li key={`${u.date}${u.home}`}>
                      לא נמצא מזהה קבוצה: {u.date} {u.home} - {u.away} (לא ייובא)
                    </li>
                  ))}
                  {parsed.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {parsed.games.length > 0 && (
                <ol className="ip-ifa-games">
                  {parsed.games.map((g) => (
                    <li key={`${g.home_ifa_team_id}-${g.away_ifa_team_id}`}>
                      <strong>
                        {showDate(g.date)} · {!g.time || g.time === '00:00' ? TIME_TBD : g.time}
                      </strong>
                      <span>
                        {g.home_name} <small dir="ltr">({g.home_ifa_team_id})</small> – {g.away_name} <small dir="ltr">({g.away_ifa_team_id})</small>
                      </span>
                      <span className="ip-muted">
                        {g.venue || VENUE_TBD} · {g.ifa_game_id === '-1' ? 'אין עדיין מזהה משחק' : `משחק ${g.ifa_game_id}`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="ip-btn-row">
                <Button variant="secondary" disabled={!ok || busy} onClick={() => void run(false)}>
                  בדיקה בלי לשמור
                </Button>
                <Button variant="primary" disabled={!ok || !dry || busy || dry.errors.length > 0} onClick={() => void run(true)}>
                  {busy ? 'רגע…' : 'ייבוא'}
                </Button>
              </div>
              {!dry && <p className="ip-footnote">קודם בודקים. הייבוא נפתח רק אחרי בדיקה בלי שגיאות.</p>}
            </>
          )}
          <Err error={error} />

          {(done ?? dry) && <ImportSummary r={(done ?? dry)!} />}

          {parsed?.teamId && parsed.seasonId && (
            <div className="ip-field-row">
              <Field label={`קטגוריית גיל לקבוצה ${parsed.teamId} (למשל טרום ב׳)`}>
                <input id="ifa-category" className="ip-input" value={category} onChange={(e) => setCategory(e.target.value.slice(0, 30))} />
              </Field>
              <Button variant="secondary" size="sm" disabled={!category.trim()} onClick={() => void saveCategory()}>
                שמירה
              </Button>
            </div>
          )}
          {label && <Tag tone="lime" icon="check">יוצג כ: {label}</Tag>}
        </div>
      </Card>
    </section>
  );
}

function ImportSummary({ r }: { r: GamesImportResult }) {
  const updated = r.changes.filter((c) => c.change === 'updated');
  return (
    <div className="ip-find-sent">
      <Tag tone={r.errors.length ? 'warning' : 'lime'} icon="check">
        {r.applied ? 'יובא' : 'בדיקה בלבד, לא נשמר'}
      </Tag>
      <p>
        {r.new} חדשים, {r.changed} שהשתנו, {r.unchanged} ללא שינוי.
        {r.applied && ` ${r.queued} התראות נכנסו לתור.`}
        {r.not_in_payload.length > 0 && ` ${r.not_in_payload.length} משחקים שמורים לא הופיעו בדף ולא נמחקו.`}
      </p>
      {updated.length > 0 && (
        <ul className="ip-change-list">
          {updated.map((c) => (
            <li key={c.pairing}>
              {c.pairing}: {c.fields?.map((f) => `${changeFieldLabel[f.field] ?? f.field} ${f.old ?? 'אין'} ← ${f.new ?? 'אין'}`).join(', ')}
              {c.notify ? ' · התראה' : ''}
            </li>
          ))}
        </ul>
      )}
      {r.errors.length > 0 && (
        <ul className="ip-ifa-problems">
          {r.errors.map((e, i) => (
            <li key={i}>
              {e.date ?? ''} {e.game}: {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Push sending switch: off (default), admins only (test), everyone. */
export function PushControl() {
  const [mode, setMode] = useState<PushMode | null>(null);
  const [stats, setStats] = useState<{ status: string; n: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPushMode().then(setMode);
    void getQueueStats().then(setStats);
  }, []);

  async function change(m: PushMode) {
    setError(null);
    try {
      await setPushMode(m);
      setMode(m);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const statusLabel: Record<string, string> = { pending: 'ממתינות', sending: 'בשליחה', sent: 'נשלחו', failed: 'נכשלו', skipped: 'דולגו' };
  return (
    <section>
      <SectionHeader title="התראות Push" icon="bell" />
      <Card>
        <div className="ip-form">
          {mode && (
            <Segmented
              label="שליחת התראות"
              value={mode}
              onChange={(m) => void change(m)}
              items={[
                { id: 'off', label: 'כבוי' },
                { id: 'admins', label: 'בדיקה: רק מנהלים' },
                { id: 'all', label: 'לכולם' },
              ]}
            />
          )}
          <p className="ip-muted">
            {stats.length === 0 ? 'התור ריק.' : stats.map((s) => `${statusLabel[s.status] ?? s.status}: ${s.n}`).join(' · ')}
          </p>
          <p className="ip-footnote">התראות שחיכו יותר מ־24 שעות לא נשלחות באיחור. ההתראות נכנסות לתור גם כשהשליחה כבויה, ונראות להורים באפליקציה.</p>
          <Err error={error} />
        </div>
      </Card>
    </section>
  );
}
