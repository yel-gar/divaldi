<div align="center">

# 🎼 Divaldi

**AI‑assisted quotation engine for sheet‑metal fabrication**

*Upload a drawing. Get a priced commercial offer.*

[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Angular](https://img.shields.io/badge/frontend-Angular%2021-DD0031?logo=angular&logoColor=white)](https://angular.dev)
[![Python](https://img.shields.io/badge/python-3.14-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![PostgreSQL](https://img.shields.io/badge/db-PostgreSQL%2018-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![RabbitMQ](https://img.shields.io/badge/broker-RabbitMQ%204-FF6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com)
[![Redis](https://img.shields.io/badge/cache-Redis%208-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Garage](https://img.shields.io/badge/storage-Garage-EEEEEE?logo=rust&logoColor=black)](https://garagehq.deuxfleurs.fr)
[![TaskIQ](https://img.shields.io/badge/queue-TaskIQ-FFD34E?logoColor=black)](https://taskiq-python.github.io)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey)]()

[🇬🇧 English](README.md) · [🇷🇺 Русский](README.ru.md)

</div>

---

## 🎯 What is Divaldi?

Divaldi is an internal web application for **ООО НПО «Энергон»**, a metal‑working
fabrication company. It turns a customer's **drawings** into a **priced commercial offer**
(commercial proposal, *КП*) as an Excel file — automatically.

An engineer uploads a PDF/DXF drawing, adds a short description, and chats with an
AI technologist that reads the drawing, identifies the material, extracts geometry,
asks clarifying questions when data is missing, and finally produces a costed
`.xlsx` offer based on the shop's real production norms.

```
   📐 Drawing (PDF / DXF / PNG / JPEG)
              │
              ▼
   ┌──────────────────────────┐
   │  Preprocessing workers   │  PDF → 150 DPI PNG pages · DXF → measurement report
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │   GigaChat (Sber) LLM    │  reads images + DXF text + user message
   │   structured JSON output │  material · area · bends · welds · hours
   └──────────────────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │  processing.calculator   │  fills res/calc.xlsx with production norms
   └──────────────────────────┘
              │
              ▼
        📊 kp.xlsx  (offer)
```

---

## ✨ Features

### 👷 For engineers

| | Feature | Details |
|---|---|---|
| 💬 | **AI chat with a technologist** | Asynchronous generation, live status indicator, Markdown + syntax highlighting |
| 📎 | **Drawing upload** | Drag‑and‑drop, PDF · DXF · PNG · JPEG, up to **30 MB**, max 3 concurrent uploads |
| 🔍 | **Automatic file parsing** | PDF pages rasterised at 150 DPI; DXF entities parsed into a measurement report |
| ❓ | **Clarification loop** | When dimensions or material are missing, the agent asks targeted questions and recomputes |
| 📊 | **Commercial offer (КП)** | Priced `.xlsx` generated from the shop's production norms (laser / welding / bending / painting) |
| 📄 | **File preview** | Inline preview of PDF, images, `.docx`, and `.xlsx` (with live formula evaluation) |
| 🕘 | **Request history** | Sortable, most‑recently‑active first, with skeleton and empty states |
| 🔁 | **Retry failed generations** | One click to regenerate after an error |
| 🌗 | **Light / dark theme** | Persisted in `localStorage` |
| 👤 | **Profile & avatar** | PNG/JPEG/WebP, normalised to WebP |

### 🛡️ For administrators

| | Feature | Details |
|---|---|---|
| 👥 | **User management** | Search, create, edit, delete |
| 📅 | **Account expiry** | `expires_at` with active / expiring / expired badges |
| 🔑 | **Password reset** | Superuser‑only; fully disabled under `TEST_INSTANCE_MODE` |
| 🚦 | **Test‑instance mode** | `TEST_INSTANCE_MODE=true` blocks destructive admin actions with HTTP `450` |

### ⚙️ For operators

| | Feature | Details |
|---|---|---|
| 📈 | **TaskIQ dashboard** | Task history, results, failures |
| 🐇 | **RabbitMQ management** | Queue depth and worker health |
| 🗄️ | **Garage admin API** | Cluster status, layout, keys |
| ♻️ | **Self‑cleaning storage** | ILM rules expire unprocessed avatars (1 d), attachments (7 d), artifacts (1 d) |
| 🧹 | **Scheduled cleanup** | Hourly jobs purge stale results, orphan attachments and expired sessions |

---

## 🏗️ Architecture

```
divaldi/
├── backend/          FastAPI + SQLAlchemy 2.0 (async) + Alembic + TaskIQ
│   ├── app/
│   │   ├── routes/       HTTP layer — one APIRouter per domain
│   │   ├── schemas/      Pydantic v2 request/response models
│   │   ├── models/       SQLAlchemy ORM models
│   │   ├── tasks/        TaskIQ background jobs (default + network queues)
│   │   ├── providers/    GigaChat (Sber) AI client
│   │   ├── cache.py      Redis client + every cache-key builder
│   │   ├── storage.py    S3 object storage (Garage)
│   │   ├── deps.py       Annotated dependency aliases
│   │   └── harness.py    LLM system prompt + structured output schema
│   ├── alembic/          Migrations (single `initial` revision so far)
│   ├── res/              calc.xlsx template, GigaChat CA certificate
│   └── tests/            pytest + testcontainers
├── processing/        Shared library: PDF rasteriser, DXF parser, Excel calculator
├── frontend/          Angular 21 standalone + signals + SCSS
├── conf/              Infra config: redis.conf, garage.toml, garage-init.sh, lifecycle rules, pg init
├── scripts/           pre-commit shims for per-package Poetry tools
└── docker-compose.yaml
```

### 🔁 Request lifecycle

1. `POST /api/v1/chats` creates a session, returns `202`.
2. The message is enqueued on the **`network`** queue (`generate_chat_message`).
3. The worker uploads attachments to GigaChat and requests a structured JSON completion.
4. If the agent returns positions → `res/calc.xlsx` is filled → `kp.xlsx` lands in Garage.
5. If it returns an empty `positions` list → it asked clarifying questions instead.
6. The frontend polls `GET /chats/{id}/result` every 2 s (5 min timeout) — there are no WebSockets.

### 🧾 Two task queues

| Queue | Purpose | Tasks |
|---|---|---|
| `default` | Local / CPU‑bound work | DXF parsing, PDF rasterising, avatar normalisation, result processing, cleanup crons |
| `network` | Outbound calls to GigaChat | `generate_chat_message`, `upload_pdf_image` |

Splitting them means a slow external API never blocks the local pipeline.

---

## 🧰 Tech stack

**Backend** — Python 3.14 · FastAPI · SQLAlchemy 2.0 (async) · asyncpg · Alembic · Pydantic v2 · TaskIQ · structlog · argon2‑cffi · aioboto3 · Pillow · uvicorn

**Processing** — PyMuPDF · Pillow · openpyxl (pure‑Python DXF parser, no `ezdxf`)

**Frontend** — Angular 21 (standalone, signals) · TypeScript 5.9 · SCSS (BEM + CSS custom properties) · RxJS · Vitest · ESLint · Prettier

**Infrastructure** — Docker Compose · PostgreSQL 18 · Redis 8 · RabbitMQ 4 · Garage

---

## 🚀 Quick start

### 📋 Prerequisites

- 🐳 **Docker** with **Docker Compose v2**
- 📝 A `.env` file with the secrets marked required in the [table below](#-environment-variables)

> ⚠️ **The full project runs only via Docker Compose.** The backend expects service
> hostnames (`db`, `redis`, `rabbitmq`, `garage`) and two paths resolved relative to
> `backend/` as the working directory. There is no supported local run of the app.
> Running individual services locally is fine for editing, but *running* means Compose.

### 1️⃣ Clone

```bash
git clone https://github.com/yel-gar/divaldi.git
cd divaldi
```

### 2️⃣ Configure

```bash
# Linux / macOS
cp .env{.example,}
```

```powershell
# Windows PowerShell
PS> Copy-Item .env.example .env
```

Then fill in the required values — at minimum `POSTGRES_PASSWORD`, `RABBITMQ_PASS`,
`TASKIQ_API_TOKEN`, `S3_SECRET_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`,
`SBER_API_KEY`, `SBER_API_SCOPE`.

Generate secrets with:

```bash
openssl rand -hex 48
```

### 3️⃣ Launch

```bash
docker compose up -d --build
docker compose logs -f
```

### 4️⃣ Create an administrator

There is **no registration** — the first account is created interactively:

```bash
# Linux / macOS
chmod +x createsuperuser.sh
./createsuperuser.sh
```

```powershell
# Windows PowerShell
PS> .\createsuperuser.ps1
```

### 5️⃣ Sign in

Open **http://localhost:8080** and log in with the account you just created. 🎉

---

## 🔌 Services & ports

| Service | URL | Notes |
|---|---|---|
| 🌐 **Frontend** | http://localhost:8080 | nginx, proxies `/api` to the backend |
| ⚡ **Backend API** | http://localhost:3000 | docs at `/api/v1/docs` — **only when `DEBUG` is on** |
| 📈 **TaskIQ dashboard** | http://localhost:8000 | needs `TASKIQ_API_TOKEN` |
| 🐇 **RabbitMQ** | http://localhost:15672 | user `RABBITMQ_USER` / `RABBITMQ_PASS` |
| 🗄️ **Garage admin API** | http://localhost:3903 | needs `GARAGE_ADMIN_TOKEN` |
| 🗃️ **Garage S3 API** | http://localhost:3900 | presigned upload/download URLs point here |
| 🐘 **PostgreSQL** | `localhost:5432` | `5431` in the dev override |

### Compose services

| Service | Role |
|---|---|
| `frontend` | Angular bundle served by nginx |
| `backend` | FastAPI + uvicorn |
| `migrate` | one‑shot `alembic upgrade head`, others wait for it |
| `scheduler` | TaskIQ scheduler (periodic jobs) |
| `worker_default` | ×2 replicas on the `default` queue |
| `worker_network` | ×2 replicas on the `network` queue |
| `taskiq_dashboard` | task observability |
| `db` | PostgreSQL 18 (`shm_size: 512mb`) |
| `redis` | cache + locks + rate limits |
| `rabbitmq` | task broker, vhost `taskiq` |
| `garage` | S3-compatible object storage (`--single-node`) |
| `garage-bootstrap` | imports the app key, creates the buckets, grants access |
| `garage-config` | applies the expiration and CORS rules over the S3 API |

---

## 👨‍💻 Developer setup

<details>
<summary><b>🔧 Hot‑reload dev stack</b></summary>

The committed `.dev` override bind‑mounts the source into the containers and adds
polling watchers. It also publishes PostgreSQL on `5431` — **required for migrations**.

```bash
# Linux / macOS
cp docker-compose.override.yml{.dev,}
```

```powershell
# Windows PowerShell
PS> Copy-Item docker-compose.override.yml.dev docker-compose.override.yml
```

```bash
docker compose up -d --build
```

Then edit `backend/` or `frontend/` and just wait for the reload.

</details>

<details>
<summary><b>🪢 Git hooks (linting, formatting, commit messages)</b></summary>

All hooks live in the single root `.pre-commit-config.yaml`.

```bash
npm install                  # commitlint, used by the commit-msg hook
pip install pre-commit
pre-commit install --hook-type pre-commit --hook-type commit-msg
```

| Hook | Scope |
|---|---|
| `check-yaml`, `check-json`, `check-toml`, `end-of-file-fixer`, `trailing-whitespace` | repo‑wide |
| `black`, `ruff`, `pytest` | `backend/**.py` |
| `black`, `ruff`, `pytest` | `processing/**.py` |
| `eslint --fix`, `prettier --write` | `frontend/**` |

> ⚠️ The Python hooks invoke a `python` executable. If yours is `python3` or `py`,
> set up an alias.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are
validated by `commitlint.config.js`.

</details>

<details>
<summary><b>🐍 Running tests & checks locally</b></summary>

Tests may be run locally. Backend tests use **testcontainers**, so a Docker *daemon*
must be running (they spin up throwaway PostgreSQL and Redis).

```bash
# backend
poetry -C backend install
poetry -C backend run pytest
poetry -C backend run black --check .
poetry -C backend run ruff check .

# processing
poetry -C processing install
poetry -C processing run pytest -v
poetry -C processing run black --check src tests
poetry -C processing run ruff check src tests

# frontend
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run format
```

</details>

<details>
<summary><b>🗄️ Alembic migrations</b></summary>

```bash
# with the .dev override in place (PostgreSQL published on 5431)
./backend/makemigrations.sh "add foo column"
```

`test_migrations.py` runs `alembic upgrade head`, `downgrade base` and `alembic check`,
so **a model change without a migration fails the test suite**.

</details>

<details>
<summary><b>🐳 Memory limits</b></summary>

There are no limits by default. To cap them, copy `docker-compose.override.yml.memlim`
to `docker-compose.override.yml` and tune the values.

</details>

---

## 🔐 Environment variables

You should generally only touch variables marked as **Required**.

| **Variable**                  | **Description**                                                                                                                             | **Required** | **Default**             |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|--------------|-------------------------|
| **Application**               |                                                                                                                                             |              |                         |
| `DEBUG`                       | Set debug mode for app. Debug allows insecure cookies. Set to one of `0, no, false` to disable; anything else enables it.                   | ✅           | `1`                     |
| `BACKEND_URL`                 | Deployed backend URL where clients make requests. Injected into the frontend build and used by the backend.                                 | ✅           | `http://localhost:3000` |
| `FRONTEND_URL`                | Deployed frontend URL used by the backend (e.g. for CORS / redirects).                                                                      | ✅           | `http://localhost:8080` |
| `BACKEND_PORT`                | Port on which backend runs.                                                                                                                 | ❌           | `3000`                  |
| `FRONTEND_PORT`               | Port on which frontend runs.                                                                                                                | ❌           | `8080`                  |
| `TEST_INSTANCE_MODE`          | Safety switch. When truthy (`true`, `yes`, `1`), destructive admin/user mutations return HTTP `450` instead of running.                       | ❌           | `false`                 |
| **Database (PostgreSQL)**     |                                                                                                                                             |              |                         |
| `POSTGRES_PASSWORD`           | Database password. Set to something secure; generate with `openssl rand -hex 48`.                                                           | ✅           |                         |
| `POSTGRES_USER`               | Database user.                                                                                                                              | ❌           | `divaldi`               |
| `POSTGRES_DB`                 | Database name.                                                                                                                              | ❌           | `divaldi`               |
| **Message broker (RabbitMQ)** |                                                                                                                                             |              |                         |
| `RABBITMQ_PASS`               | Password for RabbitMQ admin panel.                                                                                                          | ✅           |                         |
| `RABBITMQ_USER`               | User for RabbitMQ admin panel.                                                                                                              | ❌           | `admin`                 |
| `RABBITMQ_MANAGEMENT_PORT`    | Port on which RabbitMQ management interface runs.                                                                                           | ❌           | `15672`                 |
| **Task monitoring (TaskIQ)**  |                                                                                                                                             |              |                         |
| `TASKIQ_API_TOKEN`            | Secret for TaskIQ dashboard.                                                                                                                | ✅           |                         |
| `TASKIQ_DASHBOARD_PORT`       | Port on which TaskIQ dashboard runs.                                                                                                        | ❌           | `8000`                  |
| **GigaChat (Sber)**           |                                                                                                                                             |              |                         |
| `SBER_API_KEY`                | API key from [Sber developers](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token).                                  | ✅           | `mock`                  |
| `SBER_API_SCOPE`              | API scope from [Sber developers](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/post-token). One of: `PERS`, `B2B`, `CORP`. | ✅           | `PERS`                  |
| `GIGACHAT_MODEL`              | GigaChat model used. See [Sber models docs](https://developers.sber.ru/docs/ru/gigachat/models/main).                                       | ❌           | `GigaChat-3-Ultra`      |
| **Object storage (Garage)**   |                                                                                                                                             |              |                         |
| `S3_SECRET_KEY`               | Secret for the application's S3 key. ⚠️ Garage is exposed in production — a weak secret here can cause severe security issues. Generate with `openssl rand -hex 48`. | ✅           |                         |
| `S3_ACCESS_KEY`               | Key id imported by `garage-bootstrap`. Must be `GK` + 26 hex chars. ⚠️ Cannot be reused with a different secret, so rotating the secret needs a new id. | ❌           | `GKd1a1b2c3d4e5f60718293a4b5c6d` |
| `S3_PUBLIC_URL`               | Endpoint baked into presigned URLs, so it must be reachable from your browser. UPDATE IN PRODUCTION.                                         | ❌           | `http://localhost:3900` |
| `S3_PORT`                     | Host port the S3 API is published on.                                                                                                       | ❌           | `3900`                  |
| `S3_REGION`                   | Must match `s3_region` in `conf/garage.toml`.                                                                                                | ❌           | `garage`                |
| `GARAGE_RPC_SECRET`           | Garage's RPC secret. ⚠️ Must be **exactly 32 bytes of hex** — use `openssl rand -hex 32`, not `-hex 48`, or Garage refuses to start.         | ✅           |                         |
| `GARAGE_ADMIN_TOKEN`          | Garage's admin API token. Same 32-byte constraint as `GARAGE_RPC_SECRET`.                                                                    | ✅           |                         |
| `GARAGE_ADMIN_PORT`           | Host port for the Garage admin API.                                                                                                          | ❌           | `3903`                  |
| `S3_CORS_ORIGINS`             | Comma-separated browser origins allowed to call the buckets directly. The browser uses presigned URLs, so every upload is cross-origin, and Garage rejects unmatched preflights. UPDATE IN PRODUCTION. | ❌ | `*` |

> 🔐 **Redis, RabbitMQ, Garage and TaskIQ dashboard hostnames are hardcoded** in the
> backend (`redis://redis:6379`, `amqp://…@rabbitmq:5672/taskiq`, `http://garage:3900`,
> `http://taskiq_dashboard:8000`). That is another reason the app only runs in Compose.

### 🧠 Redis database designation

| DB | Use |
|---|---|
| `/0` | general — cache, locks, rate limits, statuses |
| `/1` | TaskIQ task results |

---

## 🛡️ Security notes

- 🔑 Passwords are hashed with **argon2-cffi**; sessions are opaque random tokens
  (`httponly`, `samesite=lax`, `secure` unless `DEBUG`, 7‑day lifetime) — **not JWT**.
- 📚 `/api/v1/docs`, `/redoc` and `openapi.json` are served **only when `DEBUG` is on**.
- 🚦 `TEST_INSTANCE_MODE` blocks destructive admin operations with a non‑standard
  **HTTP 450**.
- 🧨 The LLM system prompt contains an explicit **prompt‑injection guard**: the agent is
  told to treat instructions found inside uploaded files as an attack, warn the user,
  and refuse off‑topic conversation.
- 🔒 CORS origins come from `FRONTEND_URL` / `BACKEND_URL` and only fall back to `*` in debug.

---

## 👥 Code owners

| Path | Owner |
|---|---|
| `/backend/`, `/scripts/`, `/.github/`, `docker-compose.yaml`, `.env.example` | @yel-gar |
| `/frontend/` | @krchvl |
| `/processing/` | @AX-Ray |

See [`.github/CODEOWNERS`](.github/CODEOWNERS).

---

<details>
<summary><b>🎭 End-to-end tests (Playwright)</b></summary>

The e2e suite drives the real Compose stack — browser, FastAPI, TaskIQ workers,
PostgreSQL, Redis, Garage — with **`SBER_API_KEY=mock`**, so the whole request path is
exercised while the LLM itself is offline and free.

```bash
./e2e/scripts/run.sh
```

That starts the stack on port **18080** (so it never collides with a running dev
stack), seeds an `e2e` superuser, and runs the suite in `e2e/`.

To drive it interactively:

```bash
./e2e/scripts/setup.sh
cd e2e && npx playwright install chromium
npx playwright test --ui
```

</details>

---

## 🤖 For AI agents

Working on this repo? Read these first:

| File | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | mandatory harness — conventions, commands, rules |
| [`.context/DECISIONS.md`](.context/DECISIONS.md) | why the architecture is the way it is |
| [`.context/LESSONS.md`](.context/LESSONS.md) | traps that have already bitten us |
| [`.context/PROJECT_STATE.md`](.context/PROJECT_STATE.md) | where the project stands right now |
| [`.agents/skills/`](.agents/skills) | task‑specific playbooks |

---

<div align="center">

**Made with 🛠️ for the engineers of ООО НПО «Энергон»**

*Repository license: proprietary.*

</div>
