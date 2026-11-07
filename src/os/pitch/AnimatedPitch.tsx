import { useEffect, useMemo, useRef, useState } from 'react';
import { frameAt, planAnimation, stepLabel } from './animate';
import { areaOf, type Diagram, type PitchPreset } from './model';
import { Pitch } from './Pitch';

/**
 * Read-only pitch with a play button: the arrows play in the order they were
 * drawn and the players and ball move along them. Without arrows it is just
 * the static pitch. Honors "reduce motion": steps jump instead of gliding.
 */
export function AnimatedPitch({ preset, areaW, areaL, diagram, className }: { preset: PitchPreset; areaW?: number | null; areaL?: number | null; diagram: Diagram; className?: string }) {
  const { l, w } = areaOf(preset, areaW, areaL);
  const reach = Math.max(1.5, Math.max(l, w) / 40) * 2.5;
  const plan = useMemo(() => planAnimation(diagram, reach), [diagram, reach]);
  const [t, setTState] = useState<number | null>(null); // null = static drawing
  const tRef = useRef(0);
  const setT = (v: number | null) => {
    tRef.current = v ?? 0;
    setTState(v);
  };
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!playing) return;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      const nt = tRef.current + dt;
      if (nt >= plan.total) {
        setT(plan.total);
        setPlaying(false);
        return;
      }
      setT(nt);
      raf.current = requestAnimationFrame(tick);
    };
    last.current = null;
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [playing, plan.total]);

  useEffect(() => {
    setT(null);
    setPlaying(false);
  }, [diagram]);

  if (plan.steps.length === 0) return <Pitch preset={preset} areaW={areaW} areaL={areaL} diagram={diagram} className={className} />;

  const frame = t === null ? null : frameAt(diagram, plan, reduce && playing ? stepEnd(t) : t);
  const step = frame?.step ?? -1;
  const active = step >= 0 ? plan.steps[step].lines : [];
  const doneAt = step >= 0 ? plan.steps[step].lines[plan.steps[step].lines.length - 1] : -1;
  const ended = t !== null && t >= plan.total;

  function stepEnd(at: number) {
    // reduced motion: show each step's end state as soon as it starts
    const s = [...plan.steps].reverse().find((x) => at >= x.start);
    return s ? s.start + s.dur : at;
  }

  const go = () => {
    if (ended || t === null) setT(0);
    setPlaying(true);
  };
  const jump = (dir: 1 | -1) => {
    setPlaying(false);
    const target = Math.min(plan.steps.length - 1, Math.max(0, step + dir));
    const s = plan.steps[target];
    setT(s.start + s.dur);
  };

  return (
    <div className="os-anim">
      <Pitch
        preset={preset}
        areaW={areaW}
        areaL={areaL}
        diagram={frame?.diagram ?? diagram}
        className={className}
        lineClass={t === null ? undefined : (i) => (active.includes(i) ? 'is-active' : i > doneAt ? 'is-future' : 'is-done')}
      />
      <div className="os-anim__bar">
        <button type="button" className="os-btn os-btn--sm" onClick={playing ? () => setPlaying(false) : go} aria-label={playing ? 'עצירה' : 'הפעלת התנועה'}>
          {playing ? '⏸ עצור' : ended ? '↻ שוב' : t === null ? '▶ הפעל תנועה' : '▶ המשך'}
        </button>
        <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => jump(-1)} disabled={step <= 0} aria-label="שלב קודם">
          ›
        </button>
        <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => jump(1)} disabled={step >= plan.steps.length - 1} aria-label="שלב הבא">
          ‹
        </button>
        {t !== null && (
          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => { setPlaying(false); setT(null); }}>
            שרטוט מלא
          </button>
        )}
        <span className="os-muted os-small" aria-live="polite">
          {step >= 0
            ? `שלב ${step + 1} מתוך ${plan.steps.length}: ${plan.steps[step].lines.map((i) => stepLabel[diagram.lines[i].type]).join(' + ')}`
            : `${plan.steps.length} שלבים`}
        </span>
      </div>
    </div>
  );
}
