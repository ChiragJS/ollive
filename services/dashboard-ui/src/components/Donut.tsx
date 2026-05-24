interface Slice {
  key: string;
  value: number;
  color: string;
}

interface Props {
  slices: Slice[];
  total: number;
  centerLabel?: string;
  centerSub?: string;
}

export function Donut({ slices, total, centerLabel, centerSub }: Props) {
  const size = 132;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  const safeTotal = Math.max(1, slices.reduce((a, s) => a + s.value, 0));
  let offset = 0;

  const valueDisplay = centerLabel ?? safeTotal.toLocaleString("en-US");
  const subDisplay = centerSub ?? `${total === 0 ? "—" : "events"}`;

  return (
    <div className="donut-row">
      <div className="donut">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--bg-3)"
            strokeWidth={stroke}
          />
          {slices.map((s) => {
            const frac = s.value / safeTotal;
            const dash = circ * frac;
            const gap = circ - dash;
            const el = (
              <circle
                key={s.key}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="donut__center">
          <div>
            <div className="donut__big">{valueDisplay}</div>
            <div className="donut__sub">{subDisplay}</div>
          </div>
        </div>
      </div>
      <div className="donut-legend">
        {slices.map((s) => {
          const pct = ((s.value / safeTotal) * 100).toFixed(1);
          return (
            <div className="donut-legend__row" key={s.key}>
              <span className="swatch" style={{ background: s.color }} />
              <span className="name">{s.key}</span>
              <span className="pct">
                {s.value.toLocaleString()} · {pct}%
              </span>
            </div>
          );
        })}
        {slices.length === 0 ? <span className="faint">No data</span> : null}
      </div>
    </div>
  );
}
