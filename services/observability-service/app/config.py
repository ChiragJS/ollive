import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("OBSERVABILITY_DATABASE_URL", "postgresql://ollive:ollive@localhost:5432/observability_db")
    nats_url: str = os.getenv("NATS_URL", "nats://localhost:4222")
    stream_name: str = os.getenv("INFERENCE_EVENTS_STREAM", "INFERENCE_EVENTS")
    subject: str = os.getenv("INFERENCE_EVENTS_SUBJECT", "inference.events")
    service_name: str = os.getenv("OBSERVABILITY_SERVICE_NAME", "observability-service")
    environment: str = os.getenv("ENVIRONMENT", "local")


settings = Settings()
