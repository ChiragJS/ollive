from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from inference_sdk import InferenceClient, InferenceContext

from .config import settings
from .db import Database

app = FastAPI(
    title="Ollive Demo Chat Service",
    version="0.1.0",
    description="Stateful chat application API. Owns conversations and chat messages.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = Database(settings.database_url)
inference_client = InferenceClient()


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=120)


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    provider: str | None = None
    model: str | None = None
    temperature: float | None = Field(default=0.2, ge=0, le=2)
    max_tokens: int | None = Field(default=512, ge=1, le=8192)


class AutoTitleRequest(BaseModel):
    provider: str | None = None
    model: str | None = None


DEFAULT_TITLE = "New conversation"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.service_name}


@app.post("/v1/conversations", status_code=201)
def create_conversation(payload: ConversationCreate) -> dict[str, Any]:
    row = db.fetch_one(
        """
        INSERT INTO conversations (title)
        VALUES (%s)
        RETURNING id, title, status, created_at, updated_at, cancelled_at
        """,
        (payload.title or DEFAULT_TITLE,),
    )
    return _json_ready(row)


@app.get("/v1/conversations")
def list_conversations(limit: int = Query(default=50, ge=1, le=100)) -> dict[str, Any]:
    rows = db.fetch_all(
        """
        SELECT
          c.id,
          c.title,
          c.status,
          c.created_at,
          c.updated_at,
          c.cancelled_at,
          COUNT(m.id)::int AS message_count,
          COALESCE((
            SELECT left(cm.content, 180)
            FROM chat_messages cm
            WHERE cm.conversation_id = c.id
            ORDER BY cm.created_at DESC
            LIMIT 1
          ), '') AS last_message_preview
        FROM conversations c
        LEFT JOIN chat_messages m ON m.conversation_id = c.id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    return {"items": _json_ready(rows)}


@app.get("/v1/conversations/{conversation_id}")
def get_conversation(conversation_id: uuid.UUID) -> dict[str, Any]:
    conversation = _conversation_or_404(conversation_id)
    messages = db.fetch_all(
        """
        SELECT id, conversation_id, role, content, status, provider, model, metadata, created_at, updated_at
        FROM chat_messages
        WHERE conversation_id = %s
        ORDER BY created_at ASC
        """,
        (conversation_id,),
    )
    return {"conversation": _json_ready(conversation), "messages": _json_ready(messages)}


@app.post("/v1/conversations/{conversation_id}/auto-title")
async def auto_title(
    conversation_id: uuid.UUID,
    payload: AutoTitleRequest | None = None,
) -> dict[str, Any]:
    """
    Generate a short title for a conversation from its first user/assistant
    pair. Idempotent: if the title is already non-default, returns it as-is.
    Uses the LLM for real providers (and emits a telemetry event); falls back
    to a heuristic for the mock provider or if the LLM call fails.
    """
    conv = _conversation_or_404(conversation_id)
    if conv["title"] and conv["title"] != DEFAULT_TITLE:
        return {"conversation": _json_ready(conv)}

    msgs = db.fetch_all(
        """
        SELECT role, content, status
        FROM chat_messages
        WHERE conversation_id = %s
        ORDER BY created_at ASC
        """,
        (conversation_id,),
    )
    first_user = next((m for m in msgs if m["role"] == "user" and m["content"]), None)
    if not first_user:
        return {"conversation": _json_ready(conv)}

    payload = payload or AutoTitleRequest()
    provider = payload.provider or settings.default_provider
    completed_assistant = next(
        (m for m in msgs if m["role"] == "assistant" and m["status"] == "completed" and m["content"]),
        None,
    )

    title: str | None = None
    if provider != "mock" and completed_assistant:
        try:
            title = await _llm_title(
                provider=provider,
                model=payload.model,
                user_text=first_user["content"],
                assistant_text=completed_assistant["content"],
                conversation_id=conversation_id,
            )
        except Exception:
            title = None
    if not title:
        title = _heuristic_title(first_user["content"])

    row = db.fetch_one(
        """
        UPDATE conversations
        SET title = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, title, status, created_at, updated_at, cancelled_at
        """,
        (title, conversation_id),
    )
    return {"conversation": _json_ready(row)}


async def _llm_title(
    *,
    provider: str,
    model: str | None,
    user_text: str,
    assistant_text: str,
    conversation_id: uuid.UUID,
) -> str:
    prompt_messages = [
        {
            "role": "system",
            "content": (
                "You generate concise titles for chat conversations. "
                "Reply with only the title text — 3 to 6 words, sentence case, "
                "no quotation marks, no trailing punctuation, no markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                "Write a short title for the conversation below.\n\n"
                f"USER: {user_text[:1200]}\n\n"
                f"ASSISTANT: {assistant_text[:800]}\n\n"
                "Title:"
            ),
        },
    ]
    response = await inference_client.complete(
        prompt_messages,
        provider=provider,
        model=model,
        temperature=0.3,
        max_tokens=32,
        context=InferenceContext(
            session_id=str(conversation_id),
            external_conversation_id=str(conversation_id),
            external_message_id=f"title-{conversation_id}",
            application_name=settings.application_name,
            service_name=settings.service_name,
            environment=settings.environment,
        ),
    )
    return _clean_title(response.content)


def _heuristic_title(text: str) -> str:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return "Untitled chat"
    for delim in (". ", "? ", "! ", "\n"):
        i = cleaned.find(delim)
        if 8 <= i <= 60:
            cleaned = cleaned[:i]
            break
    if len(cleaned) > 50:
        cleaned = cleaned[:48].rstrip() + "…"
    return cleaned[:1].upper() + cleaned[1:]


def _clean_title(text: str) -> str:
    t = (text or "").strip().strip('"').strip("'").strip()
    for marker in ("**", "*", "`", "#"):
        t = t.replace(marker, "")
    t = t.split("\n")[0].strip()
    while t and t[-1] in ".,;:":
        t = t[:-1].rstrip()
    if len(t) > 64:
        t = t[:62].rstrip() + "…"
    return t or "Untitled chat"


@app.post("/v1/conversations/{conversation_id}/cancel")
def cancel_conversation(conversation_id: uuid.UUID) -> dict[str, Any]:
    conversation = _conversation_or_404(conversation_id)
    if conversation["status"] == "cancelled":
        return {"conversation": _json_ready(conversation)}
    row = db.fetch_one(
        """
        UPDATE conversations
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE id = %s
        RETURNING id, title, status, created_at, updated_at, cancelled_at
        """,
        (conversation_id,),
    )
    db.execute(
        """
        UPDATE chat_messages
        SET status = 'cancelled', updated_at = now()
        WHERE conversation_id = %s AND status = 'pending'
        """,
        (conversation_id,),
    )
    return {"conversation": _json_ready(row)}


@app.post("/v1/conversations/{conversation_id}/messages/{message_id}/cancel")
def cancel_message(conversation_id: uuid.UUID, message_id: uuid.UUID) -> dict[str, Any]:
    _conversation_or_404(conversation_id)
    row = db.fetch_one(
        """
        UPDATE chat_messages
        SET status = 'cancelled', updated_at = now()
        WHERE id = %s
          AND conversation_id = %s
          AND role = 'assistant'
          AND status = 'pending'
        RETURNING id, conversation_id, role, content, status, provider, model, metadata, created_at, updated_at
        """,
        (message_id, conversation_id),
    )
    if row is None:
        row = db.fetch_one(
            """
            SELECT id, conversation_id, role, content, status, provider, model, metadata, created_at, updated_at
            FROM chat_messages
            WHERE id = %s AND conversation_id = %s AND role = 'assistant'
            """,
            (message_id, conversation_id),
        )
    if row is None:
        raise HTTPException(status_code=404, detail="Assistant message not found")
    _touch_conversation(conversation_id)
    return {"message": _json_ready(row)}


@app.post("/v1/conversations/{conversation_id}/messages", status_code=201)
async def create_message(conversation_id: uuid.UUID, payload: MessageCreate) -> dict[str, Any]:
    conversation = _active_conversation_or_409(conversation_id)
    user_message = _insert_message(conversation_id, "user", payload.content, "completed", None, None)
    assistant_message = _insert_message(
        conversation_id,
        "assistant",
        "",
        "pending",
        payload.provider or settings.default_provider,
        payload.model or settings.default_model,
    )
    context_messages = _recent_context(conversation_id)
    provider = payload.provider or settings.default_provider
    model = payload.model or None
    try:
        response = await inference_client.complete(
            context_messages,
            provider=provider,
            model=model,
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
            context=_inference_context(conversation_id, assistant_message["id"]),
        )
        assistant_message = _update_message(
            assistant_message["id"],
            response.content,
            "completed",
            provider,
            response.model,
            {"finish_reason": response.finish_reason, "provider_response_id": response.response_id},
        )
        _touch_conversation(conversation_id)
        return {"conversation": _json_ready(conversation), "user_message": _json_ready(user_message), "assistant_message": _json_ready(assistant_message)}
    except Exception as exc:
        public_message = _public_error_message(exc)
        assistant_message = _update_message(
            assistant_message["id"],
            public_message,
            "failed",
            provider,
            model,
            {"error": exc.__class__.__name__, "message": public_message},
        )
        _touch_conversation(conversation_id)
        raise HTTPException(status_code=502, detail={"message": public_message, "assistant_message": _json_ready(assistant_message)})


@app.post("/v1/conversations/{conversation_id}/messages/stream", status_code=201)
async def stream_message(conversation_id: uuid.UUID, payload: MessageCreate) -> StreamingResponse:
    _active_conversation_or_409(conversation_id)
    user_message = _insert_message(conversation_id, "user", payload.content, "completed", None, None)
    assistant_message = _insert_message(
        conversation_id,
        "assistant",
        "",
        "pending",
        payload.provider or settings.default_provider,
        payload.model or settings.default_model,
    )
    context_messages = _recent_context(conversation_id)
    provider = payload.provider or settings.default_provider
    model = payload.model or None

    async def events():
        output_parts: list[str] = []
        yield _sse("message.created", {"user_message": _json_ready(user_message), "assistant_message": _json_ready(assistant_message)})
        try:
            async for delta in inference_client.stream(
                context_messages,
                provider=provider,
                model=model,
                temperature=payload.temperature,
                max_tokens=payload.max_tokens,
                context=_inference_context(conversation_id, assistant_message["id"]),
                cancel_checker=lambda: _is_generation_cancelled(conversation_id, assistant_message["id"]),
            ):
                output_parts.append(delta)
                yield _sse("message.delta", {"message_id": str(assistant_message["id"]), "delta": delta})
            if _is_generation_cancelled(conversation_id, assistant_message["id"]):
                final_message = _update_message(assistant_message["id"], "".join(output_parts), "cancelled", provider, model, {})
                _touch_conversation(conversation_id)
                yield _sse("message.cancelled", {"assistant_message": _json_ready(final_message)})
                return
            final_message = _update_message(assistant_message["id"], "".join(output_parts), "completed", provider, model, {})
            _touch_conversation(conversation_id)
            yield _sse("message.completed", {"assistant_message": _json_ready(final_message)})
        except asyncio.CancelledError:
            _update_message(assistant_message["id"], "".join(output_parts), "cancelled", provider, model, {"cancel_reason": "client_disconnected"})
            _touch_conversation(conversation_id)
            raise
        except Exception as exc:
            public_message = _public_error_message(exc)
            failed_message = _update_message(
                assistant_message["id"],
                "".join(output_parts) or public_message,
                "failed",
                provider,
                model,
                {"error": exc.__class__.__name__, "message": public_message},
            )
            _touch_conversation(conversation_id)
            yield _sse("error", {"message": public_message, "assistant_message": _json_ready(failed_message)})

    return StreamingResponse(events(), media_type="text/event-stream")


def _conversation_or_404(conversation_id: uuid.UUID) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT id, title, status, created_at, updated_at, cancelled_at FROM conversations WHERE id = %s",
        (conversation_id,),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return row


def _active_conversation_or_409(conversation_id: uuid.UUID) -> dict[str, Any]:
    row = _conversation_or_404(conversation_id)
    if row["status"] != "active":
        raise HTTPException(status_code=409, detail=f"Conversation is {row['status']}")
    return row


def _insert_message(conversation_id: uuid.UUID, role: str, content: str, status: str, provider: str | None, model: str | None) -> dict[str, Any]:
    row = db.fetch_one(
        """
        INSERT INTO chat_messages (conversation_id, role, content, status, provider, model)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, conversation_id, role, content, status, provider, model, metadata, created_at, updated_at
        """,
        (conversation_id, role, content, status, provider, model),
    )
    _touch_conversation(conversation_id)
    return row


def _update_message(message_id: uuid.UUID, content: str, status: str, provider: str | None, model: str | None, metadata: dict[str, Any]) -> dict[str, Any]:
    return db.fetch_one(
        """
        UPDATE chat_messages
        SET content = %s, status = %s, provider = COALESCE(%s, provider), model = COALESCE(%s, model), metadata = %s::jsonb, updated_at = now()
        WHERE id = %s
        RETURNING id, conversation_id, role, content, status, provider, model, metadata, created_at, updated_at
        """,
        (content, status, provider, model, json.dumps(metadata), message_id),
    )


def _recent_context(conversation_id: uuid.UUID) -> list[dict[str, str]]:
    rows = db.fetch_all(
        """
        SELECT role, content
        FROM chat_messages
        WHERE conversation_id = %s AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (conversation_id, settings.context_message_limit),
    )
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def _touch_conversation(conversation_id: uuid.UUID) -> None:
    db.execute("UPDATE conversations SET updated_at = now() WHERE id = %s", (conversation_id,))


