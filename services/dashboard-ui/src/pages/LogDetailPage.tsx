import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { obs } from "../api/observability";
import { TopBar } from "../components/TopBar";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { fmtDateTime, fmtMs, fmtUsd, fmtInt } from "../lib/format";

export function LogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    obs
      .log(id)
      .then((r) => setItem(r.item as Record<string, any>))
      .catch((e) => setError(String((e as Error).message ?? e)))
      .finally(() => setLoading(false));
  }, [id]);

  const rows: [string, React.ReactNode][] = item
    ? [
        ["Event ID", <span className="mono">{item.id}</span>],
        ["Request ID", <span className="mono">{item.request_id ?? "—"}</span>],
        ["Trace ID", <span className="mono">{item.trace_id ?? "—"}</span>],
        ["Conversation", <span className="mono">{item.external_conversation_id ?? "—"}</span>],
        ["Message", <span className="mono">{item.external_message_id ?? "—"}</span>],
        ["Application", item.application_name ?? "—"],
        ["Service", item.service_name ?? "—"],
        ["Environment", item.environment ?? "—"],
        ["Provider", item.provider ?? "—"],
        ["Model", <span className="strong">{item.model ?? "—"}</span>],
        ["Streaming", item.streaming ? "yes" : "no"],
        ["Status", <StatusPill status={String(item.status)} />],
        ["Started at", fmtDateTime(item.started_at)],
        ["Completed at", fmtDateTime(item.completed_at)],
        ["Latency", fmtMs(item.latency_ms)],
        ["Time to first token", fmtMs(item.time_to_first_token_ms)],
        ["Prompt tokens", fmtInt(item.prompt_tokens)],
        ["Completion tokens", fmtInt(item.completion_tokens)],
        ["Total tokens", fmtInt(item.total_tokens)],
        ["Estimated cost", fmtUsd(item.estimated_cost_usd)],
        ["Finish reason", item.finish_reason ?? "—"],
        ["Error type", item.error_type ?? "—"],
        ["Redaction applied", item.redaction_applied ? `yes (${item.redaction_count})` : "no"],
      ]
    : [];

  return (
    <>
      <TopBar
        crumbs={[
          { label: "Observability" },
          { label: "Inference logs", href: "/logs" },
          { label: id?.slice(0, 8) ?? "" },
        ]}
        onRefresh={() => navigate(0)}
        loading={loading}
      />
      <div className="page">
        <div className="page__hd">
          <div>
            <div className="page__title">Event detail</div>
            <div className="page__sub mono">{id}</div>
          </div>
          <button className="btn btn--ghost" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>

        {error ? <div className="banner">{error}</div> : null}

        {item ? (
          <>
            <Panel title="Attributes" subtitle="normalized columns">
              <div className="kv-grid">
                {rows.map(([k, v], i) => (
                  <span key={i} style={{ display: "contents" }}>
                    <div className="k">{k}</div>
                    <div className="v">{v}</div>
                  </span>
                ))}
              </div>
            </Panel>

            <div className="grid-2">
              <Panel title="Input preview" subtitle="redacted, may be truncated">
                <div className="json-block" style={{ whiteSpace: "pre-wrap" }}>
                  {item.input_preview || <span style={{ color: "var(--text-muted)" }}>(none)</span>}
                </div>
              </Panel>
              <Panel title="Output preview" subtitle="redacted, may be truncated">
                <div className="json-block" style={{ whiteSpace: "pre-wrap" }}>
                  {item.output_preview || <span style={{ color: "var(--text-muted)" }}>(none)</span>}
                </div>
              </Panel>
            </div>

            <Panel title="Provider metadata" subtitle="raw, as emitted">
              <pre className="json-block">
                {JSON.stringify(item.provider_metadata ?? {}, null, 2)}
              </pre>
            </Panel>

            <Panel title="Request parameters" subtitle="raw, as emitted">
              <pre className="json-block">
                {JSON.stringify(item.request_params ?? {}, null, 2)}
              </pre>
            </Panel>

            {item.error_message_preview ? (
              <Panel title="Error">
                <pre className="json-block" style={{ color: "var(--error)" }}>
                  {String(item.error_message_preview)}
                </pre>
              </Panel>
            ) : null}
          </>
        ) : !loading ? (
          <div className="empty">
            <div className="empty__title">Not found</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
