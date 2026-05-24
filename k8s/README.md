# Kubernetes Hosting

These manifests deploy the full assignment stack to Kubernetes with Kustomize.

## Components

- `chat-ui`: product-facing React/nginx chat UI.
- `chat-service`: FastAPI chat backend.
- `dashboard-ui`: operator-facing React/nginx observability UI.
- `observability-service`: FastAPI ingestion and dashboard backend.
- `postgres`: single-instance Postgres StatefulSet with a PVC and bootstrap SQL.
- `nats`: single-instance NATS JetStream StatefulSet with a PVC.

The Kubernetes service names intentionally match Docker Compose names, so the frontend nginx configs work unchanged:

- `chat-ui` proxies `/api/*` to `chat-service:8000`.
- `dashboard-ui` proxies `/api/*` to `observability-service:8001`.

## One-Command Local Setup

For local `kind`, the recommended path is to put all runtime values in `.env` and run:

```bash
./scripts/kind-up.sh --port-forward
```

The helper does the full setup from the repository root:

- Builds the four local images with Docker Compose.
- Creates or reuses the `ollive-assignment` kind cluster.
- Creates the `ollive` namespace.
- Creates/updates the complete `ollive-secrets` Secret from `.env` without printing secret values.
- Applies the Kubernetes manifests.
- Reapplies runtime config from `.env` so provider/model settings match local config.
- Loads images into kind, restarts deployments, and waits for rollouts.
- With `--port-forward`, opens local ports `5173`, `5174`, `8000`, and `8001`.

If pods are restarted later, `kubectl port-forward` can lose its selected pod and local requests may fail with connection errors or empty replies. Refresh the forwards without rebuilding by running:

```bash
./scripts/port-forward.sh
```

If `DEFAULT_PROVIDER` is set to a real provider, the corresponding key must be present in `.env` before running the helper. For OpenRouter:

```env
DEFAULT_PROVIDER=openrouter
DEFAULT_MODEL=openai/gpt-oss-120b:free
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-oss-120b:free
```

If `DEFAULT_PROVIDER=mock`, real provider keys are optional and you can still choose providers from the Chat UI when keys are present.

## Manual Secret Setup

Secrets are not applied from the checked-in kustomization. Create them in-cluster before applying the stack.

```bash
kubectl apply -f k8s/base/namespace.yaml

export POSTGRES_PASSWORD='replace-with-a-real-password'

kubectl -n ollive create secret generic ollive-secrets \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=CHAT_DATABASE_URL="postgresql://ollive:${POSTGRES_PASSWORD}@postgres:5432/chat_app_db" \
  --from-literal=OBSERVABILITY_DATABASE_URL="postgresql://ollive:${POSTGRES_PASSWORD}@postgres:5432/observability_db" \
  --from-literal=OPENAI_API_KEY="" \
  --from-literal=DEEPSEEK_API_KEY="" \
  --from-literal=GROQ_API_KEY="" \
  --from-literal=OPENROUTER_API_KEY="" \
  --dry-run=client -o yaml | kubectl apply -f -
```

To use a real provider, set `DEFAULT_PROVIDER` in `k8s/base/configmap.yaml` and provide the corresponding key in this secret.

Example:

