# API Contracts

This document is intended to let a separate frontend implementation build against stable backend contracts.

## Base URLs

- Chat service: `http://localhost:8000`
- Observability service: `http://localhost:8001`

Both services also expose OpenAPI specs:

- `http://localhost:8000/docs`
- `http://localhost:8001/docs`

## Chat Service

### Create Conversation

`POST /v1/conversations`

Request:

```json
{
  "title": "Support chat"
}
```

Response `201`:

```json
{
  "id": "uuid",
  "title": "Support chat",
  "status": "active",
  "created_at": "2026-05-24T10:00:00Z",
  "updated_at": "2026-05-24T10:00:00Z",
  "cancelled_at": null
}
```

### List Conversations

`GET /v1/conversations?limit=50`

Response `200`:

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Support chat",
      "status": "active",
      "created_at": "2026-05-24T10:00:00Z",
      "updated_at": "2026-05-24T10:01:00Z",
      "cancelled_at": null,
      "message_count": 2,
      "last_message_preview": "Hello"
    }
  ]
}
```

### Get Conversation With Messages

`GET /v1/conversations/{conversation_id}`

Response `200`:

```json
{
  "conversation": {
    "id": "uuid",
    "title": "Support chat",
    "status": "active",
    "created_at": "2026-05-24T10:00:00Z",
    "updated_at": "2026-05-24T10:01:00Z",
    "cancelled_at": null
  },
  "messages": [
    {
      "id": "uuid",
      "conversation_id": "uuid",
      "role": "user",
      "content": "Hello",
      "status": "completed",
      "provider": null,
      "model": null,
      "metadata": {},
      "created_at": "2026-05-24T10:00:00Z",
      "updated_at": "2026-05-24T10:00:00Z"
    }
  ]
}
```

### Send Message, Non-Streaming

`POST /v1/conversations/{conversation_id}/messages`

Request:

```json
{
  "content": "Explain inference logging in one paragraph",
  "provider": "mock",
  "model": "mock-chat",
  "temperature": 0.2,
  "max_tokens": 512
}
```

Response `201`:

```json
{
  "conversation": {},
  "user_message": {},
  "assistant_message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "role": "assistant",
    "content": "...",
    "status": "completed",
    "provider": "mock",
    "model": "mock-chat",
    "metadata": {
      "finish_reason": "stop",
      "provider_response_id": "mock-response"
    },
    "created_at": "2026-05-24T10:00:00Z",
    "updated_at": "2026-05-24T10:00:01Z"
  }
}
```

### Send Message, Streaming

`POST /v1/conversations/{conversation_id}/messages/stream`

Request body is the same as non-streaming.

Response content type: `text/event-stream`

SSE events:

```txt
event: message.created
data: {"user_message": {...}, "assistant_message": {...}}

event: message.delta
data: {"message_id": "uuid", "delta": "partial text"}