def _is_conversation_cancelled(conversation_id: uuid.UUID) -> bool:
    row = db.fetch_one("SELECT status FROM conversations WHERE id = %s", (conversation_id,))
    return bool(row and row["status"] == "cancelled")


def _is_generation_cancelled(conversation_id: uuid.UUID, message_id: uuid.UUID) -> bool:
    if _is_conversation_cancelled(conversation_id):
        return True
    row = db.fetch_one(
        "SELECT status FROM chat_messages WHERE id = %s AND conversation_id = %s",
        (message_id, conversation_id),
    )
    return bool(row and row["status"] == "cancelled")


def _inference_context(conversation_id: uuid.UUID, assistant_message_id: uuid.UUID) -> InferenceContext:
    return InferenceContext(
        session_id=str(conversation_id),
        external_conversation_id=str(conversation_id),
        external_message_id=str(assistant_message_id),
        application_name=settings.application_name,
        service_name=settings.service_name,
        environment=settings.environment,
    )


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _public_error_message(exc: Exception) -> str:
    error_type = getattr(exc, "error_type", None)
    http_status_code = getattr(exc, "http_status_code", None)
    if error_type == "missing_api_key":
        return "This provider is not configured with an API key."
    if http_status_code in (401, 403):
        return "The provider rejected the API key or permissions."
    if http_status_code == 429:
        return "The provider rate limit or quota was reached. Try another provider or wait before retrying."
    if isinstance(http_status_code, int) and http_status_code >= 500:
        return "The provider is temporarily unavailable. Please try again."

    text = str(exc).strip()
    if not text:
        return "The model request failed. Please try again."
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return _friendly_error_text(text)
    if isinstance(payload, dict):
        error_obj = payload.get("error")
        if isinstance(error_obj, dict) and isinstance(error_obj.get("message"), str):
            return _friendly_error_text(error_obj["message"])
        if isinstance(payload.get("message"), str):
            return _friendly_error_text(payload["message"])
    return _friendly_error_text(text)


def _friendly_error_text(text: str) -> str:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return "The model request failed. Please try again."
    return cleaned[:500]


def _json_ready(value: Any) -> Any:
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_ready(item) for key, item in value.items()}
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value
