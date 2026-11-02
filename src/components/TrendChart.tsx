import { useState } from 'react';
import { CHART_BLUE } from './CareerChart';

/**
 * One measure over time (single series, so no legend: the caption names it).
 * Time runs right-to-left like the rest of the RTL app. 2px line, 8px
 * markers with a surface ring, the latest value labeled directly, a tap /
 * hover readout for every point, and min / max on a recessive axis.
 */
export function TrendChart({ points, unit, label }: { points: { date: string; value: number }[]; unit: string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 320;
  const H = 150;
  const padX = 28;
  const padTop = 26;
  const padBottom = 24;
  const times = points.map((p) => Date.parse(p.date));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.15;
  hi += span * 0.15;
  // right-to-left: the earliest point on the right
  const x = (t: number) => (t1 === t0 ? W / 2 : W - padX - ((t - t0) / (t1 - t0)) * (W - 2 * padX));
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * (H - padTop - padBottom);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
  const shown = active ?? points.length - 1;
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);

  return (
    <figure className="ip-trend">
      <figcaption className="ip-trend-readout" aria-live="polite">
        <strong>
          {fmt(points[shown].value)} {unit}
        </strong>
        <span>
          {label} · {day(points[shown].date)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.map((p) => `${day(p.date)} ${fmt(p.value)}`).join(', ')}`}>
        <line x1={padX / 2} x2={W - padX / 2} y1={H - padBottom} y2={H - padBottom} className="ip-trend-axis" />
        <text x={W - 2} y={y(maxV) + 4} className="ip-trend-tick" textAnchor="end">
          {maxV !== minV ? fmt(maxV) : ''}
        </text>
        <text x={W - 2} y={y(minV) + 4} className="ip-trend-tick" textAnchor="end">
          {fmt(minV)}
        </text>
        <text x={W - padX} y={H - 6} className="ip-trend-tick" textAnchor="middle">
          {day(points[0].date)}
        </text>
        {points.length > 1 && (
          <text x={padX} y={H - 6} className="ip-trend-tick" textAnchor="middle">
            {day(points[points.length - 1].date)}
          </text>
        )}
        {active != null && <line x1={x(times[active])} x2={x(times[active])} y1={padTop - 8} y2={H - padBottom} className="ip-trend-cross" />}
        <path d={path} fill="none" stroke={CHART_BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(times[i])} cy={y(p.value)} r={5} fill={CHART_BLUE} stroke="var(--ip-surface)" strokeWidth={2} />
            <circle
              cx={x(times[i])}
              cy={y(p.value)}
              r={16}
              fill="transparent"
              tabIndex={0}
              aria-label={`${day(p.date)}: ${fmt(p.value)} ${unit}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
            />
          </g>
        ))}
        <text x={x(times[points.length - 1])} y={y(points[points.length - 1].value) - 12} className="ip-trend-label" textAnchor="middle">
          {fmt(points[points.length - 1].value)}
        </text>
      </svg>
    </figure>
  );
}
