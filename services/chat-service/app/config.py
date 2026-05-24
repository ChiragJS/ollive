import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("CHAT_DATABASE_URL", "postgresql://ollive:ollive@localhost:5432/chat_app_db")
    application_name: str = os.getenv("APPLICATION_NAME", "ollive-demo-chat")
    service_name: str = os.getenv("CHAT_SERVICE_NAME", "chat-service")
    environment: str = os.getenv("ENVIRONMENT", "local")
    default_provider: str = os.getenv("DEFAULT_PROVIDER", "mock")
    default_model: str = os.getenv("DEFAULT_MODEL", "mock-chat")
    context_message_limit: int = int(os.getenv("CONTEXT_MESSAGE_LIMIT", "8"))


settings = Settings()
