FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY services/observability-service /app/services/observability-service
RUN pip install --no-cache-dir -e /app/services/observability-service

WORKDIR /app/services/observability-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
