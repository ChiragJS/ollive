interface Row {
  key: string;
  value: number;
  valueLabel?: string;
  sub?: string;
  color: string;
}

interface Props {
  rows: Row[];
  emptyLabel?: string;
}

export function BarList({ rows, emptyLabel = "No data" }: Props) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: "16px 0" }}>{emptyLabel}</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <div className="barlist__row" key={r.key}>
            <div className="barlist__bar" style={{ width: `${pct}%`, background: r.color }} />
            <span className="barlist__name">
              <span className="swatch" style={{ background: r.color }} />
              <span>{r.key}</span>
              {r.sub ? <span className="sub">· {r.sub}</span> : null}
            </span>
            <span className="barlist__count">{r.valueLabel ?? r.value.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}
