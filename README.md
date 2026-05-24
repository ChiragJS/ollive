# Lightweight LLM Inference Logging

This repository implements a backend-first LLM chatbot and inference observability system.

## What Is Included

- Stateful chat service with multi-turn conversation storage.
- Lightweight Python SDK/wrapper around OpenAI-compatible LLM calls.
- Streaming and non-streaming chat APIs.
- Conversation list, resume, and cancel APIs.
- NATS JetStream event-based telemetry transport.
- Observability ingestion service with validation and normalization.
- Postgres storage for chat messages, raw ingestion events, and processed inference logs.
- Dashboard APIs for latency, throughput, errors, token usage, and model/provider breakdowns.
- PII redaction for input/output previews.
- Two independent React + Vite + TypeScript frontends: `chat-ui` (claude.ai-flavored chat surface) and `dashboard-ui` (SigNoz-flavored observability console), each served by its own nginx and proxying only to its respective backend.
- Docker Compose one-command local setup.
- Kubernetes manifests for self-hosted deployment.

The contract between frontend and backend is documented separately in `docs/API.md` so a different frontend implementation could be dropped in without touching the backend.

## Setup

```bash
cp .env.example .env
docker compose up --build
```

For an interactive one-command local demo, use:

```bash
./scripts/compose-up.sh
```

It lets you choose `mock`, `groq`, `openai`, or `deepseek`, securely prompts for the selected API key if needed, writes `.env`, and starts `docker compose up --build`.

If Node/npm is available, the same launcher is exposed as:

```bash
npm run up
```

The root package also defines a local bin named `ollive-up`, so the same flow can be wired to `npx` if this package is published or installed.

Services:

- **Chat UI** (`chat-ui`): `http://localhost:5173`
- **Observability UI** (`dashboard-ui`): `http://localhost:5174`
- Chat service: `http://localhost:8000` · OpenAPI at `/docs`
- Observability service: `http://localhost:8001` · OpenAPI at `/docs`
- NATS monitoring: `http://localhost:8222`

The two frontends are separate deployable services. Each has its own nginx that proxies `/api/*` to its respective backend — `chat-ui` → `chat-service:8000`, `dashboard-ui` → `observability-service:8001`. This keeps the product boundary clean: nobody hits both backends from one origin, and each UI ships only what it needs.

By default the project uses the `mock` provider so the system can run without API keys. To call a real model, set one of the provider keys in `.env` and set `DEFAULT_PROVIDER` to `openai`, `deepseek`, `groq`, or `openrouter`.

Example:

```env
DEFAULT_PROVIDER=openai
DEFAULT_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-...
```

OpenRouter is also supported through the OpenAI-compatible API:

```env
DEFAULT_PROVIDER=openrouter
DEFAULT_MODEL=openai/gpt-oss-120b:free
OPENROUTER_API_KEY=sk-or-...
```

## Kubernetes Deployment

Self-hosted Kubernetes manifests live in `k8s/` and can be applied with Kustomize:

```bash
kubectl apply -f k8s/base/namespace.yaml
# create the ollive-secrets Secret as shown in k8s/README.md
kubectl apply -k k8s
```

The manifests deploy the same service boundaries as Docker Compose: separate chat UI, chat API, dashboard UI, observability API, Postgres, and NATS JetStream. They default to locally built image names and the `mock` provider. See `k8s/README.md` for image loading, ingress, port-forwarding, and secret override instructions.

For a one-command local `kind` deployment after Docker is running, put your provider keys in `.env` and run:

```bash
./scripts/kind-up.sh
```

The helper reads `.env`, creates the complete `ollive-secrets` Secret, applies provider/model runtime config, builds and loads images, applies the manifests, restarts the deployments, and waits for readiness. To also start local port-forwards for both UIs and APIs:

```bash
./scripts/kind-up.sh --port-forward
```

If the cluster is already running and only the local forwards are stale after a rollout, refresh them without rebuilding:

```bash
./scripts/port-forward.sh
```

For a registry-based deployment, push the four images first:

```bash
./scripts/push-images.sh ghcr.io/your-org v0.1.0
```

## Quick Smoke Flow

Create a conversation:

```bash
curl -s -X POST http://localhost:8000/v1/conversations \
  -H 'content-type: application/json' \
  -d '{"title":"Demo"}'
```

Send a message:

```bash
curl -s -X POST http://localhost:8000/v1/conversations/<conversation_id>/messages \
  -H 'content-type: application/json' \
  -d '{"content":"Explain inference observability briefly"}'
```

View logs:

```bash
curl -s http://localhost:8001/v1/inference-logs
```

View metrics:

```bash
curl -s http://localhost:8001/v1/metrics/summary
```

## Architecture Overview

```txt
user browser                  ops/eng browser
     |                              |
     v                              v
  chat-ui  (nginx :5173)     dashboard-ui (nginx :5174)
     |  /api/* -> :8000             |  /api/* -> :8001
     v                              v
  chat-service                observability-service
   |  chat_app_db                   ^   |
   |  inference-sdk                 |   |
   |    -> foundation model         |   ingestion_events  (raw)
   |    -> NATS JetStream  ---->----+   inference_logs    (normalized)
   |       (inference.events)           metrics APIs
```

