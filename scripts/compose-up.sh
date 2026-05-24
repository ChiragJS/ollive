#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

provider="${DEFAULT_PROVIDER:-}"
api_key=""

print_menu() {
  printf '\nChoose LLM provider:\n'
  printf '  1) mock      no API key, deterministic local demo\n'
  printf '  2) groq      OpenAI-compatible, fast streaming\n'
  printf '  3) openai    OpenAI API\n'
  printf '  4) deepseek  DeepSeek API\n'
  printf '  5) openrouter OpenRouter API\n'
  printf '\n'
}

read_provider() {
  if [[ -n "$provider" ]]; then
    return
  fi

  print_menu
  while true; do
    read -r -p 'Provider [1-5, default 1]: ' choice
    case "${choice:-1}" in
      1|mock) provider="mock"; break ;;
      2|groq) provider="groq"; break ;;
      3|openai) provider="openai"; break ;;
      4|deepseek) provider="deepseek"; break ;;
      5|openrouter) provider="openrouter"; break ;;
      *) printf 'Invalid choice. Pick 1, 2, 3, 4, or 5.\n' ;;
    esac
  done
}

read_api_key() {
  case "$provider" in
    mock)
      return
      ;;
    groq)
      api_key="${GROQ_API_KEY:-}"
      ;;
    openai)
      api_key="${OPENAI_API_KEY:-}"
      ;;
    deepseek)
      api_key="${DEEPSEEK_API_KEY:-}"
      ;;
    openrouter)
      api_key="${OPENROUTER_API_KEY:-}"
      ;;
    *)
      printf 'Unsupported provider: %s\n' "$provider" >&2
      exit 1
      ;;
  esac

  if [[ -z "$api_key" ]]; then
    read -r -s -p "Enter ${provider} API key: " api_key
    printf '\n'
  fi

  if [[ -z "$api_key" ]]; then
    printf 'No API key provided. Falling back to mock provider.\n'
    provider="mock"
  fi
}

model_for_provider() {
  case "$provider" in
    groq) printf '%s' "${GROQ_MODEL:-llama-3.1-8b-instant}" ;;
    openai) printf '%s' "${OPENAI_MODEL:-gpt-4.1-mini}" ;;
    deepseek) printf '%s' "${DEEPSEEK_MODEL:-deepseek-chat}" ;;
    openrouter) printf '%s' "${OPENROUTER_MODEL:-openai/gpt-oss-120b:free}" ;;
    *) printf '%s' "${DEFAULT_MODEL:-mock-chat}" ;;
  esac
}

write_env() {
  if [[ -f "$ENV_FILE" ]]; then
    backup=".env.backup.$(date +%Y%m%d%H%M%S)"
    cp "$ENV_FILE" "$backup"
    printf 'Backed up existing .env to %s\n' "$backup"
  fi

  openai_key="${OPENAI_API_KEY:-}"
  deepseek_key="${DEEPSEEK_API_KEY:-}"
  groq_key="${GROQ_API_KEY:-}"
  openrouter_key="${OPENROUTER_API_KEY:-}"

  case "$provider" in
    groq) groq_key="$api_key" ;;
    openai) openai_key="$api_key" ;;
    deepseek) deepseek_key="$api_key" ;;
    openrouter) openrouter_key="$api_key" ;;
  esac

  umask 077
  {
    printf 'POSTGRES_USER=ollive\n'
    printf 'POSTGRES_PASSWORD=%s\n' "${POSTGRES_PASSWORD:-ollive}"
    printf 'CHAT_DATABASE_URL=postgresql://ollive:%s@postgres:5432/chat_app_db\n' "${POSTGRES_PASSWORD:-ollive}"
    printf 'OBSERVABILITY_DATABASE_URL=postgresql://ollive:%s@postgres:5432/observability_db\n' "${POSTGRES_PASSWORD:-ollive}"
    printf 'NATS_URL=nats://nats:4222\n'
    printf 'INFERENCE_EVENTS_STREAM=INFERENCE_EVENTS\n'
    printf 'INFERENCE_EVENTS_SUBJECT=inference.events\n'
    printf 'APPLICATION_NAME=ollive-demo-chat\n'
    printf 'CHAT_SERVICE_NAME=chat-service\n'
    printf 'OBSERVABILITY_SERVICE_NAME=observability-service\n'
    printf 'ENVIRONMENT=local\n'
    printf 'TELEMETRY_TRANSPORT=nats\n'
    printf 'DEFAULT_PROVIDER=%s\n' "$provider"
    printf 'DEFAULT_MODEL=%s\n' "$(model_for_provider)"
    printf 'OPENAI_API_KEY=%s\n' "$openai_key"
    printf 'OPENAI_BASE_URL=https://api.openai.com/v1\n'
    printf 'OPENAI_MODEL=%s\n' "${OPENAI_MODEL:-gpt-4.1-mini}"
    printf 'DEEPSEEK_API_KEY=%s\n' "$deepseek_key"
    printf 'DEEPSEEK_BASE_URL=https://api.deepseek.com/v1\n'
    printf 'DEEPSEEK_MODEL=%s\n' "${DEEPSEEK_MODEL:-deepseek-chat}"
    printf 'GROQ_API_KEY=%s\n' "$groq_key"
    printf 'GROQ_BASE_URL=https://api.groq.com/openai/v1\n'
    printf 'GROQ_MODEL=%s\n' "${GROQ_MODEL:-llama-3.1-8b-instant}"
    printf 'OPENROUTER_API_KEY=%s\n' "$openrouter_key"
    printf 'OPENROUTER_BASE_URL=https://openrouter.ai/api/v1\n'
    printf 'OPENROUTER_MODEL=%s\n' "${OPENROUTER_MODEL:-openai/gpt-oss-120b:free}"
    printf 'OPENROUTER_HTTP_REFERER=%s\n' "${OPENROUTER_HTTP_REFERER:-http://localhost:5173}"
    printf 'OPENROUTER_APP_TITLE=%s\n' "${OPENROUTER_APP_TITLE:-Ollive Assignment}"
    printf 'OBSERVABILITY_HTTP_URL=http://observability-service:8001/v1/ingest/events\n'
    printf 'PII_REDACTION_MODE=%s\n' "${PII_REDACTION_MODE:-standard}"
    printf 'PII_PREVIEW_MAX_CHARS=%s\n' "${PII_PREVIEW_MAX_CHARS:-500}"
    printf 'CONTEXT_MESSAGE_LIMIT=%s\n' "${CONTEXT_MESSAGE_LIMIT:-8}"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

read_provider
read_api_key
write_env

printf '\nStarting stack with provider: %s\n' "$provider"
printf 'Chat UI:      http://localhost:5173\n'
printf 'Dashboard UI: http://localhost:5174\n\n'

docker compose up --build
