export interface InferenceLogListItem {
  id: string;
  request_id: string | null;
  trace_id: string | null;
  external_conversation_id: string | null;
  provider: string;
  model: string;
  streaming: boolean;
  status: "success" | "error" | "cancelled" | "timeout";
  latency_ms: number | null;
  time_to_first_token_ms: number | null;
  total_tokens: number | null;
  estimated_cost_usd: string | null;
  input_preview: string | null;
  output_preview: string | null;
  completed_at: string | null;
}

export interface MetricsSummary {
  request_count: number;
  success_count: number;
  error_count: number;
  cancelled_count: number;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_response_start_latency_ms: number | null;
  p50_response_start_latency_ms: number | null;
  p95_response_start_latency_ms: number | null;
  total_tokens: number;
  estimated_cost_usd: string;
  error_rate: number;
}

export interface MetricsBucket {
  bucket: string;
  request_count: number;
  error_count: number;
  cancelled_count: number;
  avg_latency_ms: number | null;
  avg_response_start_latency_ms: number | null;
  total_tokens: number;
}

export interface BreakdownRow {
  key: string;
  request_count: number;
  error_count: number;
  avg_latency_ms: number | null;
  avg_response_start_latency_ms: number | null;
  total_tokens: number;
  estimated_cost_usd: string;
}
