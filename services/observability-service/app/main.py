from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .consumer import run_consumer
from .db import Database
from .ingestion import ingest_raw_event

app = FastAPI(
    title="Ollive Inference Observability Service",
    version="0.1.0",
    description="Ingestion, validation, normalization, and dashboard APIs for LLM inference telemetry.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = Database(settings.database_url)


@app.on_event("startup")
async def startup() -> None:
    _ensure_schema()
    asyncio.create_task(run_consumer(db, settings))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.service_name}


@app.post("/v1/ingest/events", status_code=202)
def ingest_event(payload: dict[str, Any]) -> dict[str, Any]:
    result = ingest_raw_event(db, payload)
    return _json_ready(result)


@app.get("/v1/inference-logs")
def list_inference_logs(
    limit: int = Query(default=50, ge=1, le=200),
    status: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    conversation_id: str | None = None,
    from_ts: datetime | None = Query(default=None, alias="from"),
    to_ts: datetime | None = Query(default=None, alias="to"),
) -> dict[str, Any]:
    clauses = []
    params: list[Any] = []
    if status:
        clauses.append("status = %s")
        params.append(status)
    if provider:
        clauses.append("provider = %s")
        params.append(provider)
    if model:
        clauses.append("model = %s")
        params.append(model)
    if conversation_id:
        clauses.append("external_conversation_id = %s")
        params.append(conversation_id)
    if from_ts:
        clauses.append("COALESCE(completed_at, created_at) >= %s")
        params.append(from_ts)
    if to_ts:
        clauses.append("COALESCE(completed_at, created_at) <= %s")
        params.append(to_ts)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.fetch_all(
        f"""
        SELECT id, request_id, trace_id, session_id, external_conversation_id, external_message_id,
               application_name, service_name, environment, provider, model, model_alias, streaming,
               status, latency_ms, time_to_first_token_ms, prompt_tokens, completion_tokens, total_tokens,
               estimated_cost_usd, error_type, error_message_preview, finish_reason,
               input_preview, output_preview, redaction_applied, redaction_count,
               redaction_policy, redaction_types, redaction_metadata,
               started_at, completed_at, created_at
        FROM inference_logs
        {where}
        ORDER BY COALESCE(completed_at, created_at) DESC
        LIMIT %s
        """,
        tuple(params + [limit]),
    )
    return {"items": _json_ready(rows)}


@app.get("/v1/inference-logs/{log_id}")
def get_inference_log(log_id: uuid.UUID) -> dict[str, Any]:
    row = db.fetch_one("SELECT * FROM inference_logs WHERE id = %s", (log_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Inference log not found")
    return {"item": _json_ready(row)}


@app.get("/v1/metrics/summary")
def metrics_summary(
    from_ts: datetime | None = Query(default=None, alias="from"),
    to_ts: datetime | None = Query(default=None, alias="to"),
    application: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    where, params = _metric_filters(from_ts, to_ts, application, provider, model)
    row = db.fetch_one(
        f"""
        SELECT
          COUNT(*)::int AS request_count,
          COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
          COUNT(*) FILTER (WHERE status IN ('error', 'timeout'))::int AS error_count,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
          COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
          COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p50_latency_ms,
          COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int AS p95_latency_ms,
          ROUND(AVG(COALESCE(time_to_first_token_ms, latency_ms)))::int AS avg_response_start_latency_ms,
          (percentile_cont(0.50) WITHIN GROUP (ORDER BY COALESCE(time_to_first_token_ms, latency_ms))
            FILTER (WHERE COALESCE(time_to_first_token_ms, latency_ms) IS NOT NULL))::int AS p50_response_start_latency_ms,
          (percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(time_to_first_token_ms, latency_ms))
            FILTER (WHERE COALESCE(time_to_first_token_ms, latency_ms) IS NOT NULL))::int AS p95_response_start_latency_ms,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
          COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
        FROM inference_logs
        {where}
        """,
        tuple(params),
    )
    request_count = row["request_count"] or 0
    row["error_rate"] = (row["error_count"] / request_count) if request_count else 0
    return _json_ready(row)


@app.get("/v1/metrics/timeseries")
def metrics_timeseries(
    bucket_minutes: int = Query(default=5, ge=1, le=60),
    from_ts: datetime | None = Query(default=None, alias="from"),
    to_ts: datetime | None = Query(default=None, alias="to"),
    application: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    where, params = _metric_filters(from_ts, to_ts, application, provider, model)
    params = [bucket_minutes * 60, *params]
    rows = db.fetch_all(
        f"""
        SELECT
          to_timestamp(floor(extract(epoch from COALESCE(completed_at, created_at)) / %s) * %s) AS bucket,
          COUNT(*)::int AS request_count,
          COUNT(*) FILTER (WHERE status IN ('error', 'timeout'))::int AS error_count,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
          COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
          ROUND(AVG(COALESCE(time_to_first_token_ms, latency_ms)))::int AS avg_response_start_latency_ms,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens
        FROM inference_logs
        {where}
        GROUP BY bucket
        ORDER BY bucket ASC
        """,
        tuple([params[0], *params]),
    )
    return {"items": _json_ready(rows)}


@app.get("/v1/metrics/breakdown")
def metrics_breakdown(group_by: str = Query(default="model", pattern="^(provider|model|status|application)$")) -> dict[str, Any]:
    column = {
        "provider": "provider",
        "model": "model",
        "status": "status",
        "application": "application_name",
    }[group_by]
    rows = db.fetch_all(
        f"""
        SELECT {column} AS key,
               COUNT(*)::int AS request_count,
               COUNT(*) FILTER (WHERE status IN ('error', 'timeout'))::int AS error_count,
               COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
               ROUND(AVG(COALESCE(time_to_first_token_ms, latency_ms)))::int AS avg_response_start_latency_ms,
               COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
               COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
        FROM inference_logs
        GROUP BY {column}
        ORDER BY request_count DESC
        """
    )
    return {"items": _json_ready(rows)}


def _metric_filters(
    from_ts: datetime | None,
    to_ts: datetime | None,
    application: str | None,
    provider: str | None,
    model: str | None,
) -> tuple[str, list[Any]]:
    clauses = []
    params: list[Any] = []
    if from_ts:
        clauses.append("COALESCE(completed_at, created_at) >= %s")
        params.append(from_ts)
    if to_ts:
        clauses.append("COALESCE(completed_at, created_at) <= %s")
        params.append(to_ts)
    if application:
        clauses.append("application_name = %s")
        params.append(application)
    if provider:
        clauses.append("provider = %s")
        params.append(provider)
    if model:
        clauses.append("model = %s")
        params.append(model)
    return ("WHERE " + " AND ".join(clauses), params) if clauses else ("", params)


def _ensure_schema() -> None:
    db.execute("ALTER TABLE inference_logs ADD COLUMN IF NOT EXISTS redaction_policy TEXT")
    db.execute("ALTER TABLE inference_logs ADD COLUMN IF NOT EXISTS redaction_types JSONB NOT NULL DEFAULT '[]'::jsonb")
    db.execute("ALTER TABLE inference_logs ADD COLUMN IF NOT EXISTS redaction_metadata JSONB NOT NULL DEFAULT '{}'::jsonb")


def _json_ready(value: Any) -> Any:
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_ready(item) for key, item in value.items()}
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value
