from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx


@dataclass
class LLMResponse:
    content: str
    provider: str
    model: str
    response_id: str | None = None
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    http_status_code: int | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class StreamChunk:
    content: str = ""
    response_id: str | None = None
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    is_final: bool = False


@dataclass
class ProviderConfig:
    name: str
    base_url: str | None
    api_key: str | None
    default_model: str
    extra_headers: dict[str, str] = field(default_factory=dict)


class ProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        http_status_code: int | None = None,
        error_type: str = "provider_error",
        raw_body: str | None = None,
    ):
        super().__init__(message)
        self.http_status_code = http_status_code
        self.error_type = error_type
        self.raw_body = raw_body


class OpenAICompatibleProvider:
    def __init__(self, config: ProviderConfig, timeout_seconds: float = 60.0):
        self.config = config
        self.timeout_seconds = timeout_seconds

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        if self.config.name == "mock":
            await asyncio.sleep(0.25)
            text = self._mock_response(messages)
            prompt_tokens = self._estimate_tokens(" ".join(m.get("content", "") for m in messages))
            completion_tokens = self._estimate_tokens(text)
            return LLMResponse(
                content=text,
                provider="mock",
                model=model or self.config.default_model,
                response_id="mock-response",
                finish_reason="stop",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
                http_status_code=200,
                provider_metadata={"mock": True},
            )

        if not self.config.api_key:
            raise ProviderError(f"Missing API key for provider '{self.config.name}'", error_type="missing_api_key")
        if not self.config.base_url:
            raise ProviderError(f"Missing base URL for provider '{self.config.name}'", error_type="missing_base_url")

        payload: dict[str, Any] = {
            "model": model or self.config.default_model,
            "messages": messages,
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = self._headers()
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(f"{self.config.base_url.rstrip('/')}/chat/completions", headers=headers, json=payload)

        if response.status_code >= 400:
            raise _provider_error_from_response(response)

        data = response.json()
        choice = data.get("choices", [{}])[0]
        message = choice.get("message") or {}
        usage = data.get("usage") or {}
        return LLMResponse(
            content=message.get("content") or "",
            provider=self.config.name,
            model=data.get("model") or model or self.config.default_model,
            response_id=data.get("id"),
            finish_reason=choice.get("finish_reason"),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            http_status_code=response.status_code,
            provider_metadata={"raw_response_id": data.get("id"), "object": data.get("object")},
        )

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[StreamChunk]:
        if self.config.name == "mock":
            text = self._mock_response(messages)
            parts = self._split_mock_stream(text)
            prompt_tokens = self._estimate_tokens(" ".join(m.get("content", "") for m in messages))
            completion_tokens = self._estimate_tokens(text)
            for part in parts:
                await asyncio.sleep(0.08)
                yield StreamChunk(content=part)
            yield StreamChunk(
                is_final=True,
                response_id="mock-response",
                finish_reason="stop",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
                provider_metadata={"mock": True},
            )
            return

        if not self.config.api_key:
            raise ProviderError(f"Missing API key for provider '{self.config.name}'", error_type="missing_api_key")
        if not self.config.base_url:
            raise ProviderError(f"Missing base URL for provider '{self.config.name}'", error_type="missing_base_url")

        payload: dict[str, Any] = {
            "model": model or self.config.default_model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = self._headers()
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{self.config.base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    raise _provider_error_from_response(response, body.decode("utf-8", errors="ignore"))

                response_id = None
                response_model = model or self.config.default_model
                finish_reason = None
                usage: dict[str, Any] = {}
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    raw = line.removeprefix("data: ").strip()
                    if raw == "[DONE]":
                        break
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    response_id = data.get("id") or response_id
                    response_model = data.get("model") or response_model
                    if data.get("usage"):
                        usage = data["usage"]
                    choice = (data.get("choices") or [{}])[0]
                    finish_reason = choice.get("finish_reason") or finish_reason
                    delta = choice.get("delta") or {}
                    content = delta.get("content") or ""
                    if content:
                        yield StreamChunk(content=content, response_id=response_id)

                yield StreamChunk(
                    is_final=True,
                    response_id=response_id,
                    finish_reason=finish_reason,
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                    total_tokens=usage.get("total_tokens"),
                    provider_metadata={"raw_response_id": response_id, "response_model": response_model},
                )

    @staticmethod
    def _mock_response(messages: list[dict[str, str]]) -> str:
        last_user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
        return (
            "Mock assistant response: I received your message"
            f" '{last_user[:120]}'. Configure OPENAI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY,"
            " or OPENROUTER_API_KEY to call a real model."
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            **self.config.extra_headers,
        }

    @staticmethod
    def _split_mock_stream(text: str) -> list[str]:
        words = text.split(" ")
        chunks: list[str] = []
        for index, word in enumerate(words):
            suffix = " " if index < len(words) - 1 else ""
            chunks.append(word + suffix)
        return chunks

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, len(text.split()))


def provider_configs_from_env() -> dict[str, ProviderConfig]:
    return {
        "mock": ProviderConfig("mock", None, None, os.getenv("DEFAULT_MODEL", "mock-chat")),
        "openai": ProviderConfig(
            "openai",
            os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            os.getenv("OPENAI_API_KEY"),
            os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        ),
        "deepseek": ProviderConfig(
            "deepseek",
            os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            os.getenv("DEEPSEEK_API_KEY"),
            os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        ),
        "groq": ProviderConfig(
            "groq",
            os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
            os.getenv("GROQ_API_KEY"),
            os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
        ),
        "openrouter": ProviderConfig(
            "openrouter",
            os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            os.getenv("OPENROUTER_API_KEY"),
            os.getenv("OPENROUTER_MODEL", "openai/gpt-oss-120b:free"),
            {
                "HTTP-Referer": os.getenv("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
                "X-Title": os.getenv("OPENROUTER_APP_TITLE", "Ollive Assignment"),
            },
        ),
    }


def _provider_error_from_response(response: httpx.Response, body: str | None = None) -> ProviderError:
    raw_body = (body if body is not None else response.text)[:4000]
    message = raw_body[:500] or f"Provider returned HTTP {response.status_code}"
    error_type = f"http_{response.status_code}"

    try:
        data = json.loads(raw_body)
    except json.JSONDecodeError:
        data = None

    if isinstance(data, dict):
        error_obj = data.get("error")
        if isinstance(error_obj, dict):
            if isinstance(error_obj.get("message"), str) and error_obj["message"].strip():
                message = error_obj["message"].strip()
            code = error_obj.get("code") or error_obj.get("type")
            if isinstance(code, str) and code.strip():
                error_type = code.strip()
        elif isinstance(data.get("message"), str) and data["message"].strip():
            message = data["message"].strip()

    return ProviderError(
        message[:500],
        http_status_code=response.status_code,
        error_type=error_type,
        raw_body=raw_body,
    )
