#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-ollive}"
LOG_DIR="${PORT_FORWARD_LOG_DIR:-/tmp/opencode}"

usage() {
  printf 'Usage: %s\n' "$0"
  printf '\n'
  printf 'Restarts local port-forwards for the Ollive kind stack and waits for health checks.\n'
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

stop_port_forward_for_service() {
  local service="$1"
  local pid
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done < <(pgrep -f "kubectl.*-n ${NAMESPACE} port-forward svc/${service}" || true)
}

stop_kubectl_listener_on_port() {
  local port="$1"
  local line pid
  while IFS= read -r line; do
    if [[ "$line" == *kubectl* && "$line" =~ pid=([0-9]+) ]]; then
      pid="${BASH_REMATCH[1]}"
      kill "$pid" 2>/dev/null || true
    fi
  done < <(ss -ltnp "sport = :${port}" 2>/dev/null || true)
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempt
  for attempt in {1..30}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf '  %s ready: %s\n' "$name" "$url"
      return 0
    fi
    sleep 1
  done

  printf '%s did not become ready at %s. Check %s port-forward logs.\n' "$name" "$url" "$LOG_DIR" >&2
  return 1
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    printf 'Unknown option: %s\n\n' "$1" >&2
    usage >&2
    exit 1
    ;;
esac

require_cmd kubectl
require_cmd curl
require_cmd ss

mkdir -p "$LOG_DIR"

printf 'Stopping existing local port-forwards for namespace %s.\n' "$NAMESPACE"
stop_port_forward_for_service chat-ui
stop_port_forward_for_service dashboard-ui
stop_port_forward_for_service chat-service
stop_port_forward_for_service observability-service
stop_kubectl_listener_on_port 5173
stop_kubectl_listener_on_port 5174
stop_kubectl_listener_on_port 8000
stop_kubectl_listener_on_port 8001
sleep 1

printf 'Starting local port-forwards. Logs are in %s.\n' "$LOG_DIR"
nohup kubectl -n "$NAMESPACE" port-forward svc/chat-ui 5173:80 >"${LOG_DIR}/ollive-chat-ui-port-forward.log" 2>&1 &
nohup kubectl -n "$NAMESPACE" port-forward svc/dashboard-ui 5174:80 >"${LOG_DIR}/ollive-dashboard-ui-port-forward.log" 2>&1 &
nohup kubectl -n "$NAMESPACE" port-forward svc/chat-service 8000:8000 >"${LOG_DIR}/ollive-chat-service-port-forward.log" 2>&1 &
nohup kubectl -n "$NAMESPACE" port-forward svc/observability-service 8001:8001 >"${LOG_DIR}/ollive-observability-service-port-forward.log" 2>&1 &

wait_for_url "Chat UI" "http://localhost:5173/health"
wait_for_url "Dashboard UI" "http://localhost:5174/health"
wait_for_url "Chat API" "http://localhost:8000/health"
wait_for_url "Observability API" "http://localhost:8001/health"

printf '\nPort-forwards ready:\n'
printf '  Chat UI:           http://localhost:5173\n'
printf '  Dashboard UI:      http://localhost:5174\n'
printf '  Chat API:          http://localhost:8000\n'
printf '  Observability API: http://localhost:8001\n'
