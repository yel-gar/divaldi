# Decisions

Architectural and design decisions, with the reasoning behind them.
Append new entries at the bottom, one `##` section per topic, chronological.

---

## Repository shape

- **`backend/`, `processing/`, `frontend/` are three independently installed units**:
  two Poetry projects (`backend/`, `processing/`) and one npm project (`frontend/`), plus
  a root `package.json` that exists *only* to provide `commitlint` to the `commit-msg`
  pre-commit hook. The root project has no runtime dependencies.
- **No monorepo tool** (no npm workspaces, Nx, Turborepo, Bazel, Pants). Docker Compose is
  the sole orchestrator. The project was simple enough that workspace tooling would cost
  more than it saves, and Compose was already the required run path.
- **`parser/` at the repo root is a dead leftover.** It contains only `__pycache__`
  directories from the pre-rename layout (py3.13 bytecode). The live code is in
  `processing/`, and `.pre-commit-config.yaml` plus CODEOWNERS already reference only
  `processing/`. Nothing imports it. (Recorded 2026-09 so nobody "fixes" the wrong
  directory.)

## Running the project

- **The full application runs only through Docker Compose** (`docker compose up -d --build`).
  This is not laziness, it is load-bearing:
  - Redis, RabbitMQ, MinIO and the TaskIQ dashboard hostnames are **hardcoded literals** in
    the backend (`redis://redis:6379`, `amqp://...@rabbitmq:5672/taskiq`,
    `http://minio:9000`, `http://taskiq_dashboard:8000`), matching Compose service names.
  - `providers/sber.py` loads `res/gigachat-ca.cer` by **relative path**, so the process
    must have CWD == `backend/`.
  - Service-to-service DNS only resolves inside the Compose network.
- **Tests, by contrast, run locally.** They use `testcontainers`, so they need a Docker
  *daemon* but not the full 13-service stack.
- **Two override files are shipped but gitignored** (`docker-compose.override.yml`):
  - `.dev` — bind mounts for hot reload, watchers with polling forced on, and publishes
    PostgreSQL on host port **5431** so Alembic can run from the host.
  - `.memlim` — per-service `mem_limit` values. No limits by default.

  Copying one to `docker-compose.override.yml` is an explicit, local developer decision.
  Never commit the result.

## Backend architecture

- **FastAPI with SQLAlchemy 2.0 async, not Django.** Chosen for native `async`/`await`
  end-to-end and a lighter schema layer; the team writes Pydantic directly rather than
  through an ORM.
- **No service / repository layer.** Routes query the database directly. There is no
  repository abstraction anywhere in the codebase. Adding one would be an unrequested
  architectural change, so ask first.
- **`app/deps.py` centralises every dependency behind `Annotated[...]` aliases**
  (`DbSession`, `CurrentUser`, `AdminUser`, `RedisSession`, `VerifiedMessageSession`,
  `VerifiedAttachmentId`, `S3PublicClient`, `S3InternalClient`). Call sites use the alias
  as the parameter type with **no `Depends(...)`**, which keeps route signatures readable
  and makes the dependency surface greppable from one file.
- **Rate limiting is a factory**: `user_rate_limiter(requests, per, key)` returns an async
  dependency that does Redis `INCR` + `EXPIRE` and raises `429` with `Retry-After`. Applied
  at router level via `dependencies=[...]`, not per-handler.
- **Session auth is an opaque cookie, not JWT.** `secrets.token_urlsafe(32)` stored in a
  `Session` row, delivered as an httpOnly `session_token` cookie with `samesite="lax"`,
  `secure=not DEBUG()`, 7-day lifetime. Argon2-cffi hashes passwords. Chosen because the
  token must be revocable server-side (an admin deletes a user, sessions cascade), which a
  self-contained JWT cannot offer without a deny-list.
- **`models/__init__.py` auto-imports every submodule** via `pkgutil.iter_modules` plus
  `importlib.import_module`. Alembic's `env.py` does `import app.models` once and is then
  guaranteed to see complete metadata without anyone maintaining a manual list.
