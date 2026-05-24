import { Icon } from "./Icon";

export type RangeKey = "15m" | "1h" | "6h" | "24h" | "7d";

export const RANGES: { key: RangeKey; label: string; ms: number; bucketMin: number }[] = [
  { key: "15m", label: "Last 15m", ms: 15 * 60 * 1000, bucketMin: 1 },
  { key: "1h",  label: "Last 1h",  ms: 60 * 60 * 1000, bucketMin: 1 },
  { key: "6h",  label: "Last 6h",  ms: 6 * 60 * 60 * 1000, bucketMin: 5 },
  { key: "24h", label: "Last 24h", ms: 24 * 60 * 60 * 1000, bucketMin: 15 },
  { key: "7d",  label: "Last 7d",  ms: 7 * 24 * 60 * 60 * 1000, bucketMin: 60 },
];

interface Props {
  crumbs: { label: string; href?: string }[];
  range?: RangeKey;
  onRangeChange?: (r: RangeKey) => void;
  onRefresh?: () => void;
  loading?: boolean;
  live?: boolean;
}

export function TopBar({ crumbs, range, onRangeChange, onRefresh, loading, live = true }: Props) {
  return (
    <div className="topbar">
      <div className="crumb">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {c.href ? <a href={c.href}>{c.label}</a> : i === crumbs.length - 1 ? <b>{c.label}</b> : c.label}
            {i < crumbs.length - 1 ? <Icon name="chevron-right" size={14} /> : null}
          </span>
        ))}
      </div>
      <span className="spacer" />
      {live ? (
        <span className="live-pill">
          <span className="live-dot" />
          Live
        </span>
      ) : null}
      {range && onRangeChange ? (
        <div className="timepick">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={r.key === range ? "is-on" : ""}
              onClick={() => onRangeChange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      {onRefresh ? (
        <button
          className="icon-btn"
          onClick={onRefresh}
          title="Refresh"
          style={loading ? { color: "var(--accent)" } : undefined}
        >
          <Icon name="refresh" size={16} />
        </button>
      ) : null}
    </div>
  );
}