event: message.completed
data: {"assistant_message": {...}}
```

Cancellation event:

```txt
event: message.cancelled
data: {"assistant_message": {...}}
```

The stream can be stopped without closing the conversation by calling `POST /v1/conversations/{conversation_id}/messages/{message_id}/cancel` for the live assistant message returned by `message.created`.

Error event:

```txt
event: error
data: {"message": "LLM stream failed", "detail": "...", "assistant_message": {...}}
```

### Auto-title Conversation

`POST /v1/conversations/{conversation_id}/auto-title`

Generates a short title (3–6 words) from the first user/assistant pair. Idempotent: if the conversation already has a non-default title it is returned unchanged. For real providers the title is produced by the configured LLM (and emits a telemetry event with `external_message_id = "title-<conversation_id>"` so it can be distinguished in the dashboard); for the `mock` provider — or if the LLM call fails — a deterministic heuristic over the first user message is used.

Request (all fields optional):

```json
{
  "provider": "openai",
  "model": "gpt-4.1-mini"
}
```

Response `200`:

```json
{
  "conversation": {
    "id": "uuid",
    "title": "NATS.io overview and use cases",
    "status": "active",
    "created_at": "2026-05-24T10:00:00Z",
    "updated_at": "2026-05-24T10:00:20Z",
    "cancelled_at": null
  }
}
```

### Cancel Conversation

`POST /v1/conversations/{conversation_id}/cancel`

Response `200`:

```json
{
  "conversation": {
    "id": "uuid",
    "title": "Support chat",
    "status": "cancelled",
    "created_at": "2026-05-24T10:00:00Z",
    "updated_at": "2026-05-24T10:01:00Z",
    "cancelled_at": "2026-05-24T10:01:00Z"
  }
}
```

### Stop In-Flight Assistant Message

`POST /v1/conversations/{conversation_id}/messages/{message_id}/cancel`

This cancels only a pending assistant generation. The conversation remains `active`, so the user can continue the thread.

Response `200`:

```json
{
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "role": "assistant",
    "content": "partial response text",
    "status": "cancelled",
    "provider": "groq",
    "model": "llama-3.1-8b-instant",
    "metadata": {},
    "created_at": "2026-05-24T10:00:00Z",
    "updated_at": "2026-05-24T10:00:02Z"
  }
}
```

## Observability Service

### Ingest Event Over HTTP

`POST /v1/ingest/events`

The preferred runtime path is NATS JetStream, but this endpoint accepts the same event contract.

Request:

```json
{
  "event_id": "2e6c6e42-f35a-4d7f-a3c0-78ae5b4e9b5f",
  "event_type": "inference.completed",
  "schema_version": "1.0",
  "emitted_at": "2026-05-24T10:00:01Z",
  "source": {
    "application": "ollive-demo-chat",
    "service": "chat-service",
    "environment": "local",
    "sdk_version": "0.1.0"
  },
  "context": {
    "request_id": "req-123",
    "trace_id": "trace-123",
    "session_id": "conversation-id",
    "external_conversation_id": "conversation-id",
    "external_message_id": "assistant-message-id"
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "model_alias": "default-chat",
    "streaming": true,
    "operation": "chat"
  },
  "request": {
    "temperature": 0.2,
    "max_tokens": 512
  },
  "response": {
    "status": "success",
    "http_status_code": 200,
    "finish_reason": "stop",
    "provider_response_id": "chatcmpl-123"
  },
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  },
  "timings": {
    "started_at": "2026-05-24T10:00:00Z",
    "completed_at": "2026-05-24T10:00:01Z",
    "latency_ms": 1000,
    "time_to_first_token_ms": 350
  },
  "previews": {
    "input_preview": "user: email [REDACTED_EMAIL]",
    "output_preview": "assistant response",
    "input_hash": "sha256",
    "output_hash": "sha256",
    "redaction_applied": true,
    "redaction_count": 1,
    "redaction_policy": "pii-redaction-v2",
    "redaction_types": ["email"],
    "redaction_metadata": {
      "preview_max_chars": 500,
      "input": {
        "policy": "pii-redaction-v2",
        "mode": "standard",
        "truncated": false,
        "redaction_types": ["email"],
        "counts_by_type": {"email": 1}
      },
      "output": {
        "policy": "pii-redaction-v2",
        "mode": "standard",
        "truncated": false,
        "redaction_types": [],
        "counts_by_type": {}
      }
    }
  },
  "error": {
    "type": null,
    "message_preview": null
  },
  "provider_metadata": {}
}
```

Response `202`:

```json
{
  "accepted": true,
  "duplicate": false,
  "ingestion_event": {
    "id": "uuid",
    "status": "processed"
  }
}
```

### List Inference Logs

`GET /v1/inference-logs?limit=50&status=success&provider=openai&model=gpt-4.1-mini&conversation_id=uuid&from=2026-05-24T00:00:00Z&to=2026-05-25T00:00:00Z`

Response `200`:

```json
{
  "items": [
    {
      "id": "uuid",
      "request_id": "uuid",
      "trace_id": "uuid",
      "external_conversation_id": "uuid",
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "streaming": true,
      "status": "success",
      "latency_ms": 1000,
      "time_to_first_token_ms": 350,
      "total_tokens": 150,
      "estimated_cost_usd": "0.00012000",
      "input_preview": "...",
      "output_preview": "...",
      "redaction_applied": true,
      "redaction_count": 1,
      "redaction_policy": "pii-redaction-v2",
      "redaction_types": ["email"],
      "completed_at": "2026-05-24T10:00:01Z"
    }
  ]
}
```

### Get Inference Log

`GET /v1/inference-logs/{log_id}`

Response `200`:

```json
{
  "item": {
    "id": "uuid",
    "provider_metadata": {},
    "request_params": {}
  }
}
```

### Dashboard Summary

`GET /v1/metrics/summary?from=2026-05-24T00:00:00Z&to=2026-05-25T00:00:00Z&application=ollive-demo-chat&provider=openai&model=gpt-4.1-mini`

Response `200`:

```json
{
  "request_count": 100,
  "success_count": 95,
  "error_count": 4,
  "cancelled_count": 1,
  "avg_latency_ms": 1100,
  "p50_latency_ms": 900,
  "p95_latency_ms": 2300,
  "avg_response_start_latency_ms": 320,
  "p50_response_start_latency_ms": 280,
  "p95_response_start_latency_ms": 650,
  "total_tokens": 120000,
  "estimated_cost_usd": "0.42000000",
  "error_rate": 0.04
}
```

### Dashboard Timeseries

`GET /v1/metrics/timeseries?bucket_minutes=5`

Response `200`:

```json
{
  "items": [
    {
      "bucket": "2026-05-24T10:00:00Z",
      "request_count": 10,
      "error_count": 1,
      "cancelled_count": 0,
      "avg_latency_ms": 1000,
      "avg_response_start_latency_ms": 300,
      "total_tokens": 5000
    }
  ]
}
```

### Dashboard Breakdown

`GET /v1/metrics/breakdown?group_by=model`

Allowed `group_by`: `provider`, `model`, `status`, `application`.

Response `200`:

```json
{
  "items": [
    {
      "key": "gpt-4.1-mini",
      "request_count": 100,
      "error_count": 4,
      "avg_latency_ms": 1100,
      "avg_response_start_latency_ms": 320,
      "total_tokens": 120000,
      "estimated_cost_usd": "0.42000000"
    }
  ]
}
```