- **Every cache key and every S3 key has a named builder function** in `cache.py` and
  `storage.py`. Inline f-string keys were rejected because key-format bugs are silent and
  ungreppable.
- **`app/main.py` also starts the TaskIQ broker in its lifespan**, so task declarations are
  registered when the API starts and not only when a worker does.

## Task queue

- **TaskIQ, not Celery.** Chosen for native async: the backend is async end-to-end, and
  Celery's synchronous workers plus its async Redis broker were a poor fit. The broker is
  **RabbitMQ** (`taskiq-aio-pika`, vhost `taskiq`) and results land in **Redis `/1`**.
- **Two queues, split by cause of slowness:**

  | Queue | Nature | Tasks |
  |---|---|---|
  | `default` | local / CPU-bound | `process_dxf`, `process_pdf`, `process_image`, `process_avatar`, `process_attachment`, `process_response`, `cleanup_old_results`, `cleanup_orphan_attachments`, `cleanup_stale_results`, `pdf_upload_cleanup`, `cleanup_expired_sessions` |
  | `network` | outbound GigaChat calls | `generate_chat_message`, `upload_pdf_image` |

  **Why:** the `network` queue is bounded by external API latency. Isolating it means a slow
  or rate-limited GigaChat cannot starve DXF parsing or the cleanup crons. Separate worker
  pools (`worker_default` x2, `worker_network` x2) allow independent scaling.
- **`redis://redis:6379/0` is general purpose** (cache, locks, rate limits, statuses);
  **`/1` is TaskIQ result storage only.** Confusing the two silently breaks result reads.
- **Blocking work is always offloaded via `await asyncio.to_thread(...)`**: PDF rasterising,
  DXF parsing, xlsx generation, Pillow resizing. The event loop must never be blocked.
- **Cron jobs use TaskIQ's `schedule=[{"interval": timedelta(...)}]`** with
  `LabelScheduleSource`, so the scheduler service is the only place periodic work is defined.
- **GigaChat PERS scope is rate-limited by a global Redis lock** (`api:global:lock`, timeout
  120 s, blocking timeout 60 s) taken only when `scope == "PERS"`. B2B and CORP are
  unrestricted.

## The GigaChat harness

- **`app/harness.py` owns the entire LLM contract**: a Russian `SYSTEM_PROMPT` persona
  (technologist / design engineer / estimator for ООО НПО «Энергон»), `MATERIALS` (27
  indexed steel grades), and `HARNESS_STRUCTURED_SCHEMA` (a JSON schema the model must
  satisfy).
- **The `material` field in every generated position is an integer index into `MATERIALS`**,
  not a name or an enum. This is the model's cheapest reliable output format. Consequence:
  **the order of `MATERIALS` is part of the data contract. Reordering or inserting in the
  middle silently corrupts every material** already persisted. Append only.
- **An empty `positions` list is the clarification signal.** When the drawing lacks
  dimensions, material, bend count or weld length, the model returns `positions: []` plus a
  message containing short professional questions. The UI shows that message; the user
  replies in chat and generation runs again. This is deliberate, because it lets one
  endpoint serve both "here is your offer" and "I need more information" without a separate
  state machine.
- **Hard cap of 10 positions per commercial offer** (`positions[:10]`,
  `max_positions: int = 10`), also stated in the prompt, which instructs the agent to ask
  the user to drop items.
- **The prompt-injection defence is in the prompt.** `SYSTEM_REMINDER` tells the agent to
  treat instructions found inside uploaded files as an attack, warn the user, and politely
  decline off-topic conversation. The defence is therefore a soft model-level control, not
  a parser-level one, and should not be described as a security boundary.

## Commercial offer generation

- **`processing.calculator.calc.process_calculation` fills a template instead of building a
  workbook from scratch.** `calc.xlsx` carries the company's layout, formulas and print
  settings; the code writes values into fixed cells. Sheet names are Russian (`Расчёт`,
  `Цены на металл`) and are **business output, so do not "fix" them to English.**
