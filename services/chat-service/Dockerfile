FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY packages/inference_sdk /app/packages/inference_sdk
RUN pip install --no-cache-dir -e /app/packages/inference_sdk

COPY services/chat-service /app/services/chat-service
RUN pip install --no-cache-dir -e /app/services/chat-service

WORKDIR /app/services/chat-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
