import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { obs } from "../api/observability";
import type { InferenceLogListItem } from "../types";
import { TopBar } from "../components/TopBar";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { Icon } from "../components/Icon";
import { fmtInt, fmtMs, fmtRelative, fmtUsd } from "../lib/format";

const STATUSES = ["success", "error", "timeout", "cancelled"];
const PROVIDERS = ["mock", "openai", "deepseek", "groq"];

export function LogsPage() {
  const [items, setItems] = useState<InferenceLogListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await obs.logs({
        limit: 200,
        status: status ?? undefined,
        provider: provider ?? undefined,
      });
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [status, provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((l) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      l.model?.toLowerCase().includes(q) ||
      l.provider?.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q) ||
      (l.external_conversation_id ?? "").toLowerCase().includes(q) ||
      (l.output_preview ?? "").toLowerCase().includes(q) ||
      (l.input_preview ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <>
      <TopBar
        crumbs={[{ label: "Observability" }, { label: "Inference logs" }]}
        onRefresh={() => void load()}
        loading={loading}
      />
      <div className="page">
        <div className="page__hd">
          <div>
            <div className="page__title">Inference logs</div>
            <div className="page__sub">
              One row per LLM provider call. Click any row for the full event.
            </div>
          </div>
        </div>

        {error ? (
          <div className="banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}

        <Panel
          title="Filters"
          right={
            <button className="btn btn--ghost btn--sm" onClick={() => { setStatus(null); setProvider(null); setSearch(""); }}>
              Clear
            </button>
          }
        >
          <div className="filter-row">
            <span className="filter-row__label">Status</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`filter-chip ${status === s ? "is-on" : ""}`}
                onClick={() => setStatus(status === s ? null : s)}
              >
                {s}
              </button>
            ))}
            <span style={{ width: 12 }} />
            <span className="filter-row__label">Provider</span>
            {PROVIDERS.map((p) => (
              <button
                key={p}
                className={`filter-chip ${provider === p ? "is-on" : ""}`}
                onClick={() => setProvider(provider === p ? null : p)}
              >
                {p}
              </button>
            ))}
            <span className="spacer" />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "5px 10px",
              }}
            >
              <Icon name="search" size={14} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search model, id, preview…"
                style={{ border: 0, outline: 0, width: 240, fontSize: 13, color: "var(--text)" }}
              />
            </label>
          </div>
        </Panel>

        <Panel title={`Events`} subtitle={`${filtered.length} of ${items.length}`} flush>
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
                  <th>Conversation</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty">
                      <div className="empty__title">No matching events</div>
                      <div>Adjust filters, or send a few messages through the chat app.</div>
                    </td>
                  </tr>
                ) : filtered.map((l) => (
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
                    <td className="col-mono col-muted">
                      {l.external_conversation_id ? l.external_conversation_id.slice(0, 8) : "—"}
                    </td>
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