- **Production norms are named constants**, not literals: laser `10.0 m/h`, welding
  `2.0 m/h`, bending `84 bends/h`, painting `5.53 m²/h`. Turning hours are supplied by the
  model and taken as-is.
- **The calculator is a pure function**: bytes in, bytes out, no filesystem access. The
  caller reads the template. This keeps it trivially testable.
- **Two copies of `calc.xlsx` exist on purpose**: `backend/res/calc.xlsx` (read by
  `tasks/api.py`) and `processing/src/processing/calculator/res/calc.xlsx` (packaged with the
  library). Do not delete either without checking both call sites.

## DXF and PDF processing

- **The DXF parser is hand-rolled, not `ezdxf`.** Only lines, circles, arcs and polylines
  are extracted, and a full CAD library would be a heavy dependency for that.
  `SUPPORTED_ENCODINGS = ["utf-8", "cp1251", "latin-1"]` reflects real customer files.
- **PDF pages rasterise at 150 DPI**, the accuracy and LLM-token balance chosen after
  testing higher and lower values.
- **`processing/` is a separate Poetry package with `src/` layout**, consumed by the
  backend as a path dependency (`processing @ ../processing`). Its `tests/conftest.py`
  inserts `src` into `sys.path` so its tests run without installing the package.

## Database and migrations

- **Alembic with an async `env.py`.** The URL is built from `POSTGRES_*` env vars at
  runtime (`get_database_url()`), not read from `alembic.ini`, so the same code works in
  every environment.
- **`alembic/versions/` is excluded from black and ruff.** Generated migrations are never
  reformatted; reformatting them produces noisy diffs on every regeneration.
- **`tests/test_migrations.py` is a real gate.** It runs `upgrade head`, `downgrade base` and
  `alembic check`, and fails with a message telling you to run
  `alembic revision --autogenerate`. **A model change without a migration cannot merge.**
- **`backend/res/` and the CA certificate live outside the Python package** but are required
  at runtime, so the app must run with CWD == `backend/`.

## Frontend

- **Angular 21 standalone with signals, no NgRx or Redux.** Service-level `signal()` state
  plus `computed()` and `effect()` covers the actual complexity. Cross-component handoff
  uses tiny one-shot "state services" (`set()` / `consume()`), for example
  `InitialChatStateService` moving an order description from the create page into the chat.
- **List refresh is a version signal**, not an event bus: `ChatService.historyVersion =
  signal(0)` is bumped on mutation and read by the sidebar to re-fetch.
- **The API base URL is injected at image build time.** `environment.prod.ts` contains the
  placeholder `apiUrl: '__BACKEND_URL__/api/v1'`; `docker/rewrite-env.mjs` rewrites it from
  the `BACKEND_URL` build arg during `docker build`. In dev, the Angular dev server proxies
  `/api` to `localhost:3000` via `proxy.conf.json`. **Never hardcode a backend URL in a
  service.**
- **Polling, not WebSockets.** Chat results poll `GET /chats/{id}/result` every 2 s with a
  5 min timeout; upload status polls every 2 s up to 150 attempts. Simpler to reason about,
  survives the async task pipeline, and the 5-minute bound is acceptable for this workload.
- **Heavy preview dependencies are lazily `import()`ed**: `docx-preview`, `xlsx` and
  `hyperformula` load only when a user opens such a preview, keeping them out of the eager
  bundle.
- **`.xlsx` previews evaluate formulas across sheets with HyperFormula**, because the
  generated `kp.xlsx` relies on workbook formulas for pricing.
- **SCSS with BEM-style modifiers and CSS custom properties**, no Tailwind and no CSS
  modules. Theming is `html[data-theme='dark']` plus a `localStorage['theme']` key, so a
  colour must never be hardcoded in a component.
- **Component class names are inconsistent by history**: some end in `Component`
  (`CalculationChatComponent`), some do not (`HistoryPage`, `Layout`, `Sidebar`). Files are
  always `<kebab-name>.component.ts`. Follow the surrounding file, and prefer the
  `Component` suffix for new classes.

## Security and safety

