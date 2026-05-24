from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from pydantic import ValidationError

from .contracts import InferenceEvent
from .db import Database


def ingest_raw_event(db: Database, raw_payload: dict[str, Any]) -> dict[str, Any]:
    try:
        event = InferenceEvent.model_validate(raw_payload)
    except ValidationError as exc:
        row = db.fetch_one(
            """
            INSERT INTO ingestion_events (raw_payload, status, validation_error)
            VALUES (%s::jsonb, 'invalid', %s)
            RETURNING id, status, validation_error
            """,
            (json.dumps(raw_payload), exc.json()),
        )
        return {"accepted": False, "ingestion_event": row}

    existing = db.fetch_one("SELECT id, status FROM ingestion_events WHERE event_id = %s", (event.event_id,))
    if existing:
        return {"accepted": True, "duplicate": True, "ingestion_event": existing}

    ingestion_event = db.fetch_one(
        """
        INSERT INTO ingestion_events (
          event_id, event_type, schema_version, source_application, source_service, environment, raw_payload, status
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, 'pending')
        RETURNING id, status
        """,
        (
            str(event.event_id),
            event.event_type,
            event.schema_version,
            event.source.application,
            event.source.service,
            event.source.environment,
            event.model_dump_json(),
        ),
    )

    try:
        _upsert_application(db, event.source.application)
        _insert_inference_log(db, ingestion_event["id"], event)
        db.execute(
            "UPDATE ingestion_events SET status = 'processed', processed_at = now() WHERE id = %s",
            (ingestion_event["id"],),
        )
        return {"accepted": True, "duplicate": False, "ingestion_event": {"id": ingestion_event["id"], "status": "processed"}}
    except Exception as exc:
        db.execute(
            "UPDATE ingestion_events SET status = 'failed', processing_error = %s WHERE id = %s",
            (str(exc)[:1000], ingestion_event["id"]),
        )
        raise


def _upsert_application(db: Database, name: str) -> None:
    db.execute("INSERT INTO applications (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", (name,))


def _insert_inference_log(db: Database, ingestion_event_id: str, event: InferenceEvent) -> None:
    db.execute(
        """
        INSERT INTO inference_logs (
          ingestion_event_id, request_id, trace_id, session_id, external_conversation_id, external_message_id,
          application_name, service_name, environment, provider, model, model_alias, streaming,
          status, http_status_code, error_type, error_message_preview, finish_reason,
          latency_ms, time_to_first_token_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
          temperature, max_tokens, input_preview, output_preview, input_hash, output_hash,
          redaction_applied, redaction_count, redaction_policy, redaction_types, redaction_metadata,
          request_params, provider_metadata, started_at, completed_at
        )
        VALUES (
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s::jsonb, %s::jsonb,
          %s::jsonb, %s::jsonb, %s, %s
        )
        """,
        (
            ingestion_event_id,
            event.context.request_id,
            event.context.trace_id,
            event.context.session_id,
            event.context.external_conversation_id,
            event.context.external_message_id,
            event.source.application,
            event.source.service,
            event.source.environment,
            event.llm.provider,
            event.llm.model,
            event.llm.model_alias,
            event.llm.streaming,
            event.response.status,
            event.response.http_status_code,
            event.error.type,
            event.error.message_preview,
            event.response.finish_reason,
            event.timings.latency_ms,
            event.timings.time_to_first_token_ms,
            event.usage.prompt_tokens,
            event.usage.completion_tokens,
            event.usage.total_tokens,
            _estimate_cost_usd(event.llm.provider, event.llm.model, event.usage.prompt_tokens, event.usage.completion_tokens),
            event.request.temperature,
            event.request.max_tokens,
            event.previews.input_preview,
            event.previews.output_preview,
            event.previews.input_hash,
            event.previews.output_hash,
            event.previews.redaction_applied,
            event.previews.redaction_count,
            event.previews.redaction_policy,
            json.dumps(event.previews.redaction_types),
            json.dumps(event.previews.redaction_metadata),
            event.request.model_dump_json(),
            json.dumps(event.provider_metadata),
            event.timings.started_at,
            event.timings.completed_at,
        ),
    )


def _estimate_cost_usd(provider: str, model: str, prompt_tokens: int | None, completion_tokens: int | None) -> Decimal | None:
    if prompt_tokens is None and completion_tokens is None:
        return None
    input_tokens = prompt_tokens or 0
    output_tokens = completion_tokens or 0
    key = (provider.lower(), model.lower())
    # Conservative sample prices, intentionally isolated so real pricing can be updated without schema changes.
    prices_per_million = {
        ("openai", "gpt-4.1-mini"): (Decimal("0.40"), Decimal("1.60")),
        ("deepseek", "deepseek-chat"): (Decimal("0.27"), Decimal("1.10")),
        ("groq", "llama-3.1-8b-instant"): (Decimal("0.05"), Decimal("0.08")),
        ("mock", "mock-chat"): (Decimal("0"), Decimal("0")),
    }
    input_price, output_price = prices_per_million.get(key, (Decimal("0"), Decimal("0")))
    return (Decimal(input_tokens) / Decimal(1_000_000) * input_price) + (Decimal(output_tokens) / Decimal(1_000_000) * output_price)
