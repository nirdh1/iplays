import { useState } from 'react';
import type { Career } from '../data/demo';

/**
 * Grouped bars per month. Colors validated for CVD separation (blue-700 /
 * lime-700); values are direct-labeled for contrast relief, and each group
 * shows a tooltip on hover/tap.
 */
export const CHART_BLUE = '#1477D6';
export const CHART_LIME = '#4FB51A';

export interface ChartSeries {
  label: string;
  color: string;
}

export function BarChart({ data, series }: { data: { month: string; values: number[] }[]; series: ChartSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const H = 110;
  return (
    <figure className="ip-chart">
      <div className="ip-chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="ip-chart-plot" style={{ height: H + 40 }}>
        {data.map((d, i) => (
          <button
            type="button"
            key={d.month}
            className={`ip-chart-group ${hover === i ? 'is-hover' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${d.month}: ${series.map((s, j) => `${d.values[j]} ${s.label}`).join(', ')}`}
          >
            {hover === i && (
              <span className="ip-chart-tip" role="status">
                <strong>{d.month}</strong>
                {series.map((s, j) => (
                  <span key={s.label}>
                    <i style={{ background: s.color }} />
                    {s.label} {d.values[j]}
                  </span>
                ))}
              </span>
            )}
            <span className="ip-chart-bars" style={{ height: H }}>
              {series.map((s, j) => (
                <span key={j} className="ip-chart-bar-wrap">
                  <span className="ip-chart-val">{d.values[j]}</span>
                  <span className="ip-chart-bar" style={{ height: Math.max(2, (d.values[j] / max) * (H - 18)), background: s.color }} />
                </span>
              ))}
            </span>
            <span className="ip-chart-x">{d.month}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}

/** Sample-data chart: goals and assists per month. */
export function CareerChart({ data, goalsLabel = 'שערים', assistsLabel = 'בישולים' }: { data: Career['monthly']; goalsLabel?: string; assistsLabel?: string }) {
  return (
    <BarChart
      data={data.map((d) => ({ month: d.month, values: [d.goals, d.assists] }))}
      series={[
        { label: goalsLabel, color: CHART_BLUE },
        { label: assistsLabel, color: CHART_LIME },
      ]}
    />
  );
}