- **`TEST_INSTANCE_MODE` returns HTTP 450** for destructive admin and user mutations. It is a
  non-standard status code, deliberately chosen so it cannot collide with a real response and
  cannot be dismissed as a typo. It guards password changes, user edits and deletions so a
  shared demo instance cannot be wrecked.
- **API docs are debug-only.** `docs_url`, `redoc_url` and `openapi_url` are `None` unless
  `DEBUG` is truthy, so the API surface is not publicly discoverable in production.
- **Cookies are `secure=not get_debug()`**: insecure in development so HTTP localhost works,
  secure everywhere else.
- **CORS origins come from `FRONTEND_URL` and `BACKEND_URL`**, falling back to `["*"]` only in
  debug. Both env vars are required in production or startup raises.
- **Argon2-cffi for password hashing**, never a fast hash.
- **Redis locks guard concurrency, not the database**: `chats:global` (one generation per
  user, 409), an attachment-upload confirmation lock, and a deletion-tombstone key so a
  result that lands after its session was deleted is discarded rather than resurrected.
- **MinIO buckets are private** (`mc anonymous set none`), with ILM rules expiring
  unprocessed avatars (1 day), attachments (7 days) and artifacts (1 day) as a backstop
  behind the scheduled cleanup tasks.

## Language version

- **Python 3.14 is the floor, not the ceiling of convenience.** `requires-python = ">=3.14,<4"`
  in both `backend/pyproject.toml` and `processing/pyproject.toml`, `.python-version` is `3.14`,
  both Dockerfiles use `python:3.14-alpine`, and CI sets up Python 3.14. Black and ruff are
  pinned to `target-version = ["py314"]`.
- **This means 3.14-only syntax is expected and correct.** Notably PEP 758, which allows
  `except ValueError, TypeError:` without parentheses. Black with `target-version = "py314"`
  *emits* that form, so adding parentheses by hand would fight the formatter. Treat brace-less
  multi-type `except` as idiomatic here, not as a Python 2 leftover.
- **The same applies to the frontend**, which targets Angular 21 and ES2022 with
  `strictTemplates` enabled. Modern-only constructs are expected, not suspicious.

## Tooling

- **One `.pre-commit-config.yaml` for the whole repo**, using the Poetry wrapper scripts
  `scripts/precommit-black.py` and `scripts/precommit-ruff.py`. They strip the directory
  prefix and re-invoke the tool inside that Poetry project, because Poetry 2.x cannot easily
  run per-project commands and pre-commit `language: system` hooks need a single entry point.
- **Import sorting is ruff's `I` rule, not isort.** There is no standalone isort, no flake8
  and no mypy.
- **Python line length is 120; Prettier `printWidth` is 100, with single quotes and no
  trailing comma.** Match the surrounding code.
- **Conventional Commits are enforced** by `commitlint.config.js` through the `commit-msg`
  hook. Branch prefixes in use: `jut/`, `feat/`, `fix/`, `docs/`, `feature/`.
- **`pre-commit.yml` CI only runs the generic hooks** (yaml, json, toml, eof, whitespace).
  Real lint and test coverage comes from `backend-ci.yml` and `processing-ci.yml`.
  `frontend-ci.yml` runs `ng lint` and `ng build` but **not** `ng test`.
- **Hooks never fail the commit**: `scripts/precommit-*.py` pass `check=False`, relying on
  pre-commit's own re-staged-file detection. Run `black --check` and `ruff check` explicitly
  before claiming work is clean.

## Agent skills

- **`.agents/skills/` mixes two origins on purpose.** Six skills (`sqlalchemy-async`,
  `taskiq-workers`, `python-testing`, `frontend-file-preview`, `docker-compose`,
  `conventional-commits`) are project-specific and were written from this repository's
  source. Two (`fastapi` from `samuelpkg/skills`, MIT; `angular` from `xfstudio/skills`) are
  third-party and installed with the standard skill installer.
