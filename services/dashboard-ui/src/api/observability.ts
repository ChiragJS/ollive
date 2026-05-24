import type {
  BreakdownRow,
  InferenceLogListItem,
  MetricsBucket,
  MetricsSummary,
} from "../types";

const BASE = "/api";

async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${detail}`);
  }
  return (await res.json()) as T;
}

export type MetricsQuery = {
  from?: string;
  to?: string;
  application?: string;
  provider?: string;
  model?: string;
};

function qs(params: object): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  const search = new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)]) as [string, string][]
  );
  return `?${search.toString()}`;
}

export const obs = {
  summary(q: MetricsQuery = {}): Promise<MetricsSummary> {
    return req(`/v1/metrics/summary${qs(q)}`);
  },
  timeseries(q: MetricsQuery & { bucket_minutes?: number } = {}): Promise<{
    items: MetricsBucket[];
  }> {
    return req(`/v1/metrics/timeseries${qs(q)}`);
  },
  breakdown(
    group_by: "provider" | "model" | "status" | "application",
    q: MetricsQuery = {}
  ): Promise<{ items: BreakdownRow[] }> {
    return req(`/v1/metrics/breakdown${qs({ group_by, ...q })}`);
  },
  logs(
    q: {
      limit?: number;
      status?: string;
      provider?: string;
      model?: string;
      conversation_id?: string;
      from?: string;
      to?: string;
    } = {}
  ): Promise<{ items: InferenceLogListItem[] }> {
    return req(`/v1/inference-logs${qs(q)}`);
  },
  log(id: string): Promise<{ item: Record<string, unknown> }> {
    return req(`/v1/inference-logs/${id}`);
  },
};
