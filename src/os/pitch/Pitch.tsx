import { useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { areaOf, describe, type Diagram, type DiagramElement, type DiagramLine, type PitchPreset } from './model';

/**
 * Shared pitch: draws the area for a preset and a diagram on top. Used read
 * only (library cards, exercise page, training day) and by the editor, which
 * passes pointer handlers. Later also the lineup pitch.
 */
export interface PitchProps {
  preset: PitchPreset;
  areaW?: number | null;
  areaL?: number | null;
  diagram: Diagram;
  selectedId?: string | null;
  className?: string;
  /** editor hooks: called with metre coordinates */
  onPointerDownPitch?: (x: number, y: number) => void;
  onPointerDownItem?: (id: string, x: number, y: number) => void;
  onPointerMove?: (x: number, y: number) => void;
  onPointerUp?: () => void;
  overlay?: ReactNode;
  /** extra class per arrow, by index (used by the animation to dim arrows not played yet) */
  lineClass?: (index: number) => string;
}

const PAD = 2; // metres of grass around the lines

export function Pitch({ preset, areaW, areaL, diagram, selectedId, className, onPointerDownPitch, onPointerDownItem, onPointerMove, onPointerUp, overlay, lineClass }: PitchProps) {
  const { l, w } = areaOf(preset, areaW, areaL);
  const svg = useRef<SVGSVGElement>(null);
  const editable = !!(onPointerDownPitch || onPointerDownItem);
  const unit = Math.max(0.5, Math.max(l, w) / 40); // symbol size scales with the area so small drills stay readable

  const toMetres = (e: RPointerEvent): [number, number] => {
    const el = svg.current;
    if (!el) return [0, 0];
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = el.getScreenCTM();
    if (!m) return [0, 0];
    const p = pt.matrixTransform(m.inverse());
    return [Math.min(l, Math.max(0, p.x)), Math.min(w, Math.max(0, p.y))];
  };

  return (
    <svg
      ref={svg}
      className={`os-pitch${editable ? ' is-editable' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`${-PAD} ${-PAD} ${l + PAD * 2} ${w + PAD * 2}`}
      role="img"
      aria-label={describe(diagram)}
      style={{ direction: 'ltr', ['--ar' as string]: String((l + PAD * 2) / (w + PAD * 2)) }}
      onPointerDown={
        onPointerDownPitch
          ? (e) => {
              if ((e.target as Element).closest('[data-item]')) return;
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              onPointerDownPitch(...toMetres(e));
            }
          : undefined
      }
      onPointerMove={onPointerMove ? (e) => onPointerMove(...toMetres(e)) : undefined}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        <marker id="os-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
      <rect x={-PAD} y={-PAD} width={l + PAD * 2} height={w + PAD * 2} className="os-pitch__grass" />
      <Markings preset={preset} l={l} w={w} />
      {diagram.lines.map((ln, i) => (
        <Line key={ln.id} line={ln} unit={unit} extra={lineClass?.(i)} selected={ln.id === selectedId} onDown={onPointerDownItem ? (e) => onPointerDownItem(ln.id, ...toMetres(e)) : undefined} />
      ))}
      {diagram.elements.map((el) => (
        <Item key={el.id} el={el} unit={unit} selected={el.id === selectedId} onDown={onPointerDownItem ? (e) => { (svg.current as SVGSVGElement).setPointerCapture(e.pointerId); onPointerDownItem(el.id, ...toMetres(e)); } : undefined} />
      ))}
      {overlay}
    </svg>
  );
}

function Markings({ preset, l, w }: { preset: PitchPreset; l: number; w: number }) {
  const full = preset === '11v11' || preset === '9v9' || preset === '7v7';
  const s = preset === '11v11' || preset === 'half' || preset === 'third' ? 1 : preset === '9v9' ? 0.75 : 0.6; // box scale
  const box = { d: 16.5 * s, h: Math.min(40.3 * s, w * 0.6) };
  const six = { d: 5.5 * s, h: Math.min(18.3 * s, w * 0.3) };
  const goalBoxes = (atX: number, dir: 1 | -1) => (
    <>
      <rect x={dir === 1 ? atX : atX - box.d} y={(w - box.h) / 2} width={box.d} height={box.h} />
      <rect x={dir === 1 ? atX : atX - six.d} y={(w - six.h) / 2} width={six.d} height={six.h} />
      <circle cx={atX + dir * 11 * s} cy={w / 2} r={0.25} className="os-pitch__spot" />
    </>
  );
  return (
    <g className="os-pitch__lines">
      <rect x={0} y={0} width={l} height={w} />
      {full && (
        <>
          <line x1={l / 2} y1={0} x2={l / 2} y2={w} />
          <circle cx={l / 2} cy={w / 2} r={9.15 * s} />
          {goalBoxes(0, 1)}
          {goalBoxes(l, -1)}
        </>
      )}
      {preset === 'half' && (
        <>
          <path d={`M0,${w / 2 - 9.15} A9.15,9.15 0 0 1 0,${w / 2 + 9.15}`} />
          {goalBoxes(l, -1)}
        </>
      )}
      {preset === 'third' && goalBoxes(l, -1)}
    </g>
  );
}

function wavy(pts: [number, number][], amp: number): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / (amp * 3)));
    const nx = -(y1 - y0) / (len || 1);
    const ny = (x1 - x0) / (len || 1);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const off = k === n ? 0 : (k % 2 ? 1 : -1) * amp;
      d += ` L${x0 + (x1 - x0) * t + nx * off},${y0 + (y1 - y0) * t + ny * off}`;
    }
  }
  return d;
}

function Line({ line, unit, selected, onDown, extra }: { line: DiagramLine; unit: number; selected: boolean; onDown?: (e: RPointerEvent) => void; extra?: string }) {
  const d = line.type === 'dribble' ? wavy(line.pts, 0.35 * unit) : `M${line.pts.map((p) => p.join(',')).join(' L')}`;
  return (
    <g data-item className={`os-ln os-ln--${line.type}${selected ? ' is-selected' : ''}${extra ? ` ${extra}` : ''}`} onPointerDown={onDown}>
      <path d={`M${line.pts.map((p) => p.join(',')).join(' L')}`} className="os-ln__hit" strokeWidth={unit * 1.6} />
      <path d={d} strokeWidth={(line.type === 'shot' ? 0.32 : 0.2) * unit} markerEnd="url(#os-arrow)" />
    </g>
  );
}

function Item({ el, unit, selected, onDown }: { el: DiagramElement; unit: number; selected: boolean; onDown?: (e: RPointerEvent) => void }) {
  const r = unit;
  const cls = `os-it os-it--${el.type}${el.team ? ` os-it--${el.team}` : ''}${selected ? ' is-selected' : ''}`;
  const common = { 'data-item': true, className: cls, onPointerDown: onDown } as const;
  switch (el.type) {
    case 'player':
    case 'gk':
      return (
        <g {...common} transform={`translate(${el.x},${el.y})`}>
          <circle r={r} />
          {el.label && (
            <text y={el.label.length > 2 ? r * 2.1 : r * 0.38} fontSize={el.label.length > 2 ? r * 0.9 : r * 1.1} textAnchor="middle">
              {el.label}
            </text>
          )}
          {el.type === 'gk' && !el.label && (
            <text y={r * 0.38} fontSize={r * 1.1} textAnchor="middle">
              ש
            </text>
          )}
        </g>
      );
    case 'ball':
      return <circle {...common} cx={el.x} cy={el.y} r={r * 0.45} />;
    case 'cone':
      return <path {...common} d={`M${el.x},${el.y - r * 0.6} L${el.x + r * 0.5},${el.y + r * 0.45} L${el.x - r * 0.5},${el.y + r * 0.45} Z`} />;
    case 'mannequin':
      return <rect {...common} x={el.x - r * 0.25} y={el.y - r * 0.9} width={r * 0.5} height={r * 1.8} rx={r * 0.2} />;
    case 'goal':
    case 'minigoal': {
      const len = el.type === 'goal' ? 7.32 : Math.max(2, r * 2.4);
      const depth = el.type === 'goal' ? 1.2 : r * 0.6;
      const vertical = (el.rot ?? 0) % 180 === 90;
      return vertical ? (
        <rect {...common} x={el.x - depth / 2} y={el.y - len / 2} width={depth} height={len} />
      ) : (
        <rect {...common} x={el.x - len / 2} y={el.y - depth / 2} width={len} height={depth} />
      );
    }
  }
}
