/**
 * Club setup, the manager's first path (user 2026-11-11): link the club's
 * teams and invite their coaches without leaving the Club OS.
 * Uses the existing, permission-checked RPCs: find_teams, adopt_team
 * (club owner/admin only), create_invite (team staff level 4, which club
 * owners/admins have on club teams) and club_team_results (who coaches).
 * Nothing is invented: every list comes from the database.
 */
import { useEffect, useState } from 'react';
import { friendlyError, inviteLink, newInviteCode } from '../lib/api';
import { adoptCandidatesInfo, adoptTeam, getClubData, getMyClubs, type AdoptInfo, type Club, type ClubData } from '../lib/clubApi';
import { findTeams, teamYearLabel, type FoundTeam } from '../lib/joinApi';
import { supabase } from '../lib/supabase';
import { areaOf } from './areas';
import { ErrorNote, Loading, NoData } from './StateView';

/** Words of the club name that are worth searching for ("הפועל רמת גן" -> "רמת גן"). */
export function clubSearchText(name: string): string {
  const generic = new Set(['הפועל', 'מכבי', 'בית"ר', 'ביתר', 'בני', 'עירוני', 'מ.ס.', 'מ.כ.', 'ס.כ.', 'אס', 'הכח', 'הכוח', 'אליצור', 'מועדון', 'כדורגל', 'קבוצת', 'אקדמיה', 'אקדמיית']);
  const words = name.split(/\s+/).filter(Boolean);
  const rest = words.filter((w) => !generic.has(w));
  return (rest.length ? rest : words).join(' ');
}

/** Free teams first by birth year (youngest last), then by name. */
export function sortCandidates(list: FoundTeam[]): FoundTeam[] {
  const year = (t: FoundTeam) => t.birth_year_from ?? t.birth_year_est ?? 0;
  return [...list].sort((a, b) => year(b) - year(a) || a.name.localeCompare(b.name, 'he'));
}

interface CoachRow {
  team_id: string;
  app_coaches: string[];
}