Four deployable services with clean boundaries:

- `chat-ui` and `chat-service` together form the **product surface** (conversations, messages, streaming).
- `dashboard-ui` and `observability-service` together form the **operator surface** (metrics, logs, drill-down).
- Neither frontend talks to the other backend.
- The two backends communicate only via NATS JetStream — there is no direct HTTP coupling.

## Schema Decisions

There are two logical databases in one local Postgres container:

- `chat_app_db`
- `observability_db`

This keeps the demo simple while preserving the production boundary between chat state and telemetry state.

### Chat Tables

- `conversations`: user-facing chat sessions and lifecycle status.
- `chat_messages`: full user/assistant message content used to resume conversations and build short context.

### Observability Tables

- `applications`: source applications emitting telemetry.
- `ingestion_events`: raw received telemetry events with validation/processing status.
- `inference_logs`: normalized queryable inference metadata for dashboards.

Observability stores redacted previews, hashes, and redaction metadata, not full prompt/response bodies. Full chat content remains in the chat database.

## PII Redaction

Redaction is performed in the SDK before telemetry is emitted. The default `standard` policy detects typed entities such as emails, phone numbers, Luhn-valid card numbers, API keys/secrets, PAN-like IDs, and Aadhaar-like IDs. The event stores safe metadata including `redaction_policy`, `redaction_types`, `redaction_count`, and truncation flags.

Runtime knobs:

- `PII_REDACTION_MODE=standard`: replace detected values with placeholders.
- `PII_REDACTION_MODE=strict`: replace the entire preview with `[REDACTED_PREVIEW]` if any PII is detected.
- `PII_REDACTION_MODE=off`: keep previews unredacted, still bounded by `PII_PREVIEW_MAX_CHARS`.
- `PII_PREVIEW_MAX_CHARS=500`: maximum preview size stored in telemetry.

## Tradeoffs

- Postgres is used for both product and telemetry storage to keep local setup lightweight. For high-cardinality production analytics, ClickHouse would be better for inference logs.
- NATS JetStream provides event-driven decoupling without Kafka operational overhead.
- SDK telemetry is fail-open, so chat still works if observability is down.
- Provider support targets OpenAI-compatible APIs first because OpenAI, DeepSeek, and Groq can share the same request shape.
- Streaming chunks are not logged individually. One final inference event summarizes the stream.
- PII redaction is policy-based and validates some classes such as cards before redacting, but it is still not a complete DLP system.

## Frontends

There are two separate React + Vite + TypeScript SPAs. Each is built once and served as static assets by its own nginx.

### `services/chat-ui` — Ollive Chat (`:5173`)

Claude-style chat surface: cream paper background, Source Serif 4 hero, Inter UI, warm-orange accent. Features:

- Hero "welcome" state with greeting, centered composer and suggestion chips.
- Sidebar with conversations grouped by *Today / Yesterday / Previous 7 days / Previous 30 days / Older*.
- New chat button, resume, cancel.
- Streaming SSE responses with a live caret, plus a non-streaming toggle. The stop button cancels only the current assistant response; the separate topbar cancel action closes the whole conversation.
- Provider/model picker (mock, OpenAI, DeepSeek, Groq).
- A discreet "Dashboard" link in the sidebar that opens `dashboard-ui` in a new tab.

### `services/dashboard-ui` — Ollive Observability (`:5174`)

SigNoz-style dark observability console: Inter UI + JetBrains Mono numerics, icon side-nav, time-range picker, dense panels. Pages:

- **Overview** — KPI strip (requests, success rate, p95 latency, tokens, est. cost) with deltas against the previous window and inline sparklines. Request-rate and latency line charts with hover crosshair. Provider donut, model bar list, status donut. Recent inference calls table.
- **Inference logs** — filterable table (status, provider, free-text search) with click-through to a detail page.
- **Log detail** — normalized attributes grid + input/output previews + raw `provider_metadata` / `request_params`.
- **Models** — per-model share, request count, error count, avg latency, tokens, cost.

### Local development

Each frontend can be run with hot reload against backends already running on `:8000` / `:8001`:

```bash
cd services/chat-ui && npm install && npm run dev    # http://localhost:5173
cd services/dashboard-ui && npm install && npm run dev  # http://localhost:5174
```

In dev mode Vite proxies `/api/*` to the appropriate backend; in production nginx does the same inside the container.

## What I Would Improve With More Time

- Add OpenTelemetry Collector and OTLP GenAI span ingestion.
- Add ClickHouse for telemetry analytics.
- Add auth, API keys, and tenant/project isolation.
- Harden the Kubernetes manifests for production HA Postgres/NATS and secret management.
- Add prompt/model versioning and evaluation result events.
- Add retries/dead-letter handling for failed ingestion events.
- Add CI tests and load tests for streaming and ingestion throughput.

## More Docs

- API contracts: `docs/API.md`
- Architecture notes: `docs/ARCHITECTURE.md`
- Kubernetes deployment: `k8s/README.md`
