---
name: docker-compose
description: Conventions for the 13-service Docker Compose stack, the backend and frontend Dockerfiles, env var plumbing, and the gitignored dev and memlim override files. Use when changing services, images, build args, or environment configuration.
---

# Docker Compose — divaldi conventions

**The full project runs only via Docker Compose.** There is no supported local run of the
application; see the reasoning in `.context/DECISIONS.md`.

## The stack

| Service | Image / build | Role |
|---|---|---|
| `frontend` | `./frontend`, build arg `BACKEND_URL` | nginx serving the Angular bundle, proxies `/api` |
| `backend` | context `.`, `backend/Dockerfile` | FastAPI + uvicorn on port 3000 |
| `migrate` | same image | one-shot `alembic upgrade head` |
| `scheduler` | same image | TaskIQ scheduler |
| `worker_default` | same image, x2 replicas | `default` queue |
| `worker_network` | same image, x2 replicas | `network` queue |
| `taskiq_dashboard` | `ghcr.io/danfimov/taskiq-dashboard:v0.4.4` | task observability |
| `db` | `postgres:18-alpine`, `shm_size: 512mb` | application database |
| `redis` | `redis:8-alpine` | cache, locks, rate limits, TaskIQ results |
| `rabbitmq` | `rabbitmq:4-management-alpine`, vhost `taskiq` | task broker |
| `minio` | pinned MinIO release | S3 object storage |
| `minio-init` | `quay.io/minio/mc` | creates buckets, imports ILM rules |

## YAML anchors

The file uses anchors so env and build blocks are not repeated: `x-minio-env`,
`x-postgres-env`, `x-backend-env` (merges the other two), and `x-backend-service` (shared
build, env and `depends_on` for `backend`, `scheduler` and both workers). Add new backend-like
services through `<<: *backend-service` rather than copying the block.

Startup ordering is healthcheck-gated: the backend waits for `db`, `redis`, `rabbitmq` and
`minio` to be healthy, and for `migrate` and `minio-init` to have **completed successfully**.
If you add a dependency, use the same `condition:` style.

## Required env vars

Variables written as `${VAR:?}` are mandatory and Compose refuses to start without them:
`MINIO_ROOT_PASSWORD`, `POSTGRES_PASSWORD`, `DEBUG`, `RABBITMQ_PASS`, `TASKIQ_API_TOKEN`,
`SBER_API_KEY`, `SBER_API_SCOPE`.

Add new secrets in this style and document them in `.env.example` and the README table.

## Dockerfile conventions

`backend/Dockerfile` is deliberately tiny:

```dockerfile
FROM python:3.14-alpine
RUN apk add --no-cache libstdc++
RUN pip install poetry==2.4.3 uvicorn==0.52.4
COPY backend/pyproject.toml backend/poetry.lock /app/
WORKDIR /app
COPY processing/ /processing/
RUN poetry install --only main --no-root
COPY backend/ .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
```

- **Install Poetry before copying the manifests**, so the dependency layer stays cached when
  only `pyproject.toml` changes.
- `uvicorn` is pinned and `pip`-installed in the image; it is deliberately **not** a project
  dependency.
- Production installs use `--only main --no-root`; CI uses `poetry install --no-root`.
- `COPY processing/ /processing/` exists because `backend` depends on it as the path
  dependency `processing @ ../processing`. Keep them in sync.
- `frontend/Dockerfile` takes `ARG BACKEND_URL` and runs `node docker/rewrite-env.mjs` before
  `npm run build`, which is how the API base URL reaches the bundle.

## Override files

Two overrides ship, and the resulting `docker-compose.override.yml` is **gitignored**:

| Source | Effect |
|---|---|
| `docker-compose.override.yml.dev` | bind mounts `./backend` and `./frontend`, forced polling watchers, and publishes PostgreSQL on host port **5431** |
| `docker-compose.override.yml.memlim` | per-service `mem_limit` values; no limits by default |

The `.dev` override is what makes `backend/makemigrations.sh` work, because Alembic runs from
the host and needs the database published.

```bash
cp docker-compose.override.yml{.dev,}    # linux/macOS
docker compose up -d --build
```

## Hardcoded hostnames

`redis://redis:6379`, `amqp://...@rabbitmq:5672/taskiq`, `http://minio:9000` and
`http://taskiq_dashboard:8000` are literals in the backend source and match the Compose
service names. Do not parameterise them without also changing the run model.

Redis database `/0` is general purpose; `/1` is TaskIQ result storage only.

## Infrastructure config in `conf/`

| Path | Mounted to |
|---|---|
| `conf/redis.conf` | `/usr/local/etc/redis/redis.conf` (`maxmemory 1gb`, `volatile-lru`) |
| `conf/minio-init.sh` | `/init.sh` in the `minio-init` service |
| `conf/minio-rules/` | `/rules`, source of the ILM lifecycle rules |
| `conf/postgres-init/` | `/docker-entrypoint-initdb.d`, creates `taskiq_dashboard` |

MinIO buckets are `avatars` and `uploads`, both private (`mc anonymous set none`). Lifecycle
rules expire unprocessed avatars (1 day), attachments (7 days) and artifacts (1 day).

## Secrets

`.env` is gitignored and must never be committed. Use `.env.example`. Generate secrets with
`openssl rand -hex 48`.

## Verify

```bash
docker compose config                 # resolves anchors and required vars
docker compose up -d --build
docker compose ps                     # every service healthy or completed
docker compose logs -f
```

Then confirm the API is reachable and that `/api/v1/docs` responds, which it should only do
when `DEBUG` is truthy.
