import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { friendlyError } from '../lib/api';
import { blankExercise, getExercise, saveExercise, scopeLabel, type Category, type Exercise, type ExerciseClub, type ExerciseInput } from './exercisesApi';
import { Pitch } from './pitch/Pitch';
import { areaOf, MAX_ITEMS, presetLabel, type Diagram, type DiagramElement, type ElementType, type LineType, type PitchPreset, type Team } from './pitch/model';
import { ErrorNote, Loading, NoData } from './StateView';

/**
 * Basic pitch editor. Tap a tool, then tap the pitch to place it; lines take
 * two taps (start, end). "בחירה" drags and selects. Undo/redo keep the last
 * 50 states. On a phone only the basic tools are offered (decision OD-27).
 */
type Tool =
  | { key: string; label: string; kind: 'select' }
  | { key: string; label: string; kind: 'el'; type: ElementType; team?: Team; full?: boolean }
  | { key: string; label: string; kind: 'line'; type: LineType; full?: boolean };

const tools: Tool[] = [
  { key: 'select', label: 'בחירה והזזה', kind: 'select' },
  { key: 'pa', label: 'שחקן קבוצה א', kind: 'el', type: 'player', team: 'a' },
  { key: 'pb', label: 'שחקן קבוצה ב', kind: 'el', type: 'player', team: 'b' },
  { key: 'gk', label: 'שוער', kind: 'el', type: 'gk', team: 'n' },
  { key: 'ball', label: 'כדור', kind: 'el', type: 'ball' },
  { key: 'cone', label: 'קונוס', kind: 'el', type: 'cone' },
  { key: 'minigoal', label: 'שער קטן', kind: 'el', type: 'minigoal' },
  { key: 'goal', label: 'שער גדול', kind: 'el', type: 'goal', full: true },
  { key: 'mannequin', label: 'בובה', kind: 'el', type: 'mannequin', full: true },
  { key: 'pass', label: 'מסירה', kind: 'line', type: 'pass' },
  { key: 'run', label: 'ריצה', kind: 'line', type: 'run' },
  { key: 'dribble', label: 'כדרור', kind: 'line', type: 'dribble', full: true },
  { key: 'shot', label: 'בעיטה', kind: 'line', type: 'shot', full: true },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const round = (n: number) => Math.round(n * 10) / 10;

function usePhone() {
  const q = '(max-width: 599px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

export function ExerciseEditor({ id, cats, clubs }: { id: string | null; cats: Category[]; clubs: ExerciseClub[] }) {
  const auth = useAuth();
  const me = auth.session?.user.id;
  const [loaded, setLoaded] = useState<Exercise | null | undefined>(id ? undefined : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<ExerciseInput>(() => blankExercise(cats[0]?.code ?? 'warmup'));
  const writeClubs = clubs.filter((c) => c.can_write);
  const [target, setTarget] = useState<string>('personal'); // 'personal' or a club id

  useEffect(() => {
    if (!id) return;
    getExercise(id)
      .then((ex) => {
        setLoaded(ex);
        if (ex) {
          const { id: _i, scope: _s, owner_id: _o, club_id: _c, review_status: _r, copied_from: _f, updated_at: _u, ...rest } = ex;
          setForm(rest);
        }
      })
      .catch((e) => setLoadError(friendlyError(e)));
  }, [id]);

  if (loadError) return <ErrorNote message={loadError} />;
  if (loaded === undefined) return <Loading />;
  if (id && !loaded) return <NoData>התרגיל לא נמצא, או שאין לך הרשאה לראות אותו</NoData>;
  if (loaded && !(loaded.scope === 'personal' ? loaded.owner_id === me : loaded.scope === 'club' && writeClubs.some((c) => c.club_id === loaded.club_id))) {
    return <NoData>אין לך הרשאה לערוך את התרגיל הזה. אפשר להעתיק אותו לספרייה שלך ולערוך את העותק.</NoData>;
  }

  return <EditorBody key={id ?? 'new'} id={id} loaded={loaded} form={form} setForm={setForm} cats={cats} writeClubs={writeClubs} target={target} setTarget={setTarget} />;
}

function EditorBody({
  id,
  loaded,
  form,
  setForm,
  cats,
  writeClubs,
  target,
  setTarget,
}: {
  id: string | null;
  loaded: Exercise | null;
  form: ExerciseInput;
  setForm: (f: ExerciseInput | ((f: ExerciseInput) => ExerciseInput)) => void;
  cats: Category[];
  writeClubs: ExerciseClub[];
  target: string;
  setTarget: (t: string) => void;
}) {
  const phone = usePhone();
  const [toolKey, setToolKey] = useState('pa');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<[number, number] | null>(null);
  const [past, setPast] = useState<Diagram[]>([]);
  const [future, setFuture] = useState<Diagram[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const palette = tools.filter((t) => !phone || !('full' in t && t.full));
  const tool = palette.find((t) => t.key === toolKey) ?? palette[0];
  const d = form.diagram;
  const items = d.elements.length + d.lines.length;
  const area = areaOf(form.pitch_preset, form.area_w_m, form.area_l_m);

  const set = <K extends keyof ExerciseInput>(k: K, v: ExerciseInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const commit = (next: Diagram) => {
    setPast((p) => [...p.slice(-49), d]);
    setFuture([]);
    set('diagram', next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [d, ...f]);
    set('diagram', past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelected(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, d]);
    set('diagram', future[0]);
    setFuture((f) => f.slice(1));
  };
  const remove = () => {
    if (!selected) return;
    commit({ ...d, elements: d.elements.filter((e) => e.id !== selected), lines: d.lines.filter((l) => l.id !== selected) });
    setSelected(null);
  };
  const selectedEl = d.elements.find((e) => e.id === selected);
  const updateSelected = (patch: Partial<DiagramElement>) => {
    if (!selectedEl) return;
    commit({ ...d, elements: d.elements.map((e) => (e.id === selectedEl.id ? { ...e, ...patch } : e)) });
  };

  const onPitch = (x: number, y: number) => {
    setError(null);
    if (tool.kind === 'select') {
      setSelected(null);
      return;
    }
    if (items >= MAX_ITEMS) {
      setError(`אפשר עד ${MAX_ITEMS} פריטים בשרטוט`);
      return;
    }
    if (tool.kind === 'el') {
      const n = tool.type === 'player' ? d.elements.filter((e) => e.type === 'player' && e.team === tool.team).length + 1 : 0;
      const el: DiagramElement = { id: uid(), type: tool.type, x: round(x), y: round(y), ...(tool.team ? { team: tool.team } : {}), ...(n ? { label: String(n) } : {}) };
      commit({ ...d, elements: [...d.elements, el] });
      return;
    }
    if (!pending) {
      setPending([round(x), round(y)]);
      return;
    }
    if (Math.hypot(x - pending[0], y - pending[1]) < 0.5) return;
    commit({ ...d, lines: [...d.lines, { id: uid(), type: tool.type, pts: [pending, [round(x), round(y)]] }] });
    setPending(null);
  };

  const onItem = (itemId: string, x: number, y: number) => {
    if (tool.kind !== 'select') {
      // placing on top of an item still places (e.g. a ball at a player's feet)
      onPitch(x, y);
      return;
    }
    setSelected(itemId);
    const el = d.elements.find((e) => e.id === itemId);
    if (el) drag.current = { id: itemId, dx: el.x - x, dy: el.y - y, moved: false };
  };
  const onMove = (x: number, y: number) => {
    const g = drag.current;
    if (!g) return;
    const nx = round(Math.min(area.l, Math.max(0, x + g.dx)));
    const ny = round(Math.min(area.w, Math.max(0, y + g.dy)));
    if (!g.moved) {
      setPast((p) => [...p.slice(-49), d]);
      setFuture([]);
      g.moved = true;
    }
    setForm((f) => ({ ...f, diagram: { ...f.diagram, elements: f.diagram.elements.map((e) => (e.id === g.id ? { ...e, x: nx, y: ny } : e)) } }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const save = async () => {
    setError(null);
    const title = form.title.trim();
    if (title.length < 2) return setError('צריך שם לתרגיל (לפחות 2 תווים)');
    if (form.age_from > form.age_to) return setError('גיל "מ" גדול מגיל "עד"');
    if (form.players_min > form.players_max) return setError('מינימום שחקנים גדול מהמקסימום');
    setSaving(true);
    try {
      const scope = loaded ? (loaded.scope as 'club' | 'personal') : target === 'personal' ? 'personal' : 'club';
      const club = loaded ? loaded.club_id : target === 'personal' ? null : target;
      const nid = await saveExercise(id, scope, club, { ...form, title, equipment: form.equipment.map((x) => x.trim()).filter(Boolean) });
      window.location.hash = `os/library/${nid}`;
    } catch (e) {
      setError(friendlyError(e));
      setSaving(false);
    }
  };

  const num = (k: 'age_from' | 'age_to' | 'players_min' | 'players_max' | 'duration_min' | 'area_w_m' | 'area_l_m', label: string, min: number, max: number) => (
    <label>
      {label}
      <input type="number" inputMode="numeric" min={min} max={max} value={form[k] ?? ''} onChange={(e) => set(k, Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
    </label>
  );

  const overlay = pending ? <circle cx={pending[0]} cy={pending[1]} r={Math.max(area.l, area.w) / 80} className="os-pitch__pending" /> : null;

  return (
    <div className="os-stack">
      <a className="os-back" href={id ? `#os/library/${id}` : '#os/library'}>
        → {id ? 'לתרגיל' : 'לספרייה'}
      </a>

      <section className="os-card">
        <div className="os-card__head">
          <h2>{id ? 'עריכת תרגיל' : 'תרגיל חדש'}</h2>
          <span className="os-source">{loaded ? scopeLabel[loaded.scope] : target === 'personal' ? scopeLabel.personal : scopeLabel.club}</span>
        </div>
        <div className="os-tools" role="toolbar" aria-label="כלי שרטוט">
          {palette.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`os-tool os-tool--${t.key}${t.key === tool.key ? ' is-on' : ''}`}
              aria-pressed={t.key === tool.key}
              onClick={() => {
                setToolKey(t.key);
                setPending(null);
              }}
            >
              <i aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
        <p className="os-muted os-small" aria-live="polite">
          {tool.kind === 'select'
            ? 'גרור פריט כדי להזיז אותו, או הקש עליו כדי לבחור.'
            : tool.kind === 'line'
              ? pending
                ? 'עכשיו הקש על נקודת הסיום.'
                : 'הקש על נקודת ההתחלה של הקו.'
              : 'הקש על המגרש כדי להוסיף.'}
          {phone && ' בטלפון מוצגים הכלים הבסיסיים; עריכה מלאה בטאבלט או במחשב.'}
        </p>
        <Pitch
          preset={form.pitch_preset}
          areaW={form.area_w_m}
          areaL={form.area_l_m}
          diagram={d}
          selectedId={selected}
          className="os-pitch--edit"
          onPointerDownPitch={onPitch}
          onPointerDownItem={onItem}
          onPointerMove={onMove}
          onPointerUp={onUp}
          overlay={overlay}
        />
        <div className="os-row os-row--start">
          <button type="button" className="os-btn os-btn--ghost" onClick={undo} disabled={!past.length}>
            ביטול פעולה
          </button>
          <button type="button" className="os-btn os-btn--ghost" onClick={redo} disabled={!future.length}>
            חזרה על פעולה
          </button>
          <button type="button" className="os-btn os-btn--ghost" onClick={remove} disabled={!selected}>
            מחק את הנבחר
          </button>
          {selectedEl && (selectedEl.type === 'goal' || selectedEl.type === 'minigoal') && (
            <button type="button" className="os-btn os-btn--ghost" onClick={() => updateSelected({ rot: ((selectedEl.rot ?? 0) + 90) % 180 })}>
              סובב שער
            </button>
          )}
          {selectedEl && (selectedEl.type === 'player' || selectedEl.type === 'gk') && (
            <label className="os-inline-field">
              תווית
              <input value={selectedEl.label ?? ''} maxLength={3} onChange={(e) => updateSelected({ label: e.target.value })} />
            </label>
          )}
          <span className="os-muted os-small">
            {items}/{MAX_ITEMS} פריטים
          </span>
        </div>
      </section>

      <section className="os-card">
        <h2>פרטי התרגיל</h2>
        <div className="os-form os-form--inline">
          <label className="os-form__wide">
            שם התרגיל
            <input value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} required />
          </label>
          {!loaded && (
            <label>
              לשמור ב
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="personal">{scopeLabel.personal}</option>
                {writeClubs.map((c) => (
                  <option key={c.club_id} value={c.club_id}>
                    ספריית {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            קטגוריה
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            רמה
            <select value={form.difficulty} onChange={(e) => set('difficulty', Number(e.target.value))}>
              <option value={1}>קל</option>
              <option value={2}>בינוני</option>
              <option value={3}>מאתגר</option>
              <option value={4}>מתקדם</option>
            </select>
          </label>
          {num('duration_min', 'משך (דקות)', 1, 120)}
          {num('players_min', 'שחקנים מ', 1, 30)}
          {num('players_max', 'שחקנים עד', 1, 40)}
          {num('age_from', 'גיל מ', 5, 21)}
          {num('age_to', 'גיל עד', 5, 21)}
          <label>
            שטח
            <select value={form.pitch_preset} onChange={(e) => set('pitch_preset', e.target.value as PitchPreset)}>
              {(Object.keys(presetLabel) as PitchPreset[]).map((p) => (
                <option key={p} value={p}>
                  {presetLabel[p]}
                </option>
              ))}
            </select>
          </label>
          {form.pitch_preset === 'custom' && (
            <>
              {num('area_l_m', 'אורך (מ׳)', 5, 120)}
              {num('area_w_m', 'רוחב (מ׳)', 5, 120)}
            </>
          )}
          <label>
            מצב
            <select value={form.status} onChange={(e) => set('status', e.target.value as 'draft' | 'active')}>
              <option value="active">פעיל</option>
              <option value="draft">טיוטה</option>
            </select>
          </label>
          <label className="os-form__wide">
            ציוד (מופרד בפסיקים)
            <input
              value={form.equipment.join(', ')}
              onChange={(e) =>
                set(
                  'equipment',
                  e.target.value.split(',').map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1).slice(0, 15),
                )
              }
            />
          </label>
          <label className="os-form__full">
            מהלך התרגיל
            <textarea rows={4} maxLength={1000} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="os-form__full">
            דגשים למאמן
            <textarea rows={3} maxLength={600} value={form.coaching_points} onChange={(e) => set('coaching_points', e.target.value)} />
          </label>
        </div>
        {error && <ErrorNote message={error} />}
        <button type="button" className="os-btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </section>
    </div>
  );
}
