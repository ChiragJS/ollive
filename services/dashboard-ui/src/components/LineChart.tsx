import { useId, useMemo, useRef, useState } from "react";

export interface SeriesPoint {
  x: number;
  y: number;
}

export interface Series {
  name: string;
  color: string;
  data: SeriesPoint[];
  fmt?: (v: number) => string;
  fill?: boolean;
}

interface Props {
  series: Series[];
  height?: number;
  yLabel?: string;
  yFmt?: (v: number) => string;
  integerYTicks?: boolean;
  yMaxOverride?: number;
  maxXTicks?: number;
}

const PLOT_PAD = { t: 7, b: 5 };

export function LineChart({
  series,
  height = 220,
  yFmt = (v) => String(Math.round(v)),
  integerYTicks = false,
  yMaxOverride,
  maxXTicks = 4,
}: Props) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const id = useId().replace(/:/g, "-");
  const [hover, setHover] = useState<{ xRatio: number } | null>(null);

  const { xMin, xMax, yRawMax, allXs } = useMemo(() => {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMax = 0;
    const xs = new Set<number>();

    for (const s of series) {
      for (const p of s.data) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y > yMax) yMax = p.y;
        xs.add(p.x);
      }
    }

    if (xMin === Infinity) {
      xMin = 0;
      xMax = 1;
    }
    if (xMin === xMax) xMax = xMin + 1;

    return {
      xMin,
      xMax,
      yRawMax: yMaxOverride ?? Math.max(1, yMax),
      allXs: Array.from(xs).sort((a, b) => a - b),
    };
  }, [series, yMaxOverride]);

  const yTicks = useMemo(
    () => integerYTicks ? integerTicks(yRawMax, 4) : continuousTicks(yRawMax, 4),
    [integerYTicks, yRawMax]
  );
  const yMax = yTicks[yTicks.length - 1] || 1;
  const xTicks = useMemo(() => chooseXTicks(allXs, maxXTicks), [allXs, maxXTicks]);

  const xToPct = (x: number) => ((x - xMin) / (xMax - xMin)) * 100;
  const yToPct = (y: number) => {
    const innerH = 100 - PLOT_PAD.t - PLOT_PAD.b;
    return PLOT_PAD.t + innerH - (y / yMax) * innerH;
  };

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localX = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, localX / rect.width));
    setHover({ xRatio: ratio });
  }

  function onLeave() {
    setHover(null);
  }

  let hoverX: number | null = null;
  let tooltipLeft = 0;
  let tooltipTransform = "translate(-50%, 0)";
  let hoverRows: { name: string; color: string; value: string }[] = [];
  if (hover && allXs.length > 0) {
    const targetX = xMin + hover.xRatio * (xMax - xMin);
    let best = allXs[0];
    let bestDist = Math.abs(targetX - best);
    for (const x of allXs) {
      const d = Math.abs(targetX - x);
      if (d < bestDist) {
        best = x;
        bestDist = d;
      }
    }

    hoverX = best;
    tooltipLeft = xToPct(best);
    if (tooltipLeft < 16) tooltipTransform = "translate(0, 0)";
    else if (tooltipLeft > 84) tooltipTransform = "translate(-100%, 0)";

    hoverRows = series.map((s) => {
      const point = s.data.find((p) => p.x === best);
      return {
        name: s.name,
        color: s.color,
        value: point ? (s.fmt ? s.fmt(point.y) : yFmt(point.y)) : "-",
      };
    });
  }

  const hasData = series.some((s) => s.data.length > 0);

  return (
    <div className="chart" style={{ height }}>
      <div className="chart__body">
        <div className="chart__y-axis" aria-hidden="true">
          {yTicks.map((v) => (
            <span key={v} className="chart__y-tick" style={{ top: `${yToPct(v)}%` }}>
              {yFmt(v)}
            </span>
          ))}
        </div>

        <div className="chart__plot-wrap">
          <div className="chart__plot" ref={plotRef} onMouseMove={onMove} onMouseLeave={onLeave}>
            <svg className="chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={i} id={`grad-${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>

              {yTicks.map((v) => {
                const y = yToPct(v);
                return (
                  <line
                    key={v}
                    x1="0"
                    x2="100"
                    y1={y}
                    y2={y}
                    className="chart-grid"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}

              <line
                x1="0"
                x2="100"
                y1={yToPct(0)}
                y2={yToPct(0)}
                className="chart-axis"
                vectorEffect="non-scaling-stroke"
              />

              {series.map((s, i) => {
                if (s.data.length === 0) return null;
                const path = s.data
                  .map((p, idx) => `${idx === 0 ? "M" : "L"}${xToPct(p.x).toFixed(2)},${yToPct(p.y).toFixed(2)}`)
                  .join(" ");
                const lastX = xToPct(s.data[s.data.length - 1].x);
                const firstX = xToPct(s.data[0].x);
                const baseY = yToPct(0);
                const area = `${path} L${lastX.toFixed(2)},${baseY.toFixed(2)} L${firstX.toFixed(2)},${baseY.toFixed(2)} Z`;

                return (
                  <g key={i}>
                    {s.fill !== false ? <path d={area} fill={`url(#grad-${id}-${i})`} stroke="none" /> : null}
                    <path
                      d={path}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {hoverX !== null ? (() => {
                      const p = s.data.find((pt) => pt.x === hoverX);
                      if (!p) return null;
                      return (
                        <circle
                          cx={xToPct(p.x)}
                          cy={yToPct(p.y)}
                          r="1.35"
                          fill={s.color}
                          stroke="var(--bg-1)"
                          strokeWidth="0.7"
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })() : null}
                  </g>
                );
              })}

              {hoverX !== null ? (
                <line
                  x1={xToPct(hoverX)}
                  x2={xToPct(hoverX)}
                  y1={PLOT_PAD.t}
                  y2={yToPct(0)}
                  stroke="var(--text-muted)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.65"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>

            {!hasData ? <div className="chart__empty">No datapoints</div> : null}

            {hoverX !== null ? (
              <div
                className="chart-tooltip"
                style={{ left: `${tooltipLeft}%`, top: 8, transform: tooltipTransform }}
              >
                <div className="chart-tooltip__time">{new Date(hoverX).toLocaleString()}</div>
                {hoverRows.map((r) => (
                  <div className="chart-tooltip__row" key={r.name}>
                    <span className="swatch" style={{ background: r.color }} />
                    <span>{r.name}</span>
                    <b>{r.value}</b>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="chart__x-axis" aria-hidden="true">
            {xTicks.map((x, i) => (
              <span
                key={`${x}-${i}`}
                className={`chart__x-tick ${i === 0 ? "is-first" : ""} ${i === xTicks.length - 1 ? "is-last" : ""}`}
                style={{ left: `${xToPct(x)}%` }}
              >
                {formatTimeTick(x, xMax - xMin)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function chooseXTicks(xs: number[], maxTicks: number): number[] {
  if (xs.length <= maxTicks) return xs;
  const last = xs.length - 1;
  const selected = new Set<number>();
  for (let i = 0; i < maxTicks; i += 1) {
    selected.add(xs[Math.round((i * last) / (maxTicks - 1))]);
  }
  return Array.from(selected).sort((a, b) => a - b);
}

function formatTimeTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs >= 3 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  }
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function integerTicks(rawMax: number, targetIntervals: number): number[] {
  const paddedMax = Math.max(1, Math.ceil(rawMax * 1.12));
  if (paddedMax <= 6) {
    return Array.from({ length: paddedMax + 1 }, (_, i) => i);
  }

  const step = Math.max(1, Math.ceil(niceCeil(paddedMax / targetIntervals)));
  const niceMax = step * Math.ceil(paddedMax / step);
  const ticks = [];
  for (let v = 0; v <= niceMax; v += step) {
    ticks.push(v);
  }
  return ticks;
}

function continuousTicks(rawMax: number, targetIntervals: number): number[] {
  const max = Math.max(1, rawMax * 1.08);
  const step = niceCeil(max / targetIntervals);
  const niceMax = step * Math.ceil(max / step);
  const ticks = [];
  for (let v = 0; v <= niceMax + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 2.5) return 2.5 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}