```bash
kubectl -n ollive create secret generic ollive-secrets \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=CHAT_DATABASE_URL="postgresql://ollive:${POSTGRES_PASSWORD}@postgres:5432/chat_app_db" \
  --from-literal=OBSERVABILITY_DATABASE_URL="postgresql://ollive:${POSTGRES_PASSWORD}@postgres:5432/observability_db" \
  --from-literal=GROQ_API_KEY="$GROQ_API_KEY" \
  --from-literal=OPENAI_API_KEY="" \
  --from-literal=DEEPSEEK_API_KEY="" \
  --from-literal=OPENROUTER_API_KEY="" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`k8s/secret.example.yaml` documents the required keys. Do not put real secrets in Git.

## Option A: Local Kind / Minikube

Build local images:

```bash
docker compose build
```

Or run the helper from the repository root. It reads `.env` and creates the required secret/config for you:

```bash
./scripts/kind-up.sh
```

The helper builds images, creates or reuses a `kind` cluster named `ollive-assignment`, creates the runtime secret, loads images, applies manifests, applies runtime config from `.env`, restarts deployments, and waits for rollouts.

For `kind`, load them into the cluster:

```bash
kind load docker-image ollive-assignment-chat-service:latest
kind load docker-image ollive-assignment-observability-service:latest
kind load docker-image ollive-assignment-chat-ui:latest
kind load docker-image ollive-assignment-dashboard-ui:latest
```

For Minikube, either use `minikube image load ...` or build inside the Minikube Docker daemon.

Apply:

```bash
kubectl apply -k k8s
```

## Option B: Remote Cluster With Registry

Choose a registry and immutable tag:

```bash
export REGISTRY='ghcr.io/your-org'
export TAG='v0.1.0'
```

Build and push images:

```bash
docker build -f services/chat-service/Dockerfile -t "$REGISTRY/ollive-assignment-chat-service:$TAG" .
docker build -f services/observability-service/Dockerfile -t "$REGISTRY/ollive-assignment-observability-service:$TAG" .
docker build -f services/chat-ui/Dockerfile -t "$REGISTRY/ollive-assignment-chat-ui:$TAG" .
docker build -f services/dashboard-ui/Dockerfile -t "$REGISTRY/ollive-assignment-dashboard-ui:$TAG" .

docker push "$REGISTRY/ollive-assignment-chat-service:$TAG"
docker push "$REGISTRY/ollive-assignment-observability-service:$TAG"
docker push "$REGISTRY/ollive-assignment-chat-ui:$TAG"
docker push "$REGISTRY/ollive-assignment-dashboard-ui:$TAG"
```

Or use the helper:

```bash
./scripts/push-images.sh "$REGISTRY" "$TAG"
```

Edit `k8s/overlays/remote/kustomization.yaml`:

- Replace `ghcr.io/example/...` with your registry image names.
- Replace `v0.1.0` with your pushed tag.
- Replace `chat.example.com` and `dashboard.example.com` with real hostnames.

Then apply:

```bash
kubectl apply -k k8s/overlays/remote
```

If your registry is private, create an image pull secret and attach it to the namespace/service accounts before applying.

## Rollout Checks

```bash
kubectl -n ollive get pods
kubectl -n ollive rollout status deploy/chat-service
kubectl -n ollive rollout status deploy/observability-service
kubectl -n ollive rollout status deploy/chat-ui
kubectl -n ollive rollout status deploy/dashboard-ui
kubectl -n ollive get pvc
kubectl -n ollive get ingress
```

Useful debugging commands:

```bash
kubectl -n ollive describe pod <pod-name>
kubectl -n ollive logs deploy/chat-service
kubectl -n ollive logs deploy/observability-service
kubectl -n ollive logs statefulset/postgres
kubectl -n ollive logs statefulset/nats
```

## Access Without Ingress

```bash
kubectl -n ollive port-forward svc/chat-ui 5173:80
kubectl -n ollive port-forward svc/dashboard-ui 5174:80
```

Open:

- Chat UI: `http://localhost:5173`
- Dashboard UI: `http://localhost:5174`

## Access With Ingress

The base ingress expects an nginx ingress controller and these local hostnames:

- `chat.ollive.local`
- `dashboard.ollive.local`

The remote overlay replaces those with `chat.example.com` and `dashboard.example.com`; edit them before applying.

For a local ingress controller, point the names to the ingress IP in `/etc/hosts`.

For a remote cluster, create DNS records pointing to the ingress controller load balancer. Add TLS via cert-manager or your cloud ingress integration.

## Smoke Test

After deployment:

```bash
kubectl -n ollive port-forward svc/chat-service 8000:8000
kubectl -n ollive port-forward svc/observability-service 8001:8001
```

Then:

```bash
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8001/health
curl -fsS -X POST http://localhost:8000/v1/conversations \
  -H 'content-type: application/json' \
  -d '{"title":"Kubernetes smoke test"}'
curl -fsS http://localhost:8001/v1/metrics/summary
```

## Production Notes

- The included Postgres and NATS manifests are single-instance demo deployments, not HA production data services.
- Use managed Postgres or an HA Postgres operator for real production.
- Use a NATS operator or managed eventing layer for HA JetStream.
- Use immutable image tags instead of `latest` on remote clusters.
- Add TLS, authentication, and network policies before exposing the dashboard publicly.
- Add backup/restore for Postgres and retention policies for observability data.
