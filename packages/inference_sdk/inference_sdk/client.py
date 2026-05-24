from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Awaitable, Callable

from .providers import LLMResponse, OpenAICompatibleProvider, ProviderError, provider_configs_from_env
from .redaction import redact_text, sha256_text
from .transport import TelemetryTransport, transport_from_env


CancelChecker = Callable[[], bool | Awaitable[bool]]


class InferenceCancelled(Exception):
    pass


@dataclass
class InferenceContext:
    session_id: str | None = None
    external_conversation_id: str | None = None
    external_message_id: str | None = None
    trace_id: str | None = None
    application_name: str | None = None
    service_name: str | None = None
    environment: str | None = None


class InferenceClient:
    def __init__(self, transport: TelemetryTransport | None = None):
        self.transport = transport or transport_from_env()
        self.providers = {
            name: OpenAICompatibleProvider(config)
            for name, config in provider_configs_from_env().items()
        }
        self.sdk_version = "0.1.0"

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        context: InferenceContext | None = None,
    ) -> LLMResponse:
        provider_name = provider or os.getenv("DEFAULT_PROVIDER", "mock")
        provider_client = self._provider(provider_name)
        request_id = str(uuid.uuid4())
        trace_id = context.trace_id if context and context.trace_id else str(uuid.uuid4())
        started_at = _now()
        started_monotonic = time.perf_counter()
        status = "success"
        error_type = None
        error_message = None
        error_http_status_code = None
        error_provider_metadata: dict[str, Any] = {}
        response: LLMResponse | None = None
        try:
            response = await provider_client.complete(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return response
        except ProviderError as exc:
            status = "error"
            error_type = exc.error_type
            error_message = str(exc)
            error_http_status_code = exc.http_status_code
            error_provider_metadata = {"raw_error_body": exc.raw_body} if exc.raw_body else {}
            raise
        except Exception as exc:
            status = "error"
            error_type = exc.__class__.__name__
            error_message = str(exc)
            raise
        finally:
            completed_at = _now()
            latency_ms = int((time.perf_counter() - started_monotonic) * 1000)
            await self._publish_fail_open(
                self._event(
                    event_type="inference.completed" if status == "success" else "inference.failed",
                    request_id=request_id,
                    trace_id=trace_id,
                    messages=messages,
                    output=response.content if response else "",
                    provider=provider_name,
                    model=(response.model if response else model) or provider_client.config.default_model,
                    model_alias=model,
                    streaming=False,
                    status=status,
                    error_type=error_type,
                    error_message=error_message,
                    error_http_status_code=error_http_status_code,
                    error_provider_metadata=error_provider_metadata,
                    response=response,
                    started_at=started_at,
                    completed_at=completed_at,
                    latency_ms=latency_ms,
                    time_to_first_token_ms=None,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    context=context,
                )
            )

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        context: InferenceContext | None = None,
        cancel_checker: CancelChecker | None = None,
    ) -> AsyncIterator[str]:
        provider_name = provider or os.getenv("DEFAULT_PROVIDER", "mock")
        provider_client = self._provider(provider_name)
        request_id = str(uuid.uuid4())
        trace_id = context.trace_id if context and context.trace_id else str(uuid.uuid4())
        started_at = _now()
        started_monotonic = time.perf_counter()
        first_token_ms: int | None = None
        status = "success"
        error_type = None
        error_message = None
        error_http_status_code = None
        error_provider_metadata: dict[str, Any] = {}
        output_parts: list[str] = []
        final = None

        try:
            async for chunk in provider_client.stream(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            ):
                if await self._is_cancelled(cancel_checker):
                    raise InferenceCancelled("conversation was cancelled")
                if chunk.is_final:
                    final = chunk
                    continue
                if chunk.content:
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started_monotonic) * 1000)
                    output_parts.append(chunk.content)
                    yield chunk.content
        except InferenceCancelled as exc:
            status = "cancelled"
            error_type = "cancelled"
            error_message = str(exc)
        except asyncio.CancelledError as exc:
            status = "cancelled"
            error_type = "client_disconnected"
            error_message = str(exc) or "stream was cancelled"
            raise
        except GeneratorExit:
            status = "cancelled"
            error_type = "client_disconnected"
            error_message = "stream was closed"
            raise
        except ProviderError as exc:
            status = "error"
            error_type = exc.error_type
            error_message = str(exc)
            error_http_status_code = exc.http_status_code
            error_provider_metadata = {"raw_error_body": exc.raw_body} if exc.raw_body else {}
            raise
        except Exception as exc:
            status = "error"
            error_type = exc.__class__.__name__
            error_message = str(exc)
            raise
        finally:
            completed_at = _now()
            latency_ms = int((time.perf_counter() - started_monotonic) * 1000)
            content = "".join(output_parts)
            response = LLMResponse(
                content=content,
                provider=provider_name,
                model=model or provider_client.config.default_model,
                response_id=getattr(final, "response_id", None),
                finish_reason=getattr(final, "finish_reason", None),
                prompt_tokens=getattr(final, "prompt_tokens", None),
                completion_tokens=getattr(final, "completion_tokens", None),
                total_tokens=getattr(final, "total_tokens", None),
                http_status_code=200 if status == "success" else error_http_status_code,
                provider_metadata=(getattr(final, "provider_metadata", {}) or {}) if status == "success" else error_provider_metadata,
            )
            await self._publish_fail_open(
                self._event(
                    event_type={"success": "inference.completed", "cancelled": "inference.cancelled"}.get(status, "inference.failed"),
                    request_id=request_id,
                    trace_id=trace_id,
                    messages=messages,
                    output=content,
                    provider=provider_name,
                    model=response.model,
                    model_alias=model,
                    streaming=True,
                    status=status,
                    error_type=error_type,
                    error_message=error_message,
                    error_http_status_code=error_http_status_code,
                    error_provider_metadata=error_provider_metadata,
                    response=response,
                    started_at=started_at,
                    completed_at=completed_at,
                    latency_ms=latency_ms,
                    time_to_first_token_ms=first_token_ms,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    context=context,
                )
            )

    def _provider(self, provider_name: str) -> OpenAICompatibleProvider:
        if provider_name not in self.providers:
            raise ValueError(f"Unsupported provider '{provider_name}'. Supported providers: {sorted(self.providers)}")
        return self.providers[provider_name]

    async def _publish_fail_open(self, event: dict[str, Any]) -> None:
        try:
            await self.transport.publish(event)
        except Exception:
            # Telemetry must never break the user-facing LLM path.
            return None

    async def _is_cancelled(self, cancel_checker: CancelChecker | None) -> bool:
        if cancel_checker is None:
            return False
        result = cancel_checker()
        if hasattr(result, "__await__"):
            return bool(await result)  # type: ignore[arg-type]
        return bool(result)

    def _event(
        self,
        *,
        event_type: str,
        request_id: str,
        trace_id: str,
        messages: list[dict[str, str]],
        output: str,
        provider: str,
        model: str,
        model_alias: str | None,
        streaming: bool,
        status: str,
        error_type: str | None,
        error_message: str | None,
        error_http_status_code: int | None,
        error_provider_metadata: dict[str, Any] | None,
        response: LLMResponse | None,
        started_at: str,
        completed_at: str,
        latency_ms: int,
        time_to_first_token_ms: int | None,
        temperature: float | None,
        max_tokens: int | None,
        context: InferenceContext | None,
    ) -> dict[str, Any]:
        input_text = "\n".join(f"{m.get('role')}: {m.get('content', '')}" for m in messages)
        redaction_mode = os.getenv("PII_REDACTION_MODE", "standard").lower()
        preview_max_chars = int(os.getenv("PII_PREVIEW_MAX_CHARS", "500"))
        input_redaction = redact_text(input_text, max_chars=preview_max_chars, mode=redaction_mode)
        output_redaction = redact_text(output, max_chars=preview_max_chars, mode=redaction_mode)
        redaction_count = input_redaction.redaction_count + output_redaction.redaction_count
        redaction_types = sorted(set(input_redaction.redaction_types + output_redaction.redaction_types))
        return {
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "schema_version": "1.0",
            "emitted_at": completed_at,
            "source": {
                "application": _context_value(context, "application_name", os.getenv("APPLICATION_NAME", "ollive-demo-chat")),
                "service": _context_value(context, "service_name", os.getenv("CHAT_SERVICE_NAME", "chat-service")),
                "environment": _context_value(context, "environment", os.getenv("ENVIRONMENT", "local")),
                "sdk_version": self.sdk_version,
            },
            "context": {
                "request_id": request_id,
                "trace_id": trace_id,
                "session_id": _context_value(context, "session_id", None),
                "external_conversation_id": _context_value(context, "external_conversation_id", None),
                "external_message_id": _context_value(context, "external_message_id", None),
            },
            "llm": {
                "provider": provider,
                "model": model,
                "model_alias": model_alias,
                "streaming": streaming,
                "operation": "chat",
            },
            "request": {
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            "response": {
                "status": status,
                "http_status_code": response.http_status_code if response else error_http_status_code,
                "finish_reason": response.finish_reason if response else None,
                "provider_response_id": response.response_id if response else None,
            },
            "usage": {
                "prompt_tokens": response.prompt_tokens if response else None,
                "completion_tokens": response.completion_tokens if response else None,
                "total_tokens": response.total_tokens if response else None,
            },
            "timings": {
                "started_at": started_at,
                "completed_at": completed_at,
                "latency_ms": latency_ms,
                "time_to_first_token_ms": time_to_first_token_ms,
            },
            "previews": {
                "input_preview": input_redaction.text,
                "output_preview": output_redaction.text,
                "input_hash": sha256_text(input_text),
                "output_hash": sha256_text(output),
                "redaction_applied": input_redaction.redaction_applied or output_redaction.redaction_applied,
                "redaction_count": redaction_count,
                "redaction_policy": input_redaction.policy,
                "redaction_types": redaction_types,
                "redaction_metadata": {
                    "preview_max_chars": preview_max_chars,
                    "input": input_redaction.metadata(),
                    "output": output_redaction.metadata(),
                },
            },
            "error": {
                "type": error_type,
                "message_preview": (error_message or "")[:500] if error_message else None,
            },
            "provider_metadata": response.provider_metadata if response else (error_provider_metadata or {}),
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _context_value(context: InferenceContext | None, field: str, default: Any) -> Any:
    if context is None:
        return default
    value = getattr(context, field)
    return value if value is not None else default
