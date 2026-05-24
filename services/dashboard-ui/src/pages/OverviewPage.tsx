import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { obs, type MetricsQuery } from "../api/observability";
import type {
  BreakdownRow,
  InferenceLogListItem,
  MetricsBucket,
  MetricsSummary,
} from "../types";
import { TopBar, RANGES, type RangeKey } from "../components/TopBar";
import { KpiCard } from "../components/KpiCard";
import { LineChart, type Series } from "../components/LineChart";
import { Panel } from "../components/Panel";
import { Donut } from "../components/Donut";
import { BarList } from "../components/BarList";
import { StatusPill } from "../components/StatusPill";
import { fmtCompact, fmtInt, fmtMs, fmtPct, fmtRelative, fmtUsd } from "../lib/format";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "var(--series-1)",
  deepseek: "var(--series-3)",
  groq: "var(--series-4)",
  mock: "var(--series-5)",
};
const STATUS_COLORS: Record<string, string> = {
  success: "var(--success)",
  error: "var(--error)",
  cancelled: "var(--warn)",
};
const MODEL_PALETTE = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

function rangeQuery(range: RangeKey): { q: MetricsQuery; bucket_minutes: number } {
  const def = RANGES.find((r) => r.key === range)!;
  const to = new Date();
  const from = new Date(to.getTime() - def.ms);
  return {
    q: { from: from.toISOString(), to: to.toISOString() },
    bucket_minutes: def.bucketMin,
  };
}

function previousRangeQuery(range: RangeKey): MetricsQuery {
  const def = RANGES.find((r) => r.key === range)!;
  const to = new Date(Date.now() - def.ms);
  const from = new Date(to.getTime() - def.ms);
  return { from: from.toISOString(), to: to.toISOString() };
}

function delta(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr === null || curr === undefined || prev === null || prev === undefined) return null;
  if (prev === 0) {
    if (curr === 0) return 0;
    return null;
  }
  return (curr - prev) / prev;
}

function fmtRate(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  return Math.round(n).toLocaleString("en-US");
}

