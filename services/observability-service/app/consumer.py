from __future__ import annotations

import asyncio
import json

import nats
from nats.errors import TimeoutError as NatsTimeoutError

from .config import Settings
from .db import Database
from .ingestion import ingest_raw_event


async def run_consumer(db: Database, settings: Settings) -> None:
    while True:
        try:
            nc = await nats.connect(settings.nats_url)
            js = nc.jetstream()
            try:
                await js.add_stream(name=settings.stream_name, subjects=[settings.subject], storage="file")
            except Exception:
                pass
            sub = await js.pull_subscribe(settings.subject, durable="observability-ingestor", stream=settings.stream_name)
            while True:
                try:
                    messages = await sub.fetch(10, timeout=1)
                except NatsTimeoutError:
                    await asyncio.sleep(0.1)
                    continue
                for message in messages:
                    try:
                        payload = json.loads(message.data.decode("utf-8"))
                        ingest_raw_event(db, payload)
                        await message.ack()
                    except Exception:
                        await message.nak()
        except Exception:
            await asyncio.sleep(2)