- **Why install anything:** a hand-written flat `SKILL.md` cannot carry genuine framework
  depth. The FastAPI skill is 497 lines plus a `references/patterns.md`, and the Angular one
  is 821 lines covering signals, standalone components and change detection. Those are not
  reproducible from memory, and guessing at framework best practices is exactly where an
  agent invents APIs.
- **Why not install everything:** generic framework guides assume a different stack. The
  Angular skill spends significant space on SSR, hydration and zoneless change detection,
  none of which this app uses. The 37-line and 28-line "python testing" candidates were
  too thin to be worth installing.
- **Both official registries were checked and came up empty for this stack.**
  `openai/skills` (the `openai/skills` curated list) has no FastAPI, Angular, Docker or
  Python-testing skill, and `anthropics/skills` has no framework skills either. The
  community collections `samuelpkg/skills`, `xfstudio/skills` and `github/awesome-copilot`
  do.
- **Every third-party skill carries a `references/divaldi-overrides.md`** listing exactly
  where the generic guide conflicts with this project, plus a pointer block at the top of
  the `SKILL.md` itself. **Precedence: `AGENTS.md` and `DECISIONS.md` > the overrides file >
  the vendor `SKILL.md` > the agent's own priors.** Without the top-of-file pointer the
  overrides would never be read, since an agent loads `SKILL.md` and stops.
- **Known provenance gap:** a richer FastAPI skill exists in a sibling repository
  (`portals-be/.agents/skills/fastapi`, 321 lines plus six reference files). It could not be
  traced to any public repo despite searching for its distinctive `Asyncer`, `SQLModel`,
  `ty` and `uv` vocabulary. It was deliberately **not** copied, because it recommends
  SQLModel over SQLAlchemy and `uv` over Poetry, both of which contradict this project.

## Backend test coverage

- **Coverage is measured and reported, not enforced.** `pytest-cov` was added to the
  `backend` `dev` group via `poetry add --group dev pytest-cov` (pulls in `coverage` 7.16.2
  and `pytest-cov` 7.1.0). Current baseline is **49.55%** with branch coverage on, across
  1356 statements / 204 branches from 33 passing tests.
- **The threshold lives in exactly one place: `fail_under` in `backend/pyproject.toml`.**
  pytest-cov reads it and turns the run's exit code on it. This was verified in both
  directions: at `fail_under = 90` the run exits 1 with `Required test coverage of 90.0% not
  reached`, and at `0` it exits 0. Neither the pre-push hook nor the CI workflow hardcodes a
  percentage, so **enabling the gate later is a one-line change** with no risk of the three
  disagreeing.
- **The hook is `pre-push`, not `pre-commit`, for two reasons:** it needs the whole suite
  plus a live Docker daemon for testcontainers, which is too slow and too fragile to run on
  every save; and coverage is a reporting signal, not a formatting fix.
- **Branch coverage is on** (`branch = true`) and `source = ["app"]`. Branch data matters
  here because the guard clauses in `deps.py` and the two chat flows are almost entirely
  branch-shaped, and statement-only coverage flatters them.
- **Why 90% is not yet the gate:** the untested areas are not incidental. `routes/chat.py`
  is 24%, `tasks/files.py` is 15%, `tasks/api.py` is 17%, `routes/users.py` is 34%, and
  `providers/sber.py` is 28%. These are the riskiest parts of the codebase, so a 90% gate
  today would either block all work or push people to write shallow tests that touch lines
  without exercising behaviour. The gate becomes meaningful once those are genuinely covered.
- **Coverage artifacts are gitignored** (`.coverage*`, `coverage.json`, `coverage.xml`,
  `htmlcov/`), because the JSON report is written into `backend/` by the CI step and would
  otherwise show up as an untracked file on every local run.

## Documentation

- **`README.md` is English, `README.ru.md` is Russian**, cross-linked in the header. The
  product UI, LLM prompt and Excel output are all Russian; the code, comments and docs are
  English. Keep new documentation in English unless it duplicates README content.
- **`AGENTS.md` documents *how*; `.context/` documents *why*.** Keeping them separate stops
  the harness from bloating with rationale and the context files from going stale.
