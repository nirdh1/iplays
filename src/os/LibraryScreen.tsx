import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import {
  archiveExercise,
  byTopics,
  copyExercise,
  difficultyLabel,
  getExercise,
  listCategories,
  listExercises,
  myExerciseClubs,
  scopeLabel,
  type Category,
  type Exercise,
  type ExerciseClub,
  type ExerciseScope,
} from './exercisesApi';
import { ExerciseEditor } from './ExerciseEditor';
import { AnimatedPitch } from './pitch/AnimatedPitch';
import { ExerciseVideo } from './ExerciseVideo';
import { Pitch } from './pitch/Pitch';
import { presetLabel } from './pitch/model';
import { ErrorNote, Loading, NoData } from './StateView';
import { TopicChips, TopicTags, useTopics } from './TopicChips';

/** #os/library, #os/library/<id>, #os/library/new, #os/library/<id>/edit */
export function LibraryScreen({ param, sub }: { param?: string; sub?: string }) {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [clubs, setClubs] = useState<ExerciseClub[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listCategories().then(setCats).catch((e) => setError(friendlyError(e)));
    myExerciseClubs().then(setClubs).catch(() => setClubs([]));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!cats) return <Loading />;
  if (param === 'new') return <ExerciseEditor id={null} cats={cats} clubs={clubs} />;
  if (param && sub === 'edit') return <ExerciseEditor id={param} cats={cats} clubs={clubs} />;
  if (param) return <ExercisePage id={param} cats={cats} clubs={clubs} />;
  return <LibraryList cats={cats} />;
}

export const catLabel = (cats: Category[], code: string) => cats.find((c) => c.code === code)?.label ?? code;

export function ReviewBadge({ ex }: { ex: Pick<Exercise, 'review_status'> }) {
  if (ex.review_status === 'pending_review') return <span className="os-chip os-chip--warn">טיוטה, ממתין לאישור מקצועי</span>;
  if (ex.review_status === 'approved') return <span className="os-chip os-chip--done">אושר מקצועית</span>;
  return null;
}

type SourceFilter = 'all' | ExerciseScope;

