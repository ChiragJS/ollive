#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-ollive-assignment}"
NAMESPACE="${K8S_NAMESPACE:-ollive}"
START_PORT_FORWARDS="false"

IMAGES=(
  "ollive-assignment-chat-service:latest"
  "ollive-assignment-observability-service:latest"
  "ollive-assignment-chat-ui:latest"
  "ollive-assignment-dashboard-ui:latest"
)

usage() {
  printf 'Usage: %s [--port-forward]\n' "$0"
  printf '\n'
  printf 'Builds images, creates/reuses kind, creates Kubernetes secrets from .env,\n'
  printf 'applies manifests, restarts deployments, and waits for readiness.\n'
  printf '\n'
  printf 'Options:\n'
  printf '  --port-forward   Start local UI/API port-forwards after deployment.\n'
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port-forward)
        START_PORT_FORWARDS="true"
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n\n' "$1" >&2
        usage >&2
        exit 1
        ;;
    esac
    shift
  done
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

strip_quotes() {
  local value="$1"
  if [[ ${#value} -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ ${#value} -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    printf 'No %s found. Continuing with safe local defaults.\n' "$ENV_FILE"
    return
  fi

  printf 'Loading runtime configuration from %s (secret values are not printed).\n' "$ENV_FILE"
  local line name value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$(trim "$line")" || "$(trim "$line")" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue

    name="$(trim "${line%%=*}")"
    value="${line#*=}"
    value="$(strip_quotes "$value")"

    if [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && -z "${!name+x}" ]]; then
      export "$name=$value"
    fi
  done < "$ENV_FILE"
}

set_runtime_defaults() {
  POSTGRES_USER="${POSTGRES_USER:-ollive}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-ollive}"
  POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
  POSTGRES_PORT="${POSTGRES_PORT:-5432}"
  CHAT_DATABASE_URL="${CHAT_DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/chat_app_db}"
  OBSERVABILITY_DATABASE_URL="${OBSERVABILITY_DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/observability_db}"

  NATS_URL="${NATS_URL:-nats://nats:4222}"
  TELEMETRY_TRANSPORT="${TELEMETRY_TRANSPORT:-nats}"
  INFERENCE_EVENTS_STREAM="${INFERENCE_EVENTS_STREAM:-INFERENCE_EVENTS}"
  INFERENCE_EVENTS_SUBJECT="${INFERENCE_EVENTS_SUBJECT:-inference.events}"

  APPLICATION_NAME="${APPLICATION_NAME:-ollive-demo-chat}"
  CHAT_SERVICE_NAME="${CHAT_SERVICE_NAME:-chat-service}"
  OBSERVABILITY_SERVICE_NAME="${OBSERVABILITY_SERVICE_NAME:-observability-service}"
  ENVIRONMENT="${K8S_ENVIRONMENT:-k8s}"

  DEFAULT_PROVIDER="${DEFAULT_PROVIDER:-mock}"
  DEFAULT_MODEL="${DEFAULT_MODEL:-mock-chat}"
  OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
  OPENAI_MODEL="${OPENAI_MODEL:-gpt-4.1-mini}"
  DEEPSEEK_BASE_URL="${DEEPSEEK_BASE_URL:-https://api.deepseek.com/v1}"
  DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-chat}"
  GROQ_BASE_URL="${GROQ_BASE_URL:-https://api.groq.com/openai/v1}"
  GROQ_MODEL="${GROQ_MODEL:-llama-3.1-8b-instant}"
  OPENROUTER_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
  OPENROUTER_MODEL="${OPENROUTER_MODEL:-openai/gpt-oss-120b:free}"
  OPENROUTER_HTTP_REFERER="${OPENROUTER_HTTP_REFERER:-http://localhost:5173}"
  OPENROUTER_APP_TITLE="${OPENROUTER_APP_TITLE:-Ollive Assignment}"

  OBSERVABILITY_HTTP_URL="${OBSERVABILITY_HTTP_URL:-http://observability-service:8001/v1/ingest/events}"
  PII_REDACTION_MODE="${PII_REDACTION_MODE:-standard}"
  PII_PREVIEW_MAX_CHARS="${PII_PREVIEW_MAX_CHARS:-500}"
  CONTEXT_MESSAGE_LIMIT="${CONTEXT_MESSAGE_LIMIT:-8}"

  OPENAI_API_KEY="${OPENAI_API_KEY:-}"
  DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"
  GROQ_API_KEY="${GROQ_API_KEY:-}"
  OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
}

validate_provider_config() {
  case "$DEFAULT_PROVIDER" in
    mock)
      return
      ;;
    openai)
      [[ -n "$OPENAI_API_KEY" ]] || missing_provider_key OPENAI_API_KEY openai
      ;;
    deepseek)
      [[ -n "$DEEPSEEK_API_KEY" ]] || missing_provider_key DEEPSEEK_API_KEY deepseek
      ;;
    groq)
      [[ -n "$GROQ_API_KEY" ]] || missing_provider_key GROQ_API_KEY groq
      ;;
    openrouter)
      [[ -n "$OPENROUTER_API_KEY" ]] || missing_provider_key OPENROUTER_API_KEY openrouter
      ;;
    *)
      printf 'Unsupported DEFAULT_PROVIDER: %s\n' "$DEFAULT_PROVIDER" >&2
      printf 'Supported providers: mock, openai, deepseek, groq, openrouter\n' >&2
      exit 1
      ;;
  esac
}