export function SetupScreen({ focus }: { focus?: string }) {
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [data, setData] = useState<ClubData | null>(null);
  const [coaches, setCoaches] = useState<Map<string, string[]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyClubs()
      .then((all) => {
        const mine = all.filter((c) => c.role === 'owner' || c.role === 'admin');
        setClubs(mine);
        setClub(mine[0] ?? null);
      })
      .catch((e) => setError(friendlyError(e)));
  }, []);

  const reload = async (c: Club) => {
    try {
      setData(await getClubData(c.id));
    } catch (e) {
      setError(friendlyError(e));
    }
    if (!supabase) return;
    const { data: r, error: err } = await supabase.rpc('club_team_results', { p_club: c.id });
    setCoaches(err || !r ? new Map() : new Map(((r as { teams: CoachRow[] }).teams ?? []).map((t) => [t.team_id, t.app_coaches ?? []])));
  };
  useEffect(() => {
    if (!club) return;
    setData(null);
    setCoaches(null);
    void reload(club);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club?.id]);

  useEffect(() => {
    if (focus && data) document.getElementById(`setup-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus, data]);

  if (error) return <ErrorNote message={error} />;
  if (!clubs) return <Loading />;
  if (!club)
    return (
      <section className="os-state">
        <h2>הקמת מועדון מיועדת להנהלת המועדון</h2>
        <p className="os-muted">החשבון הזה לא מוגדר כבעלים או מנהל של מועדון, ולכן אי אפשר לשייך ממנו קבוצות.</p>
      </section>
    );

  const teams = (data?.teams ?? []).filter((t) => !t.archived_at);
  const withCoach = teams.filter((t) => (coaches?.get(t.id) ?? []).length > 0).length;

  return (
    <div className="os-stack os-setup-screen">
      <header className="os-dash__head">
        <div>
          <span className="os-dash__eyebrow">הקמת המועדון</span>
          {clubs.length > 1 ? (
            <label className="os-teampick">
              <span className="os-muted">מועדון</span>
              <select value={club.id} onChange={(e) => setClub(clubs.find((c) => c.id === e.target.value) ?? null)}>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <h2 className="os-dash__title">{club.name}</h2>
          )}
        </div>
        <a className="os-btn os-btn--ghost" href="#os/dashboard">
          חזרה לקוקפיט
        </a>
      </header>

      <ol className="os-setupsteps" aria-label="שלבים">
        <li className={teams.length >= 2 ? 'is-done' : 'is-now'}>
          <strong>1. קבוצות</strong>
          <small>{data ? `${teams.length} משויכות` : '…'}</small>
        </li>
        <li className={teams.length && withCoach >= teams.length ? 'is-done' : teams.length ? 'is-now' : ''}>
          <strong>2. מאמנים</strong>
          <small>{coaches ? `${withCoach} מתוך ${teams.length} עם מאמן` : '…'}</small>
        </li>
        <li>
          <strong>3. הקוקפיט מתמלא</strong>
          <small>נוכחות, מערכים ודוחות מהמאמנים</small>
        </li>
      </ol>

      {!data ? (
        <Loading />
      ) : (
        <>
          <AdoptCard club={club} data={data} onDone={() => reload(club)} />
          <CoachInvites teams={teams} coaches={coaches} />
        </>
      )}
    </div>
  );
}

function AdoptCard({ club, data, onDone }: { club: Club; data: ClubData; onDone: () => Promise<void> }) {
  const [q, setQ] = useState(() => clubSearchText(club.name));
  const [hits, setHits] = useState<FoundTeam[] | null>(null);
  const [taken, setTaken] = useState(0);
  const [info, setInfo] = useState<Map<string, AdoptInfo>>(new Map());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const leagues = data.programs.filter((p) => p.kind === 'league');
  const [program, setProgram] = useState<string>((leagues[0] ?? data.programs[0])?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (text: string) => {
    setError(null);
    setHits(null);
    try {
      const all = await findTeams(text.trim());
      const free = sortCandidates(all.filter((t) => !t.club_id && !t.has_staff));
      setTaken(all.filter((t) => t.club_id && t.club_id !== club.id).length + all.filter((t) => !t.club_id && t.has_staff).length);
      setHits(free);
      setPicked(new Set());
      adoptCandidatesInfo(free.map((t) => t.team_id))
        .then((rows) => setInfo(new Map(rows.map((r) => [r.team_id, r]))))
        .catch(() => undefined);
    } catch (e) {
      setError(friendlyError(e));
      setHits([]);
    }
  };
  useEffect(() => {
    if (q.trim().length >= 2) void search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.id]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const adopt = async () => {
    const list = (hits ?? []).filter((t) => picked.has(t.team_id));
    if (!list.length) return;
    const pName = data.programs.find((p) => p.id === program)?.name;
    if (!window.confirm(`לשייך ${list.length} קבוצות ל${pName ?? 'מועדון'}? אחרי השיוך המועדון מנהל אותן.`)) return;
    setError(null);
    const failed: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`משייך ${i + 1} מתוך ${list.length}…`);
      try {
        await adoptTeam(list[i].team_id, club.id, program || null);
      } catch {
        failed.push(list[i].name);
      }
    }
    setBusy(null);
    if (failed.length) setError(`לא שויכו: ${failed.join(', ')}. ייתכן שבינתיים נרשם להן מאמן או מועדון.`);
    const done = new Set(list.map((t) => t.team_id));
    setHits((h) => h?.filter((t) => !done.has(t.team_id) || failed.includes(t.name)) ?? null);
    setPicked(new Set());
    await onDone();
  };

  const teams = data.teams.filter((t) => !t.archived_at);

  return (
    <section className="os-card" id="setup-teams" aria-labelledby="setup-teams-h">
      <div className="os-card__head">
        <h2 id="setup-teams-h">1. שיוך הקבוצות של המועדון</h2>
        <span className="os-setup__count">{teams.length} משויכות</span>
      </div>

      {teams.length > 0 && (
        <div className="os-chips" aria-label="קבוצות משויכות">
          {teams.map((t) => (
            <span key={t.id} className="os-chip os-chip--done">
              {t.name}
            </span>
          ))}
        </div>
      )}

      <p className="os-muted os-small">
        אלה קבוצות מהקטלוג (התאחדות) שעדיין אין להן מאמן או מועדון באפליקציה. מסמנים את הקבוצות של המועדון ולוחצים "שיוך". כדי שתהיה תחרות בין אזורים צריך קבוצות עם אזור בשם (צפון, דרום).
      </p>
      <form
        className="os-form os-form--inline"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <label>
          חיפוש לפי שם
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="למשל: רמת גן" />
        </label>
        <button type="submit" className="os-btn os-btn--ghost os-btn--sm" disabled={q.trim().length < 2}>
          חיפוש
        </button>
      </form>

      {hits === null ? (
        <Loading />
      ) : hits.length === 0 ? (
        <NoData>
          {taken > 0
            ? `נמצאו ${taken} קבוצות, אבל לכולן כבר יש מאמן או מועדון באפליקציה.`
            : 'לא נמצאו קבוצות פנויות. נסו מילה אחת מהשם, למשל שם העיר.'}
        </NoData>
      ) : (
        <>
          <div className="os-row os-adopt__bar">
            <label className="os-check">
              <input
                type="checkbox"
                checked={picked.size === hits.length}
                onChange={(e) => setPicked(e.target.checked ? new Set(hits.map((t) => t.team_id)) : new Set())}
              />
              בחירת הכל ({hits.length})
            </label>
            {data.programs.length > 1 && (
              <label className="os-adopt__program">
                <span className="os-muted os-small">למסגרת</span>
                <select value={program} onChange={(e) => setProgram(e.target.value)}>
                  {data.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <ul className="os-adopt">
            {hits.map((t) => {
              const area = areaOf(t.name);
              const extra = info.get(t.team_id);
              return (
                <li key={t.team_id}>
                  <label>
                    <input type="checkbox" checked={picked.has(t.team_id)} onChange={() => toggle(t.team_id)} />
                    <span className="os-adopt__text">
                      <strong>{t.name}</strong>
                      <small>
                        {[teamYearLabel(t), `${t.players} שחקנים`, extra?.league, extra?.season && `עונה ${extra.season}`].filter(Boolean).join(' · ')}
                      </small>
                    </span>
                    {area && <span className="os-chip">{area}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="os-adopt__go">
            <button type="button" className={`os-btn${picked.size ? "" : " os-btn--ghost"}`} disabled={!picked.size || !!busy} onClick={() => void adopt()}>
              {busy ?? (picked.size ? `שיוך ${picked.size} קבוצות למועדון` : 'סמנו קבוצות לשיוך')}
            </button>
          </div>
        </>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}

function CoachInvites({ teams, coaches }: { teams: ClubData['teams']; coaches: Map<string, string[]> | null }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const make = async (teamId: string) => {
    setError(null);
    try {
      const code = await newInviteCode(teamId, 'coach');
      setLinks((l) => ({ ...l, [teamId]: inviteLink(code) }));
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  const copy = async (teamId: string) => {
    try {
      await navigator.clipboard.writeText(links[teamId]);
      setCopied(teamId);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="os-card" id="setup-coaches" aria-labelledby="setup-coaches-h">
      <div className="os-card__head">
        <h2 id="setup-coaches-h">2. הזמנת המאמנים</h2>
      </div>
      <p className="os-muted os-small">
        לכל קבוצה יוצרים קישור הזמנה ושולחים למאמן. מאמן שנכנס דרך הקישור מצטרף כמאמן הקבוצה, ומאותו רגע הנוכחות, המערכים והדוחות שלו נכנסים לקוקפיט.
      </p>
      {teams.length === 0 ? (
        <NoData>קודם משייכים קבוצות (שלב 1)</NoData>
      ) : coaches === null ? (
        <Loading />
      ) : (
        <ul className="os-invites">
          {teams.map((t) => {
            const names = coaches.get(t.id) ?? [];
            const link = links[t.id];
            return (
              <li key={t.id}>
                <span className="os-adopt__text">
                  <strong>{t.name}</strong>
                  <small>{names.length ? `מאמן באפליקציה: ${names.join(', ')}` : 'אין מאמן באפליקציה'}</small>
                </span>
                {link ? (
                  <span className="os-invites__link">
                    <input readOnly value={link} aria-label={`קישור הזמנה למאמן ${t.name}`} onFocus={(e) => e.target.select()} dir="ltr" />
                    <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => void copy(t.id)}>
                      {copied === t.id ? 'הועתק' : 'העתקה'}
                    </button>
                    <a
                      className="os-btn os-btn--sm"
                      href={`https://wa.me/?text=${encodeURIComponent(`הזמנה להצטרף כמאמן של ${t.name} ב־iPlays: ${link}`)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      וואטסאפ
                    </a>
                  </span>
                ) : (
                  <button type="button" className={`os-btn os-btn--sm${names.length ? ' os-btn--ghost' : ''}`} onClick={() => void make(t.id)}>
                    {names.length ? 'הזמנת מאמן נוסף' : 'קישור הזמנה למאמן'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
