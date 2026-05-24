import { Icon } from "./Icon";

interface Props {
  label: string;
  value: string;
  unit?: string;
  swatch?: string;
  delta?: number | null;       // ratio change, e.g. 0.12 means +12%
  deltaInverted?: boolean;      // when true, "down" is good (e.g. latency, error rate)
  spark?: number[];             // mini sparkline values
  foot?: string;
}

export function KpiCard({ label, value, unit, swatch, delta, deltaInverted = false, spark, foot }: Props) {
  let deltaCls = "kpi-card__delta--flat";
  let DeltaIcon: "arrow-up" | "arrow-down" | "minus" = "minus";
  if (delta !== null && delta !== undefined && Math.abs(delta) > 0.001) {
    const up = delta > 0;
    DeltaIcon = up ? "arrow-up" : "arrow-down";
    const isGood = deltaInverted ? !up : up;
    deltaCls = isGood ? "kpi-card__delta--up" : "kpi-card__delta--down";
  }
  const deltaText =
    delta === null || delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;

  return (
    <div className="kpi-card">
      <div className="kpi-card__label">
        {swatch ? <span className="swatch" style={{ background: swatch }} /> : null}
        <span>{label}</span>
      </div>
      <div className="kpi-card__value">
        <span>{value}</span>
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="kpi-card__foot">
        <span className={`kpi-card__delta ${deltaCls}`}>
          <Icon name={DeltaIcon} size={11} strokeWidth={2.2} />
          <span>{deltaText}</span>
        </span>
        {foot ? <span>{foot}</span> : null}
      </div>
      {spark && spark.length > 1 ? <KpiSpark values={spark} color={swatch ?? "var(--accent)"} /> : null}
    </div>
  );
}

function KpiSpark({ values, color }: { values: number[]; color: string }) {
  const w = 80;
  const h = 28;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => [i * step, h - ((v - min) / range) * (h - 4) - 2] as const);
  const d = pts.map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`)).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const gradId = `g-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg className="kpi-card__spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