missing_provider_key() {
  local key_name="$1"
  local provider_name="$2"
  printf 'DEFAULT_PROVIDER=%s but %s is empty.\n' "$provider_name" "$key_name" >&2
  printf 'Set it in %s or export it before running this script.\n' "$ENV_FILE" >&2
  exit 1
}

cluster_exists() {
  local cluster
  while IFS= read -r cluster; do
    [[ "$cluster" == "$CLUSTER_NAME" ]] && return 0
  done < <(kind get clusters)
  return 1
}

apply_runtime_secret() {
  printf 'Creating/updating runtime secret from %s.\n' "$ENV_FILE"
  kubectl -n "$NAMESPACE" create secret generic ollive-secrets \
    --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    --from-literal=CHAT_DATABASE_URL="$CHAT_DATABASE_URL" \
    --from-literal=OBSERVABILITY_DATABASE_URL="$OBSERVABILITY_DATABASE_URL" \
    --from-literal=OPENAI_API_KEY="$OPENAI_API_KEY" \
    --from-literal=DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" \
    --from-literal=GROQ_API_KEY="$GROQ_API_KEY" \
    --from-literal=OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
    --dry-run=client -o yaml | kubectl apply -f -
}

apply_runtime_config() {
  printf 'Creating/updating runtime config from %s.\n' "$ENV_FILE"
  kubectl -n "$NAMESPACE" create configmap ollive-config \
    --from-literal=POSTGRES_USER="$POSTGRES_USER" \
    --from-literal=POSTGRES_HOST="$POSTGRES_HOST" \
    --from-literal=POSTGRES_PORT="$POSTGRES_PORT" \
    --from-literal=NATS_URL="$NATS_URL" \
    --from-literal=TELEMETRY_TRANSPORT="$TELEMETRY_TRANSPORT" \
    --from-literal=INFERENCE_EVENTS_STREAM="$INFERENCE_EVENTS_STREAM" \
    --from-literal=INFERENCE_EVENTS_SUBJECT="$INFERENCE_EVENTS_SUBJECT" \
    --from-literal=APPLICATION_NAME="$APPLICATION_NAME" \
    --from-literal=CHAT_SERVICE_NAME="$CHAT_SERVICE_NAME" \
    --from-literal=OBSERVABILITY_SERVICE_NAME="$OBSERVABILITY_SERVICE_NAME" \
    --from-literal=ENVIRONMENT="$ENVIRONMENT" \
    --from-literal=DEFAULT_PROVIDER="$DEFAULT_PROVIDER" \
    --from-literal=DEFAULT_MODEL="$DEFAULT_MODEL" \
    --from-literal=OPENAI_BASE_URL="$OPENAI_BASE_URL" \
    --from-literal=OPENAI_MODEL="$OPENAI_MODEL" \
    --from-literal=DEEPSEEK_BASE_URL="$DEEPSEEK_BASE_URL" \
    --from-literal=DEEPSEEK_MODEL="$DEEPSEEK_MODEL" \
    --from-literal=GROQ_BASE_URL="$GROQ_BASE_URL" \
    --from-literal=GROQ_MODEL="$GROQ_MODEL" \
    --from-literal=OPENROUTER_BASE_URL="$OPENROUTER_BASE_URL" \
    --from-literal=OPENROUTER_MODEL="$OPENROUTER_MODEL" \
    --from-literal=OPENROUTER_HTTP_REFERER="$OPENROUTER_HTTP_REFERER" \
    --from-literal=OPENROUTER_APP_TITLE="$OPENROUTER_APP_TITLE" \
    --from-literal=OBSERVABILITY_HTTP_URL="$OBSERVABILITY_HTTP_URL" \
    --from-literal=PII_REDACTION_MODE="$PII_REDACTION_MODE" \
    --from-literal=PII_PREVIEW_MAX_CHARS="$PII_PREVIEW_MAX_CHARS" \
    --from-literal=CONTEXT_MESSAGE_LIMIT="$CONTEXT_MESSAGE_LIMIT" \
    --dry-run=client -o yaml | kubectl apply -f -
}