function LibraryList({ cats }: { cats: Category[] }) {
  const [rows, setRows] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [age, setAge] = useState('');
  const [players, setPlayers] = useState('');
  const [maxMin, setMaxMin] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [today, setToday] = useState<string[]>([]);
  const topics = useTopics();

  useEffect(() => {
    listExercises().then(setRows).catch((e) => setError(friendlyError(e)));
  }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    const a = Number(age);
    const p = Number(players);
    const m = Number(maxMin);
    const filtered = rows.filter(
      (r) =>
        (!term || r.title.toLowerCase().includes(term) || r.description.toLowerCase().includes(term)) &&
        (!cat || r.category === cat) &&
        (!age || (a >= r.age_from && a <= r.age_to)) &&
        (!players || (p >= r.players_min && p <= r.players_max)) &&
        (!maxMin || r.duration_min <= m) &&
        (source === 'all' || r.scope === source),
    );
    return byTopics(filtered, today);
  }, [rows, q, cat, age, players, maxMin, source, today]);

  if (error) return <ErrorNote message={error} />;
  if (!rows) return <Loading />;
  const draftCats = cats.some((c) => !c.approved);
  const count = (s: ExerciseScope) => rows.filter((r) => r.scope === s).length;

  return (
    <div className="os-stack">
      <section className="os-card">
        <div className="os-row">
          <div className="os-seg os-seg--wrap" role="group" aria-label="מקור">
            {(['all', 'iplays', 'club', 'personal'] as SourceFilter[]).map((s) => (
              <button key={s} type="button" className={source === s ? 'is-on is-present' : ''} aria-pressed={source === s} onClick={() => setSource(s)}>
                {s === 'all' ? `הכול (${rows.length})` : `${scopeLabel[s]} (${count(s)})`}
              </button>
            ))}
          </div>
          <a className="os-btn" href="#os/library/new">
            + תרגיל חדש
          </a>
        </div>
        <TopicChips topics={topics} value={today} onChange={setToday} label="מה מאמנים היום?" />
        <div className="os-form os-form--inline">
          <label>
            חיפוש
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם או תיאור" />
          </label>
          <label>
            קטגוריה
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">הכול</option>
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            גיל
            <input type="number" inputMode="numeric" min={5} max={21} value={age} onChange={(e) => setAge(e.target.value)} placeholder="למשל 10" />
          </label>
          <label>
            מספר שחקנים
            <input type="number" inputMode="numeric" min={1} max={40} value={players} onChange={(e) => setPlayers(e.target.value)} placeholder="למשל 12" />
          </label>
          <label>
            עד דקות
            <input type="number" inputMode="numeric" min={1} max={120} value={maxMin} onChange={(e) => setMaxMin(e.target.value)} placeholder="למשל 15" />
          </label>
        </div>
        {draftCats && <p className="os-muted os-small">רשימת הקטגוריות היא טיוטה עד אישור המנהל המקצועי של מועדון הפיילוט.</p>}
      </section>

      <p className="os-muted os-small" aria-live="polite">
        {shown.length} תרגילים מוצגים
      </p>
      {shown.length === 0 ? (
        <NoData>{rows.length === 0 ? 'אין עדיין תרגילים שמותר לך לראות' : 'אין תרגיל שמתאים לסינון'}</NoData>
      ) : (
        <ul className="os-ex-grid">
          {shown.map((r) => (
            <li key={r.id}>
              <a className="os-ex-card" href={`#os/library/${r.id}`}>
                <Pitch preset={r.pitch_preset} areaW={r.area_w_m} areaL={r.area_l_m} diagram={r.diagram} className="os-pitch--thumb" />
                <div className="os-ex-card__body">
                  <strong>{r.title}</strong>
                  <span className="os-muted os-small">
                    {catLabel(cats, r.category)} · {r.duration_min} דק׳ · {r.players_min}–{r.players_max} שחקנים · גילאי {r.age_from}–{r.age_to}
                  </span>
                  <TopicTags topics={topics} codes={r.topics} highlight={today} />
                  <span className="os-ex-card__tags">
                    <span className="os-source">{scopeLabel[r.scope]}</span>
                    <ReviewBadge ex={r} />
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function canWrite(ex: Exercise, me: string | undefined, clubs: ExerciseClub[]) {
  if (ex.scope === 'personal') return ex.owner_id === me;
  if (ex.scope === 'club') return clubs.some((c) => c.club_id === ex.club_id && c.can_write);
  return false;
}

function ExercisePage({ id, cats, clubs }: { id: string; cats: Category[]; clubs: ExerciseClub[] }) {
  const auth = useAuth();
  const me = auth.session?.user.id;
  const [ex, setEx] = useState<Exercise | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const topics = useTopics();

  useEffect(() => {
    setEx(undefined);
    getExercise(id).then(setEx).catch((e) => setError(friendlyError(e)));
  }, [id]);

  if (error) return <ErrorNote message={error} />;
  if (ex === undefined) return <Loading />;
  if (ex === null) return <NoData>התרגיל לא נמצא, או שאין לך הרשאה לראות אותו</NoData>;

  const writable = canWrite(ex, me, clubs);
  const writeClubs = clubs.filter((c) => c.can_write);

  const copy = async (scope: 'personal' | 'club', club: string | null) => {
    setBusy(true);
    setNote(null);
    try {
      const nid = await copyExercise(ex.id, scope, club);
      window.location.hash = `os/library/${nid}/edit`;
    } catch (e) {
      setNote(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const archive = async () => {
    if (!window.confirm('להעביר את התרגיל לארכיון? אפשר להחזיר אותו אחר כך.')) return;
    setBusy(true);
    try {
      await archiveExercise(ex.id, true);
      window.location.hash = 'os/library';
    } catch (e) {
      setNote(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div className="os-stack">
      <a className="os-back" href="#os/library">
        → לספרייה
      </a>
      <section className="os-card">
        <div className="os-card__head">
          <h2>{ex.title}</h2>
          <span className="os-ex-card__tags">
            <span className="os-source">{scopeLabel[ex.scope]}</span>
            <ReviewBadge ex={ex} />
          </span>
        </div>
        <p className="os-muted">
          {catLabel(cats, ex.category)} · {ex.duration_min} דקות · {ex.players_min}–{ex.players_max} שחקנים · גילאי {ex.age_from}–{ex.age_to} · רמה: {difficultyLabel[ex.difficulty]}
        </p>
        <TopicTags topics={topics} codes={ex.topics} />
        <AnimatedPitch preset={ex.pitch_preset} areaW={ex.area_w_m} areaL={ex.area_l_m} diagram={ex.diagram} className="os-pitch--page" />
        {ex.video_url && (
          <div className="os-video-row">
            <ExerciseVideo url={ex.video_url} title={ex.title} />
          </div>
        )}
        <p className="os-muted os-small">
          {ex.pitch_preset === 'custom' ? `שטח ${ex.area_l_m}×${ex.area_w_m} מ׳` : presetLabel[ex.pitch_preset]}
        </p>
      </section>

      <div className="os-grid">
        <section className="os-card">
          <h2>מהלך התרגיל</h2>
          <p className="os-pre">{ex.description || '—'}</p>
        </section>
        <section className="os-card">
          <h2>דגשים למאמן</h2>
          <p className="os-pre">{ex.coaching_points || '—'}</p>
          {ex.equipment.length > 0 && (
            <>
              <h2>ציוד</h2>
              <p>{ex.equipment.join(' · ')}</p>
            </>
          )}
        </section>
      </div>

      <section className="os-card">
        <h2>פעולות</h2>
        <div className="os-row os-row--start">
          {writable && (
            <a className="os-btn" href={`#os/library/${ex.id}/edit`}>
              עריכה
            </a>
          )}
          <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => copy('personal', null)}>
            העתק לתרגילים שלי
          </button>
          {writeClubs.map((c) => (
            <button key={c.club_id} type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => copy('club', c.club_id)}>
              העתק לספריית {c.name}
            </button>
          ))}
          {writable && (
            <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={archive}>
              העבר לארכיון
            </button>
          )}
        </div>
        {ex.scope === 'iplays' && <p className="os-muted os-small">את ספריית iPlays לא עורכים ישירות. מעתיקים לספרייה שלך או של המועדון ועורכים את העותק.</p>}
        {note && <ErrorNote message={note} />}
      </section>
    </div>
  );
}
