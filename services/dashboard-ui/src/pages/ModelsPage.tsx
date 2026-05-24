import { useCallback, useEffect, useState } from "react";
import { obs } from "../api/observability";
import type { BreakdownRow } from "../types";
import { TopBar, RANGES, type RangeKey } from "../components/TopBar";
import { Panel } from "../components/Panel";
import { fmtCompact, fmtInt, fmtMs, fmtPct, fmtUsd } from "../lib/format";

const MODEL_PALETTE = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

export function ModelsPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [rows, setRows] = useState<BreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const def = RANGES.find((r) => r.key === range)!;
      const to = new Date();
      const from = new Date(to.getTime() - def.ms);
      const r = await obs.breakdown("model", { from: from.toISOString(), to: to.toISOString() });
      setRows(r.items);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalReq = rows.reduce((a, r) => a + r.request_count, 0);

  return (
    <>
      <TopBar
        crumbs={[{ label: "Observability" }, { label: "Models" }]}
        range={range}
        onRangeChange={setRange}
        onRefresh={() => void load()}
        loading={loading}
      />
      <div className="page">
        <div className="page__hd">
          <div>
            <div className="page__title">Models</div>
            <div className="page__sub">Volume, latency, and cost per model in the selected window.</div>
          </div>
        </div>

        {error ? <div className="banner">{error}</div> : null}

        <Panel title="All models" subtitle={`${rows.length} model${rows.length === 1 ? "" : "s"}`} flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="col-r">Share</th>
                  <th className="col-r">Requests</th>
                  <th className="col-r">Errors</th>
                  <th className="col-r">Avg latency</th>
                  <th className="col-r">Tokens</th>
                  <th className="col-r">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty">
                      <div className="empty__title">No model traffic in this window</div>
                    </td>
                  </tr>
                ) : rows.map((r, i) => {
                  const share = totalReq > 0 ? r.request_count / totalReq : 0;
                  const errRate = r.request_count > 0 ? r.error_count / r.request_count : 0;
                  return (
                    <tr key={r.key}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: MODEL_PALETTE[i % MODEL_PALETTE.length],
                            }}
                          />
                          <span className="strong">{r.key || "—"}</span>
                        </div>
                      </td>
                      <td className="col-r col-mono">{fmtPct(share, 1)}</td>
                      <td className="col-r col-mono">{fmtInt(r.request_count)}</td>
                      <td className="col-r col-mono" style={{ color: errRate > 0 ? "var(--error)" : "inherit" }}>
                        {fmtInt(r.error_count)}
                      </td>
                      <td className="col-r col-mono">{fmtMs(r.avg_latency_ms)}</td>
                      <td className="col-r col-mono">{fmtCompact(r.total_tokens)}</td>
                      <td className="col-r col-mono">{fmtUsd(r.estimated_cost_usd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
