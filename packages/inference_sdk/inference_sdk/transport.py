from __future__ import annotations

import json
import os
from typing import Any, Protocol

import httpx
import nats


class TelemetryTransport(Protocol):
    async def publish(self, event: dict[str, Any]) -> None:
        ...


class NoopTransport:
    async def publish(self, event: dict[str, Any]) -> None:
        return None


class HttpTelemetryTransport:
    def __init__(self, endpoint: str, timeout_seconds: float = 2.0):
        self.endpoint = endpoint
        self.timeout_seconds = timeout_seconds

    async def publish(self, event: dict[str, Any]) -> None:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(self.endpoint, json=event)
            response.raise_for_status()


class NatsTelemetryTransport:
    def __init__(self, url: str, subject: str, stream: str):
        self.url = url
        self.subject = subject
        self.stream = stream
        self._nc = None
        self._js = None

    async def publish(self, event: dict[str, Any]) -> None:
        if self._js is None:
            self._nc = await nats.connect(self.url, connect_timeout=1)
            self._js = self._nc.jetstream()
            try:
                await self._js.add_stream(name=self.stream, subjects=[self.subject], storage="file")
            except Exception:
                pass
        await self._js.publish(self.subject, json.dumps(event).encode("utf-8"))


def transport_from_env() -> TelemetryTransport:
    transport = os.getenv("TELEMETRY_TRANSPORT", "nats").lower()
    if transport == "http":
        endpoint = os.getenv("OBSERVABILITY_HTTP_URL")
        return HttpTelemetryTransport(endpoint) if endpoint else NoopTransport()
    if transport == "none":
        return NoopTransport()
    nats_url = os.getenv("NATS_URL")
    if nats_url:
        return NatsTelemetryTransport(
            nats_url,
            os.getenv("INFERENCE_EVENTS_SUBJECT", "inference.events"),
            os.getenv("INFERENCE_EVENTS_STREAM", "INFERENCE_EVENTS"),
        )
    endpoint = os.getenv("OBSERVABILITY_HTTP_URL")
    return HttpTelemetryTransport(endpoint) if endpoint else NoopTransport()
