#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <registry> [tag]\n' "$0" >&2
  printf 'Example: %s ghcr.io/your-org v0.1.0\n' "$0" >&2
  exit 1
fi

REGISTRY="$1"
TAG="${2:-latest}"

LOCAL_IMAGES=(
  "ollive-assignment-chat-service"
  "ollive-assignment-observability-service"
  "ollive-assignment-chat-ui"
  "ollive-assignment-dashboard-ui"
)

printf 'Building local Docker images with docker compose...\n'
docker compose build

for image in "${LOCAL_IMAGES[@]}"; do
  remote="${REGISTRY}/${image}:${TAG}"
  printf 'Tagging %s:latest -> %s\n' "$image" "$remote"
  docker tag "${image}:latest" "$remote"
  printf 'Pushing %s\n' "$remote"
  docker push "$remote"
done

printf '\nImages pushed. Update k8s/overlays/remote/kustomization.yaml with:\n'
printf '  registry: %s\n' "$REGISTRY"
printf '  tag: %s\n' "$TAG"
