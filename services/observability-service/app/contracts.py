from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class Source(BaseModel):
    application: str = Field(min_length=1)
    service: str = Field(min_length=1)
    environment: str = Field(min_length=1)
    sdk_version: str | None = None


class EventContext(BaseModel):
    request_id: str = Field(min_length=1)
    trace_id: str = Field(min_length=1)
    session_id: str | None = None
    external_conversation_id: str | None = None
    external_message_id: str | None = None


class LLMInfo(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    model_alias: str | None = None
    streaming: bool = False
    operation: str = "chat"


class RequestInfo(BaseModel):
    temperature: float | None = None
    max_tokens: int | None = None


class ResponseInfo(BaseModel):
    status: Literal["success", "error", "cancelled", "timeout"]
    http_status_code: int | None = None
    finish_reason: str | None = None
    provider_response_id: str | None = None


class UsageInfo(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class TimingInfo(BaseModel):
    started_at: str | None = None
    completed_at: str | None = None
    latency_ms: int | None = Field(default=None, ge=0)
    time_to_first_token_ms: int | None = Field(default=None, ge=0)


class PreviewInfo(BaseModel):
    input_preview: str | None = None
    output_preview: str | None = None
    input_hash: str | None = None
    output_hash: str | None = None
    redaction_applied: bool = False
    redaction_count: int = 0
    redaction_policy: str | None = None
    redaction_types: list[str] = Field(default_factory=list)
    redaction_metadata: dict[str, Any] = Field(default_factory=dict)


class ErrorInfo(BaseModel):
    type: str | None = None
    message_preview: str | None = None


class InferenceEvent(BaseModel):
    event_id: uuid.UUID
    event_type: Literal["inference.completed", "inference.failed", "inference.cancelled"]
    schema_version: str = "1.0"
    emitted_at: str | None = None
    source: Source
    context: EventContext
    llm: LLMInfo
    request: RequestInfo = Field(default_factory=RequestInfo)
    response: ResponseInfo
    usage: UsageInfo = Field(default_factory=UsageInfo)
    timings: TimingInfo = Field(default_factory=TimingInfo)
    previews: PreviewInfo = Field(default_factory=PreviewInfo)
    error: ErrorInfo = Field(default_factory=ErrorInfo)
    provider_metadata: dict[str, Any] = Field(default_factory=dict)
