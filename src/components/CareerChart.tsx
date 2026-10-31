import { useState } from 'react';
import type { Career } from '../data/demo';

/**
 * Grouped bars: goals and assists per month. Colors validated for CVD
 * separation (blue-700 / lime-700); values are direct-labeled for contrast
 * relief, and each group shows a tooltip on hover/tap.
 */
const GOALS = '#1477D6';
const ASSISTS = '#4FB51A';

export function CareerChart({ data, goalsLabel = 'שערים', assistsLabel = 'בישולים' }: { data: Career['monthly']; goalsLabel?: string; assistsLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.goals, d.assists]));
  const H = 110;
  return (
    <figure className="ip-chart">
      <div className="ip-chart-legend">
        <span><i style={{ background: GOALS }} />{goalsLabel}</span>
        <span><i style={{ background: ASSISTS }} />{assistsLabel}</span>
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
            aria-label={`${d.month}: ${d.goals} ${goalsLabel}, ${d.assists} ${assistsLabel}`}
          >
            {hover === i && (
              <span className="ip-chart-tip" role="status">
                <strong>{d.month}</strong>
                <span><i style={{ background: GOALS }} />{goalsLabel} {d.goals}</span>
                <span><i style={{ background: ASSISTS }} />{assistsLabel} {d.assists}</span>
              </span>
            )}
            <span className="ip-chart-bars" style={{ height: H }}>
              {[
                { v: d.goals, c: GOALS },
                { v: d.assists, c: ASSISTS },
              ].map((b, j) => (
                <span key={j} className="ip-chart-bar-wrap">
                  <span className="ip-chart-val">{b.v}</span>
                  <span className="ip-chart-bar" style={{ height: Math.max(2, (b.v / max) * (H - 18)), background: b.c }} />
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