function bucketLabel(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function responseLatencyMs(log: InferenceLogListItem): number | null {
  return log.time_to_first_token_ms ?? log.latency_ms ?? null;
}

export function OverviewPage() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<MetricsSummary | null>(null);
  const [series, setSeries] = useState<MetricsBucket[]>([]);
  const [byProvider, setByProvider] = useState<BreakdownRow[]>([]);
  const [byModel, setByModel] = useState<BreakdownRow[]>([]);
  const [byStatus, setByStatus] = useState<BreakdownRow[]>([]);
  const [logs, setLogs] = useState<InferenceLogListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { q, bucket_minutes } = rangeQuery(range);
      const prevQ = previousRangeQuery(range);
      const [s, prev, t, p, m, st, lg] = await Promise.all([
        obs.summary(q),
        obs.summary(prevQ),
        obs.timeseries({ ...q, bucket_minutes }),
        obs.breakdown("provider", q),
        obs.breakdown("model", q),
        obs.breakdown("status", q),
        obs.logs({ limit: 100, ...q }),
      ]);
      setSummary(s);
      setPrevSummary(prev);
      setSeries(t.items);
      setByProvider(p.items);
      setByModel(m.items);
      setByStatus(st.items);
      setLogs(lg.items);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const sparkRequests = useMemo(
    () => series.map((b) => b.request_count),
    [series]
  );
  const sparkLatency = useMemo(
    () => series.map((b) => Math.round(b.avg_response_start_latency_ms ?? b.avg_latency_ms ?? 0)),
    [series]
  );
  const sparkTokens = useMemo(() => series.map((b) => b.total_tokens), [series]);
  const sparkErrors = useMemo(() => series.map((b) => b.error_count), [series]);

  const reqRateSeries: Series[] = useMemo(() => {
    const ok = series.map((b) => ({
      x: new Date(b.bucket).getTime(),
      y: Math.max(0, b.request_count - b.error_count - b.cancelled_count),
    }));
    const err = series.map((b) => ({
      x: new Date(b.bucket).getTime(),
      y: b.error_count,
    }));
    const cancel = series.map((b) => ({
      x: new Date(b.bucket).getTime(),
      y: b.cancelled_count,
    }));
    return [
      { name: "Success", color: "var(--success)", data: ok, fmt: (v) => fmtInt(v) },
      { name: "Cancelled", color: "var(--warn)", data: cancel, fmt: (v) => fmtInt(v) },
      { name: "Error", color: "var(--error)", data: err, fmt: (v) => fmtInt(v) },
    ];
  }, [series]);

  const latencySeries: Series[] = useMemo(() => {
    const avg = series.map((b) => ({
      x: new Date(b.bucket).getTime(),
      y: Math.round(b.avg_response_start_latency_ms ?? b.avg_latency_ms ?? 0),
    }));
    return [{ name: "Avg first token", color: "var(--accent)", data: avg, fmt: (v) => fmtMs(v) }];
  }, [series]);

  const errorSeries: Series[] = useMemo(() => {
    const err = series.map((b) => ({
      x: new Date(b.bucket).getTime(),
      y: b.error_count,
    }));
    const cancel = series.map((b) => ({
      x: new Date(b.bucket).getTime(),
      y: b.cancelled_count,
    }));
    return [
      { name: "Errors", color: "var(--error)", data: err, fmt: (v) => fmtInt(v) },
      { name: "Cancelled", color: "var(--warn)", data: cancel, fmt: (v) => fmtInt(v) },
    ];
  }, [series]);

  const providerSlices = useMemo(
    () =>
      byProvider.map((p, i) => ({
        key: p.key || "—",
        value: p.request_count,
        color: PROVIDER_COLORS[p.key] ?? MODEL_PALETTE[i % MODEL_PALETTE.length],
      })),
    [byProvider]
  );
  const statusSlices = useMemo(
    () =>
      byStatus.map((s) => ({
        key: s.key,
        value: s.request_count,
        color: STATUS_COLORS[s.key] ?? "var(--text-muted)",
      })),
    [byStatus]
  );

  const modelRows = useMemo(
    () =>
      byModel.map((m, i) => ({
        key: m.key || "—",
        value: m.request_count,
        sub: `${fmtMs(m.avg_latency_ms)} avg · ${fmtCompact(m.total_tokens)} tok`,
        color: MODEL_PALETTE[i % MODEL_PALETTE.length],
      })),
    [byModel]
  );

  const latencyModelRows = useMemo(
    () =>
      [...byModel]
        .sort((a, b) => (b.avg_latency_ms ?? 0) - (a.avg_latency_ms ?? 0))
        .map((m, i) => ({
          key: m.key || "—",
          value: Math.max(0, Math.round(m.avg_response_start_latency_ms ?? m.avg_latency_ms ?? 0)),
          valueLabel: fmtMs(m.avg_response_start_latency_ms ?? m.avg_latency_ms),
          sub: `${fmtInt(m.request_count)} calls · total avg ${fmtMs(m.avg_latency_ms)}`,
          color: MODEL_PALETTE[i % MODEL_PALETTE.length],
        })),
    [byModel]
  );

  const errorModelRows = useMemo(
    () =>
      byModel
        .filter((m) => m.error_count > 0)
        .sort((a, b) => b.error_count - a.error_count)
        .map((m, i) => ({
          key: m.key || "—",
          value: m.error_count,
          sub: `${fmtPct(m.request_count ? m.error_count / m.request_count : 0)} of ${fmtInt(m.request_count)} calls`,
          color: MODEL_PALETTE[(i + 4) % MODEL_PALETTE.length],
        })),
    [byModel]
  );

  const currentRange = RANGES.find((r) => r.key === range)!;
  const windowMinutes = currentRange.ms / 60_000;
  const throughputPerMin = summary ? summary.request_count / windowMinutes : null;
  const prevThroughputPerMin = prevSummary ? prevSummary.request_count / windowMinutes : null;
  const successPerMin = summary ? summary.success_count / windowMinutes : null;
  const avgPerBucket = series.length > 0 && summary ? summary.request_count / series.length : null;
  const activeBuckets = series.filter((b) => b.request_count > 0).length;
  const peakBucket = series.reduce<MetricsBucket | null>(
    (best, b) => (!best || b.request_count > best.request_count ? b : best),
    null
  );
  const latencySpread =
    summary?.p95_latency_ms !== null &&
    summary?.p95_latency_ms !== undefined &&
    summary?.p50_latency_ms !== null &&
    summary?.p50_latency_ms !== undefined
      ? Math.max(0, summary.p95_latency_ms - summary.p50_latency_ms)
      : null;
  const p95ResponseLatency = summary?.p95_response_start_latency_ms ?? summary?.p95_latency_ms;
  const p50ResponseLatency = summary?.p50_response_start_latency_ms ?? summary?.p50_latency_ms;
  const avgResponseLatency = summary?.avg_response_start_latency_ms ?? summary?.avg_latency_ms;
  const recentLogs = logs.slice(0, 12);
  const slowSamples = useMemo(
    () =>
      logs
        .filter((l) => responseLatencyMs(l) !== null)
        .sort((a, b) => (responseLatencyMs(b) ?? 0) - (responseLatencyMs(a) ?? 0))
        .slice(0, 5),
    [logs]
  );
  const errorSamples = useMemo(
    () => logs.filter((l) => l.status === "error" || l.status === "timeout").slice(0, 5),
    [logs]
  );

  const successRate =
    summary && summary.request_count > 0 ? summary.success_count / summary.request_count : null;
  const prevSuccessRate =
    prevSummary && prevSummary.request_count > 0
      ? prevSummary.success_count / prevSummary.request_count
      : null;

  return (
    <>
      <TopBar
        crumbs={[{ label: "Observability" }, { label: "Overview" }]}
        range={range}
        onRangeChange={setRange}
        onRefresh={() => void load()}
        loading={loading}
      />
      <div className="page">
        <div className="page__hd">
          <div>
            <div className="page__title">LLM inference metrics dashboard</div>
            <div className="page__sub">
              Assignment-ready observability for latency, throughput, and errors across foundation-model calls.
            </div>
          </div>
        </div>

        {error ? (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}

        <div className="kpi-strip">
          <KpiCard
            label="Requests"
            value={fmtCompact(summary?.request_count)}
            swatch="var(--accent)"
            delta={delta(summary?.request_count, prevSummary?.request_count)}
            spark={sparkRequests}
            foot={`${fmtInt(summary?.success_count)} ok · ${fmtInt(summary?.error_count)} err`}
          />
          <KpiCard
            label="Success rate"
            value={successRate === null ? "—" : `${(successRate * 100).toFixed(1)}`}
            unit={successRate === null ? "" : "%"}
            swatch="var(--success)"
            delta={delta(successRate, prevSuccessRate)}
            foot={`error ${fmtPct(summary?.error_rate)}`}
          />
          <KpiCard
            label="p95 response start"
            value={
              p95ResponseLatency !== null && p95ResponseLatency !== undefined
                ? p95ResponseLatency >= 1000
                  ? (p95ResponseLatency / 1000).toFixed(2)
                  : Math.round(p95ResponseLatency).toString()
                : "—"
            }
            unit={
              p95ResponseLatency !== null && p95ResponseLatency !== undefined
                ? p95ResponseLatency >= 1000
                  ? "s"
                  : "ms"
                : ""
            }
            swatch="var(--purple)"
            delta={delta(
              p95ResponseLatency,
              prevSummary?.p95_response_start_latency_ms ?? prevSummary?.p95_latency_ms
            )}
            deltaInverted
            spark={sparkLatency}
            foot={`total p95 ${fmtMs(summary?.p95_latency_ms)}`}
          />
          <KpiCard
            label="Tokens"
            value={fmtCompact(summary?.total_tokens)}
            swatch="var(--teal)"
            delta={delta(summary?.total_tokens, prevSummary?.total_tokens)}
            spark={sparkTokens}
            foot="prompt + completion"
          />
          <KpiCard
            label="Est. cost"
            value={fmtUsd(summary?.estimated_cost_usd)}
            swatch="var(--warn)"
            delta={delta(
              summary?.estimated_cost_usd ? parseFloat(summary.estimated_cost_usd) : 0,
              prevSummary?.estimated_cost_usd ? parseFloat(prevSummary.estimated_cost_usd) : 0
            )}
            spark={sparkErrors}
            foot="USD · this window"
          />
        </div>

        <section className="assignment-board">
          <div className="metric-section__head">
            <div>
              <div className="metric-section__eyebrow">Required metrics</div>
              <h2>Latency, throughput, and error dashboard</h2>
            </div>
            <div className="metric-section__chips">
              <span>Throughput</span>
              <span>Latency</span>
              <span>Errors</span>
            </div>
          </div>

          <div className="metric-deck">
            <article className="metric-card metric-card--throughput">
              <div className="metric-card__top">
                <span className="metric-card__kicker">Throughput</span>
                <span className="metric-card__unit">events / min</span>
              </div>
              <div className="metric-card__hero">
                <span>{fmtRate(throughputPerMin)}</span>
                <small>req/min</small>
              </div>
              <div className="metric-stat-grid">
                <MetricStat label="Total calls" value={fmtInt(summary?.request_count)} hint={`${fmtInt(summary?.success_count)} successful`} />
                <MetricStat label="Peak bucket" value={fmtInt(peakBucket?.request_count)} hint={`${bucketLabel(peakBucket?.bucket)} · ${currentRange.bucketMin}m bucket`} />
                <MetricStat label="Active buckets" value={`${activeBuckets}/${series.length || 0}`} hint={`avg ${fmtRate(avgPerBucket)} per bucket`} />
                <MetricStat label="Success flow" value={fmtRate(successPerMin)} hint="successful calls / min" />
              </div>
              <div className="legend metric-legend">
                <span><span className="legend__dot" style={{ background: "var(--success)" }} /> Success</span>
                <span><span className="legend__dot" style={{ background: "var(--warn)" }} /> Cancelled</span>
                <span><span className="legend__dot" style={{ background: "var(--error)" }} /> Error</span>
              </div>
              <LineChart series={reqRateSeries} height={170} yFmt={(v) => fmtInt(v)} integerYTicks />
              <div className="metric-card__foot">Compared with previous window: {delta(throughputPerMin, prevThroughputPerMin) === null ? "no baseline" : fmtPct(delta(throughputPerMin, prevThroughputPerMin), 1)}</div>
            </article>

            <article className="metric-card metric-card--latency">
              <div className="metric-card__top">
                <span className="metric-card__kicker">Latency</span>
                <span className="metric-card__unit">time to first token</span>
              </div>
              <div className="metric-card__hero">
                <span>{fmtMs(p95ResponseLatency)}</span>
                <small>p95 response start</small>
              </div>
              <div className="metric-stat-grid">
                <MetricStat label="Average start" value={fmtMs(avgResponseLatency)} hint="mean first-token latency" />
                <MetricStat label="p50 start" value={fmtMs(p50ResponseLatency)} hint="median perceived wait" />
                <MetricStat label="Total p95" value={fmtMs(summary?.p95_latency_ms)} hint="full stream duration" />
                <MetricStat label="Slowest start" value={fmtMs(slowSamples[0] ? responseLatencyMs(slowSamples[0]) : null)} hint={slowSamples[0] ? `${slowSamples[0].provider} · ${slowSamples[0].model}` : "no samples"} />
              </div>
              <div className="legend metric-legend">
                <span><span className="legend__dot" style={{ background: "var(--accent)" }} /> Avg first token</span>
              </div>
              <LineChart series={latencySeries} height={170} yFmt={(v) => `${Math.round(v)}`} />
              <div className="metric-card__foot">Full stream duration is tracked separately because long answers can start instantly but finish later.</div>
            </article>

            <article className="metric-card metric-card--errors">
              <div className="metric-card__top">
                <span className="metric-card__kicker">Errors</span>
                <span className="metric-card__unit">failed + cancelled</span>
              </div>
              <div className="metric-card__hero">
                <span>{fmtPct(summary?.error_rate, 1)}</span>
                <small>error rate</small>
              </div>
              <div className="metric-stat-grid">
                <MetricStat label="Errors" value={fmtInt(summary?.error_count)} hint="provider failures" />
                <MetricStat label="Cancelled" value={fmtInt(summary?.cancelled_count)} hint="client/user stops" />
                <MetricStat label="Success rate" value={successRate === null ? "—" : fmtPct(successRate, 1)} hint="completed successfully" />
                <MetricStat label="Recent samples" value={fmtInt(errorSamples.length)} hint="from latest 100 logs" />
              </div>
              <div className="legend metric-legend">
                <span><span className="legend__dot" style={{ background: "var(--error)" }} /> Error</span>
                <span><span className="legend__dot" style={{ background: "var(--warn)" }} /> Cancelled</span>
              </div>
              <LineChart series={errorSeries} height={170} yFmt={(v) => fmtInt(v)} integerYTicks />
              <div className="metric-card__foot">Errors remain visible even when total traffic is low.</div>
            </article>
          </div>
        </section>

        <div className="grid-3 metric-detail-grid">
          <Panel title="Throughput by provider" subtitle="volume + error mix">
            <ProviderHealth rows={byProvider} />
          </Panel>
          <Panel title="Latency by model" subtitle="first-token average first">
            <BarList rows={latencyModelRows} emptyLabel="No latency samples" />
          </Panel>
          <Panel title="Errors by model" subtitle="models causing failed calls">
            <BarList rows={errorModelRows} emptyLabel="No model errors in this window" />
          </Panel>
        </div>

        <div className="grid-2">
          <Panel title="Slowest response starts" subtitle="latest 100 logs" flush>
            <SampleTable rows={slowSamples} navigate={navigate} emptyLabel="No latency samples yet" />
          </Panel>
          <Panel title="Recent error samples" subtitle="latest 100 logs" flush>
            <SampleTable rows={errorSamples} navigate={navigate} emptyLabel="No recent errors" />
          </Panel>
        </div>

        <div className="grid-3">
          <Panel title="By provider">
            <Donut slices={providerSlices} total={summary?.request_count ?? 0} />
          </Panel>
          <Panel title="By model">
            <BarList rows={modelRows} />
          </Panel>
          <Panel title="By status">
            <Donut slices={statusSlices} total={summary?.request_count ?? 0} />
          </Panel>
        </div>

        <Panel
          title="Recent inference calls"
          subtitle={`last ${recentLogs.length}`}
          right={
            <a className="sub-link" href="/logs" onClick={(e) => { e.preventDefault(); navigate("/logs"); }}>
              View all →
            </a>
          }
          flush
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Provider / Model</th>
                  <th>Status</th>
                  <th className="col-r">Latency</th>
                  <th className="col-r">TTFT</th>
                  <th className="col-r">Tokens</th>
                  <th className="col-r">Cost</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={8} className="empty">No inference logs yet — drive some traffic through the chat app.</td></tr>
                ) : recentLogs.map((l) => (
                  <tr key={l.id} className="row-link" onClick={() => navigate(`/logs/${l.id}`)}>
                    <td className="col-mono">{fmtRelative(l.completed_at)}</td>
                    <td>
                      <div className="strong">{l.model}</div>
                      <div className="col-muted" style={{ fontSize: 11.5 }}>
                        {l.provider} · {l.streaming ? "stream" : "unary"}
                      </div>
                    </td>
                    <td><StatusPill status={l.status} /></td>
                    <td className="col-r col-mono">{fmtMs(l.latency_ms)}</td>
                    <td className="col-r col-mono">{fmtMs(l.time_to_first_token_ms)}</td>
                    <td className="col-r col-mono">{fmtInt(l.total_tokens)}</td>
                    <td className="col-r col-mono">{fmtUsd(l.estimated_cost_usd)}</td>
                    <td className="col-muted" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {l.output_preview || l.input_preview || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function MetricStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="metric-stat">
      <div className="metric-stat__label">{label}</div>
      <div className="metric-stat__value">{value}</div>
      <div className="metric-stat__hint">{hint}</div>
    </div>
  );
}

function ProviderHealth({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: "16px 0" }}>No provider traffic yet</div>;
  }
  return (
    <div className="provider-health">
      {rows.map((r) => {
        const errorRate = r.request_count > 0 ? r.error_count / r.request_count : 0;
        const ok = Math.max(0, r.request_count - r.error_count);
        return (
          <div className="provider-health__row" key={r.key || "unknown"}>
            <div>
              <div className="provider-health__name">{r.key || "—"}</div>
              <div className="provider-health__sub">{fmtInt(ok)} ok · {fmtInt(r.error_count)} err · {fmtMs(r.avg_latency_ms)} avg</div>
            </div>
            <div className="provider-health__meter" aria-label={`${r.key} success and error split`}>
              <span style={{ width: `${Math.max(0, 100 - errorRate * 100)}%` }} />
              <b style={{ width: `${Math.min(100, errorRate * 100)}%` }} />
            </div>
            <div className="provider-health__count">{fmtInt(r.request_count)}</div>
          </div>
        );
      })}
    </div>
  );
}

function SampleTable({
  rows,
  navigate,
  emptyLabel,
}: {
  rows: InferenceLogListItem[];
  navigate: (to: string) => void;
  emptyLabel: string;
}) {
  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <thead>
          <tr>
            <th>When</th>
            <th>Model</th>
            <th>Status</th>
              <th className="col-r">First token</th>
              <th className="col-r">Total</th>
              <th className="col-r">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="empty">{emptyLabel}</td></tr>
          ) : rows.map((l) => (
            <tr key={l.id} className="row-link" onClick={() => navigate(`/logs/${l.id}`)}>
              <td className="col-mono">{fmtRelative(l.completed_at)}</td>
              <td>
                <div className="strong">{l.model}</div>
                <div className="col-muted" style={{ fontSize: 11.5 }}>{l.provider}</div>
              </td>
              <td><StatusPill status={l.status} /></td>
              <td className="col-r col-mono">{fmtMs(responseLatencyMs(l))}</td>
              <td className="col-r col-mono">{fmtMs(l.latency_ms)}</td>
              <td className="col-r col-mono">{fmtInt(l.total_tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