start_port_forwards() {
  K8S_NAMESPACE="$NAMESPACE" ./scripts/port-forward.sh
}

parse_args "$@"

require_cmd docker
require_cmd kubectl
require_cmd kind
if [[ "$START_PORT_FORWARDS" == "true" ]]; then
  require_cmd curl
fi

load_env_file
set_runtime_defaults
validate_provider_config

printf 'Building local Docker images with docker compose...\n'
docker compose build

if ! cluster_exists; then
  printf 'Creating kind cluster: %s\n' "$CLUSTER_NAME"
  kind create cluster --name "$CLUSTER_NAME"
else
  printf 'Using existing kind cluster: %s\n' "$CLUSTER_NAME"
fi

kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null

printf 'Creating namespace and runtime secret...\n'
kubectl apply -f k8s/base/namespace.yaml
apply_runtime_secret

printf 'Loading images into kind...\n'
for image in "${IMAGES[@]}"; do
  kind load docker-image "$image" --name "$CLUSTER_NAME"
done

printf 'Applying Kubernetes manifests...\n'
kubectl apply -k k8s
apply_runtime_config

printf 'Waiting for StatefulSets...\n'
kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=180s
kubectl -n "$NAMESPACE" rollout status statefulset/nats --timeout=180s

printf 'Restarting deployments so latest images/config/secrets are used...\n'
kubectl -n "$NAMESPACE" rollout restart deploy/observability-service deploy/chat-service deploy/chat-ui deploy/dashboard-ui

printf 'Waiting for Deployments...\n'
kubectl -n "$NAMESPACE" rollout status deploy/observability-service --timeout=180s
kubectl -n "$NAMESPACE" rollout status deploy/chat-service --timeout=180s
kubectl -n "$NAMESPACE" rollout status deploy/chat-ui --timeout=180s
kubectl -n "$NAMESPACE" rollout status deploy/dashboard-ui --timeout=180s

if [[ "$START_PORT_FORWARDS" == "true" ]]; then
  start_port_forwards
fi

printf '\nLocal kind deployment is ready.\n'

if [[ "$START_PORT_FORWARDS" == "true" ]]; then
  printf '\nPort-forwards started:\n'
  printf '  Chat UI:          http://localhost:5173\n'
  printf '  Dashboard UI:     http://localhost:5174\n'
  printf '  Chat API:         http://localhost:8000\n'
  printf '  Observability API:http://localhost:8001\n'
else
  printf '\nOpen the UIs with port-forwarding:\n'
  printf '  kubectl -n %s port-forward svc/chat-ui 5173:80\n' "$NAMESPACE"
  printf '  kubectl -n %s port-forward svc/dashboard-ui 5174:80\n' "$NAMESPACE"
  printf '\nHealth checks via service port-forwarding:\n'
  printf '  kubectl -n %s port-forward svc/chat-service 8000:8000\n' "$NAMESPACE"
  printf '  kubectl -n %s port-forward svc/observability-service 8001:8001\n' "$NAMESPACE"
fi

printf '\nRuntime defaults applied to Kubernetes:\n'
printf '  DEFAULT_PROVIDER=%s\n' "$DEFAULT_PROVIDER"
printf '  DEFAULT_MODEL=%s\n' "$DEFAULT_MODEL"
printf '  OPENROUTER_MODEL=%s\n' "$OPENROUTER_MODEL"
printf '\nUseful status command:\n'
printf '  kubectl -n %s get pods,svc,pvc,ingress\n' "$NAMESPACE"
