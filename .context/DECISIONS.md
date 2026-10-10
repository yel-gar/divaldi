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
  - Redis, RabbitMQ, Garage and the TaskIQ dashboard hostnames are **hardcoded literals** in
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

## Provider history ends at the last user message

- **`generate_chat_message` cuts the stored `ChatMessage` history right after the last
  `UserRole.USER` row** (`_history_up_to_last_user_message`) before building the
  `list[Message]` it hands to the provider. Added 2026-10-03 for issue #59.
- **Why:** `process_response` persists the assistant's reply as a `ChatMessage` with
  `role=ASSISTANT`, so after an error that row is still the last one in the session. A
  completion request must end with something the user said; ending on the model's own
  previous answer makes the provider continue that message instead of replying. Issue #59
  reported exactly this on retry.
- **The trim lives in the worker, not in `retry_send`,** because both `send_message` and
  `retry_send` enqueue the same `generate_chat_message` task with the same session id and the
  task has no way to know which route triggered it. A fix in the route would leave the worker
  still able to send a trailing assistant turn.
- **Assistant turns before the last user message are kept.** The harness prompt tells the
  model what to do with offers it already produced (`gen_kp` should be `false` unless the user
  asked for a recalculation), so the model's own earlier output is context it needs. Trimming
  the whole history would break that contract, so only the trailing turns go.
- **A history with no user message is an error**, reported through the existing
  `Invalid message session: no messages to send` result. It used to be sent to the provider
  as-is.

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

## Frontend test coverage

- **Coverage is measured and reported, not enforced**, mirroring the backend decision.
  Baseline is **67.6% statements, 68.71% branches, 62.81% functions** over 2022 statements,
  measured with the full 154-test suite green.
- **The coverage engine is `@vitest/coverage-v8`, but the config is not a `vitest.config.ts`.**
  This project has no Vitest config file, and adding one would be wrong: the
  `@angular/build:unit-test` builder owns the Vitest configuration, exposes native
  `coverage`, `coverageReporters`, `coverageInclude`, `coverageExclude`, `coverageThresholds`
  and `coverageWatermarks` options, and **hard-requires `@vitest/coverage-v8`** when coverage
  is enabled (`runners/vitest/index.js`). Configuration therefore lives in the `test` target
  of `frontend/angular.json`.
- **The provider must be version-matched to the installed Vitest.** The project is on Vitest
  `4.1.11`, so the dependency is pinned to `@vitest/coverage-v8@^4.1.11`. A bare
  `npm install -D @vitest/coverage-v8` resolves to the v5 line, which is a major-version
  mismatch against the v4 runner and would break at runtime.
- **`coverageInclude` is set on purpose even though it lowers the number.** Without it, V8
  reports only files that were actually loaded by a test, which inflates the figure by
  omitting untouched files entirely. With `src/app/**/*.ts` and `src/environments/**/*.ts`
  included, never-imported files count as 0%. The same run reads 78.15% with implicit
  include-all and 67.6% with the explicit honest include; the second is the real number.
- **The missing-storage problem is fixed in test infrastructure, never in application code.**
  `src/test-setup.ts`, registered through the builder's `setupFiles` option, installs an
  in-memory `localStorage` and `sessionStorage`, because the jsdom test environment provides
  neither while `ThemeService` reads `localStorage` in a field initializer. Guarding
  `ThemeService` with a `typeof localStorage === 'undefined'` check was rejected: the
  application is not broken, `localStorage` always exists in a browser, and such a guard
  would be permanent defensive code on the theme hot path. The shim installs only when
  storage is missing, so it self-disables if a future Angular or Vitest release supplies it.
- **The threshold lives in one place: `coverageThresholds` on the `test` target in
  `frontend/angular.json`.** The builder enforces it and exits non-zero, so no percentage is
  hardcoded in the hook or the workflow. Verified to bite: at `statements: 90` the run exits
  0, at `95` it exits 1. Reporters are `text-summary`, `json-summary` and `html`; output
  nests under `frontend/coverage/frontend/`.
- **The gate was raised from 67.6% to 90.24% on 2026-09-29** by adding specs for the
  previously untested pages and services: login (0% to 100%), order-create (0% to 100%),
  the upload and download services, the error interceptor, the ControlValueAccessor
  controls (checkbox, toggle, input, select), the notification components, layout, and the
  chat view's send / poll / retry / delete behaviour. The suite went from 154 to 305 tests.
- **Testing the chat view's polling needed three workarounds**, recorded because none is
  obvious. `window.matchMedia` and `Element.prototype.scrollTo` must both be stubbed: jsdom
  implements neither and the component's `afterRenderEffect` calls both. The loop must be
  driven with `vi.useFakeTimers()` and `advanceTimersByTimeAsync`. Teardown must
  `fixture.destroy()` before `TestBed.resetTestingModule()`, because `onDestroy` is what
  clears the interval; skipping that leaves hundreds of unconsumed requests, and flushing
  them instead throws `Cannot flush a cancelled request`.
- **V8 coverage requires Chromium, which is satisfied here only because tests run in jsdom.**
  If the project ever switches to `@vitest/browser-*` with a non-Chromium browser, coverage
  will hard-fail with a message about unsupported browsers. This is a constraint to remember
  before adopting a browser runner.

## End-to-end tests

- **The e2e suite drives the real Compose stack with `SBER_API_KEY=mock`.** Playwright in
  `e2e/` runs against a full deployment: the Angular build behind nginx, FastAPI, both
  TaskIQ worker pools, PostgreSQL, Redis and MinIO. Only the LLM is replaced, by the same
  `MockProvider` the unit suite uses, so a request still walks the router, the worker, the
  spreadsheet calculator and a real S3 round trip. This is what makes the suite trustworthy:
  it fails if any of that pipeline breaks.
- **The stack runs on a separate port (18080) and a separate override file**
  (`docker-compose.override.yml.e2e`), copied to the gitignored
  `docker-compose.override.yml` by `e2e/scripts/setup.sh`. The previous override is backed
  up so a developer's dev stack is not silently lost. Only the frontend port and the
  provider env vars are changed; every real service is still the real service.
- **Tests run serially (`workers: 1`) and the `ratelimit:*` counters are cleared before
  each test.** Both are load-bearing, and the reason is non-obvious: `app/routes/chat.py`
  limits chat creation *and* message sending to 5 per minute per user
  (`chats:post`). A single e2e run creates several chats as one shared user, so the suite
  trips its own limiter. The symptom is misleading — the chat is created with 202 but the
  send is rejected with 429, so the create page never navigates and the test fails with
  "expected URL /chats/.+" rather than anything mentioning a rate limit. This cost the most
  debugging time in the e2e work.
- **The mock provider names every chat identically** (`Расчёт КП (mock)`), because
  `chat_name` is part of the generated payload. E2E specs must therefore identify a session
  by the id in the URL, not by its visible title.
- **Playwright runs one worker in the harness and needs its own npm project.** The global
  npm on this machine breaks on this repository (arborist crash, then `EALLOWREMOTE` on the
  remote-tarball `xlsx` dependency), so `e2e/scripts/run.sh` installs with the pinned
  `npm@10.9.2`.
- **The native `window.confirm` in the admin delete flow is handled with a Playwright
  `dialog` handler**, not a DOM locator, because it is not a DOM element.

## Backend test coverage

- **Coverage is measured and enforced at 90%.** `pytest-cov` is a `dev` dependency added
  via `poetry add --group dev pytest-cov`. Current state is **98.79% statements** with
  branch coverage on, across 1437 statements / 216 branches from 308 passing tests.
- **The threshold lives in exactly one place: `fail_under` in `backend/pyproject.toml`.**
  pytest-cov reads it and turns the run's exit code on it. Verified in both directions: at
  `90` the run exits 0, at `99` it exits 1. Neither the pre-push hook nor the CI workflow
  hardcodes a percentage, so the three cannot drift apart.
- **The gate was unreachable before 2026-09-29, and the way it was reached is the point.**
  Coverage went from 49.55% to 98.79% by testing exactly the areas that were untested,
  which were also the riskiest: the chat routes (24% to 99%), `tasks/files.py` (15% to
  100%), `tasks/api.py` (17% to 100%), the users routes (34% to 100%) and the GigaChat
  provider (28% to 100%).
- **Test dependencies are real wherever Compose provides a service.** PostgreSQL 18, Redis
  8 and MinIO all run as testcontainers, so the suites exercise the actual SQL, the actual
  Redis semantics (locks, counters, `getdel`) and the actual S3 API. Only two things are
  faked: the LLM, and the outbound HTTP inside `SberProvider` via `httpx.MockTransport`.
- **Worker tests cannot use the request-scoped `db_session` fixture.** Task bodies open
  their own session through `app.tasks.conf.broker.tsq_db`, so rows left pending in
  `db_session`'s rolled-back transaction are invisible to them. Such tests commit through
  the engine directly and clean up in teardown.
- **The hook is `pre-push`, not `pre-commit`,** because it needs the whole suite plus a
  live Docker daemon for testcontainers, which is too slow and too fragile per save.
- **Coverage artifacts are gitignored** (`.coverage*`, `coverage.json`, `coverage.xml`,
  `htmlcov/`), since the JSON report is written into `backend/` on every run.

## Offline provider and live tests

- **`SBER_API_KEY=mock` selects `app/providers/mock.py`**, a full `AIClient` implementation
  that performs no network I/O. Chosen over mocking at the call site because it is a
  production code path: the same class runs in the compose stack, in end-to-end tests and
  in the unit suite, so the substitution is exercised rather than assumed.
- **The mock is deterministic by design.** Geometry values derive from a SHA-256 hash of
  the conversation, so the same input always produces the same numbers. Non-determinism
  would make the generated spreadsheet and any end-to-end assertion drift between runs.
- **Its behaviour is switched by `MOCK_PROVIDER_MODE`** (`kp`, `clarify`, `empty`, `error`),
  so one deployment can exercise the happy path, the clarification loop and both error
  branches of the worker. The mode is read per call rather than at construction, so tests
  can flip it with `monkeypatch.setenv`.
- **Tests that hit the real GigaChat are marked `live` and deselected by default** through
  `addopts = "-m 'not live'"`, because they cost money per call. They are opted into with
  `pytest -m live` and a real key. Every other provider test uses `httpx.MockTransport`, so
  nothing reaches the network by accident.

## Processing test coverage

- **`fail_under = 90` in `processing/pyproject.toml` is the gate**, single-sourced the same
  way the backend's is. The pre-push hook and `processing-coverage.yml` run
  `pytest --cov` and name no percentage, so they cannot disagree with the config. Verified
  to bite: at 90 the run exits 0, at 99 it exits 1. Coverage reads **95.73%** with branch
  coverage across 85 tests, up from 86% without branch coverage across 50.
- **The gap was concentrated in `get_measurements_data`, not in `parse_dxf`.** Both
  `extract_measurements` and `get_measurements_data` walk the same entity list but build
  different results, so each has its own ARC and LWPOLYLINE branches. Tests for the string
  renderer left the dictionary builder's equivalents entirely uncovered, which is why the
  file read 77% while its public API looked well tested.
- **15 statements in `dxf_parser.py` are provably unreachable and were left uncovered.**
  Both claims were verified by script rather than by inspection:
  - `SUPPORTED_ENCODINGS` ends in `latin-1`, which maps every byte value, so the
    `UnicodeDecodeError` fallback after the decode loop can never be reached.
  - `_get_float` catches `ValueError` and `TypeError` itself and returns `0.0`, and
    `math.hypot` on floats does not raise, so the six per-entity
    `except ValueError, TypeError: continue` blocks can never be entered.
  Removing the defensive handlers would reach 100% but makes the helpers fragile if a
  future change lets `_get_float` raise. The number is documented in `pyproject.toml` so a
  future agent does not write tests chasing it.
- **A PDF that opens but reports zero pages is unreachable through PyMuPDF**, which rejects
  an empty stream earlier. That path is covered by substituting the module's `fitz`
  attribute with a stand-in document, which is the only honest way to reach it.

## Commit message length

- **Commit messages are capped at roughly 15 lines, subject plus body.** This was added
  after observing the opposite: the three large commits in this branch each ran to twenty-odd
  lines of body, and most of it re-narrated the diff or recounted the agent's own reasoning.
  `git log` is scanned, not read, so a long message costs more than it gives.
- **The rule is stated as what to leave out, not just a limit**, because a line count alone
  still permits a 15-line re-narration. A body earns its place only for a non-obvious
  constraint, a deliberate omission, or a gotcha not already in `LESSONS.md`; anything longer
  belongs in the pull request or in `.context/`. The `conventional-commits` skill carries a
  worked too-long/too-short example pair, since a rule with an example is followed and a bare
  limit is not.

## Object storage: MinIO to Garage

- **Storage is Garage, migrated 2026-10-03, because MinIO became unpullable.** MinIO was
  deleted from Docker Hub (its Hub API 404s) and then locked down on quay.io, where manifests,
  the tag list and the repo API all return 401 for every tag including `latest`. A control
  check against `quay.io/prometheus/busybox` and `quay.io/coreos/etcd` returned 200 from the
  same code path, so this was upstream action rather than a local network problem.
  `mirror.gcr.io` mirrors Docker Hub only and had nothing either. Backend CI broke because
  the testcontainer could no longer pull the image.
- **Garage was chosen because it is a real S3 implementation from a project that still
  publishes images**, not because it is a drop-in. Verified on `dxflrs/garage:v2.4.1`: every
  call the backend makes works, `generate_presigned_post` works with the exact argument shape
  both upload routes use, and `PutBucketLifecycleConfiguration` accepts the existing rule
  files verbatim. `mc` was unavailable too, since the MinIO client image lives on the same
  dead quay.io account.
- **The S3 wire protocol is unchanged, so `app/` barely moved.** Only `storage.py` changed,
  and only to rename `MINIO_*` to `S3_*` and stop hardcoding the internal endpoint. The
  migration cost was almost entirely Compose plumbing, which is the argument for preferring a
  protocol-compatible store over a feature-compatible one.
- **Credentials are pinned in the environment rather than captured at runtime.**
  `garage key create` mints a random secret that can never be displayed again, so handing it
  to the backend would need a shared volume and a startup race. `garage key import` accepts an
  explicit key id and secret, which lets `S3_ACCESS_KEY` and `S3_SECRET_KEY` stay static. The
  cost is that Garage refuses to reuse a key id with a different secret, so **rotating the
  secret requires a new key id**; `conf/garage-init.sh` verifies the stored secret matches and
  fails loudly rather than leaving the backend unable to authenticate.
- **Bootstrap is two services, not one.** `garage-bootstrap` runs the CLI for what only the
  CLI can do — key import, bucket creation, key grants — because an S3 `CreateBucket` needs
  permissions a freshly imported key does not yet have. `garage-config` runs the backend
  image to apply expiration and CORS rules, because there is no CLI command for either and the
  APIs need XML, which botocore generates from the JSON rule files we already keep. Merging
  them into one image would have meant either a Python dependency in the bootstrap image or
  hand-maintained XML.
- **Bucket CORS is configured, because Garage has no default and a browser always preflights**
  (2026-10-09). `handle_options_for_bucket` matches the `Origin`, the requested method and every
  requested header against the bucket's `cors_config`, and answers
  `403 This CORS request is not allowed.` when there is none or nothing matches. Since uploads
  and downloads go through presigned URLs, that broke every browser-side transfer. MinIO shipped
  a permissive default (`MINIO_API_CORS_ALLOW_ORIGIN=*`), which is why the migration looked
  clean in tests — nothing in the backend exercises a preflight. `garage bucket` has no `cors`
  subcommand, so `apply_s3_config.py` sets it over the S3 API next to the lifecycle rules;
  `S3_CORS_ORIGINS` carries the origins, separate from `get_origins()`, which governs the API and
  not the store. Allowed methods are the ones a presigned URL can produce (POST, GET, HEAD, PUT)
  and allowed headers are `*`, because the fields of a presigned POST form are not known when the
  rule is written. **A test asserting a preflight would return 200 belongs with the store, not
  with the backend suite.**
- **`S3_CORS_ORIGINS` defaults to `*`, and that is not a shortcut.** A wildcard origin cannot be
  combined with credentials, and these requests carry their authorisation in the presigned query
  string rather than in a cookie, so no bucket is readable by origin alone. It is documented as a
  production override rather than defaulting to the frontend URL, because the e2e stack moves the
  frontend to 18080 and a dev stack may use any port; listing origins would mean maintaining the
  same list in `.env`, the e2e workflow and any developer override.
- **The lifecycle rules stay in JSON and stay unchanged.** Garage implements only
  `Expiration` and `AbortIncompleteMultipartUpload`, which covers all three of our rules.
  Converting them to XML would make them harder to review for no gain.
- **`--single-node` is used in Compose**, which assigns the cluster layout at startup and
  removes the layout bootstrap entirely. `conf/garage.toml` records that a real deployment
  should drop the flag and raise `replication_factor` to 3 across 3+ nodes.
- **The registry risk is reduced, not solved.** `dxflrs/garage` is one small project on one
  registry and could in principle disappear the same way. The durable fix is to mirror the
  image into an organisation-controlled registry and pin by digest. That was not done here
  because it needs write access to a registry the project does not own yet.

## Documentation

- **`README.md` is English, `README.ru.md` is Russian**, cross-linked in the header. The
  product UI, LLM prompt and Excel output are all Russian; the code, comments and docs are
  English. Keep new documentation in English unless it duplicates README content.
- **`AGENTS.md` documents *how*; `.context/` documents *why*.** Keeping them separate stops
  the harness from bloating with rationale and the context files from going stale.
- **The `responses={...}` convention is now repo-wide, not chat-only.** `AGENTS.md` still
  describes it as a chat-route pattern; as of 2026-10-03 (issue #44) every route in
  `auth.py`, `users.py` and `admin.py` follows it too. Two rules that came out of doing it:
  an entry that cannot be traced to a real `raise` or dependency is omitted rather than
  guessed, and the non-standard **450** from `TEST_INSTANCE_MODE` is documented explicitly,
  because it reads as a typo to anyone seeing the OpenAPI schema without the context above.
  `422` is deliberately left out of every dict, since FastAPI adds it for request validation.
- **`responses=` descriptions are inlined, not shared via constants.** Repeating the 401
  string is deliberate: each dict is read on its own in the generated schema, and a constant
  would hide which conditions a given route actually documents.

## Attachment filename filtering (2026-10-03)

- **The upload route validates the filename, not just the content type.** `POST
  /chats/{id}/uploads` checked `content_type` and `file_size` but accepted any `filename`, and
  that string is copied into the S3 key by `get_s3_attachment_key`, stored in
  `attachments.name`, handed back to the browser by the download route, and passed to
  GigaChat as the upload filename. Two rules close it, both as 400s beside the existing ones
  rather than as schema validation, so the failure stays a `HTTPException` the `responses`
  dict documents: the name must be a bare filename (no `/` or `\`, no control characters,
  which covers the NUL byte asyncpg refuses to write), and its suffix must be in
  `ALLOWED_CHAT_FILE_EXTENSIONS`.
- **The allowlist mirrors the frontend's `ACCEPTED_EXTENSIONS`, not a new policy.** `.pdf`,
  `.dxf`, `.png`, `.jpg`, `.jpeg` are exactly what `drag-n-drop` offers, so nothing the UI can
  produce is refused. The value of the rule is that the extension in the stored key cannot be
  `.sh` or `.html` while the object is declared `application/pdf`, which is what
  `process_attachment` dispatches on. Extensions are compared case-insensitively because
  `get_s3_attachment_key` lowercases the suffix it writes.
- **The extension is *not* paired with the content type.** Enforcing `".pdf" implies
  application/pdf` would be a stronger guarantee, but nothing in the pipeline reads the
  extension — the Content-Type on the stored object is what selects the processor — so the
  pairing would add a rule with no consumer behind it. Deliberately left out; revisit if a
  consumer ever starts trusting the suffix.

## Chat list pagination (2026-10-03, issue #51)

- **`GET /chats/` returns an envelope, not a bare list.** The shape is
  `UserChatPageSchema` = `{items, total, page, items_per_page}`, with query parameters
  `page` (zero-based, `ge=0`), `items_per_page` (`ge=1, le=100`, default 20), `sort`
  (`date` or `number`) and `order` (`asc` or `desc`). **This is a breaking change** for
  every consumer, which is why all of them moved in the same commit: `ChatService.list()`
  and its two callers.
- **`total` is computed with a second query rather than by fetching `items_per_page + 1`
  rows.** The extra row is the cheaper trick for a "has more" flag, but a page counter
  needs the real count, and the count query is a `DISTINCT` over the same predicate the
  page query uses, so the two cannot disagree.
- **Sorting moved to the server, and that was forced by pagination, not chosen for taste.**
  The history page used to sort the whole array client-side, which is impossible once only
  one page is in memory: page 2 of "newest first" is not page 2 of "oldest first". A
  paginated list with client-side sorting is worse than either, because the visible order
  silently changes meaning between pages.
- **The ordering has a secondary key.** `sort=date` orders by `(timestamp, session_id)` and
  `sort=number` by `(session_id, timestamp)`. Without the tiebreaker two sessions whose
  last message shares a timestamp could swap between requests, and with `LIMIT`/`OFFSET`
  that means one session appears on two pages and another on none.
- **The sidebar asks for a fixed 10-item preview and the history page pages through the
  rest.** The sidebar column is a shortcut to recent work, not a second copy of the list,
  and it already had no way to show more than a screenful. It is a separate constant from
  `CHATS_PAGE_SIZE` precisely because it is a different question, not a different style of
  the same one.
- **`messages` pagination was deliberately left out of this issue.** `GET /chats/{id}`
  returns one append-only transcript, and the chat view already merges it with a
  2-second poll and with locally pending messages carrying negative ids
  (`mergeApiMessages`). Paging that list correctly needs either a cursor rather than an
  offset, or an "older messages" control that preserves scroll position; doing it as an
  offset alongside the existing merge would have been a second, subtler bug. The route is
  unchanged and still returns every message. Revisit as its own change.

## Attachment listing and deletion (2026-10-03, issue #47)

- **One listing endpoint reports upload state; no new state is invented.** `GET
  /chats/{id}/attachments` returns every `Attachment` row of the session, with the Redis
  `attachment:{id}:status` value in `status`. The statuses `upload_file`,
  `pdf_upload_cleanup` and `_redis_error` already write (`uploading`, `processing`,
  `completed`, `error`) are the whole vocabulary; a second, parallel notion of "what is
  uploading" would have to be kept in step with the workers for no gain.
- **`status` and `ready` are both in the response because they expire independently.** The
  Redis key has a 600 s TTL while the row does not, so a file can be uploaded, complete and
  still read as `unknown` later. `status` answers "what is happening now", `ready` answers
  "may this be sent", and the client falls back to `ready` when the status is unknown.
  An unrecognised Redis value maps to `unknown` instead of reaching the response schema,
  which would raise on a `Literal` it does not expect and turn a cache oddity into a 500.
- **The listing is not filtered to unattached files.** `chat_message_id` is returned instead,
  so one request can drive a whole file view; the frontend filters. Server-side filtering
  would make the endpoint useless for showing what a session holds.
- **Deleting clears the ownership cache entry, which is what makes a repeat delete fail.**
  `verify_attachment_id` caches `attachment:ownership:{session}:{id}` for 10 minutes, so
  deleting the row alone would leave the dependency answering for an id that no longer
  exists, and `GET .../attachments/{id}` would serve a presigned URL for a deleted file. The
  handler therefore drops the status, URL, ownership and PDF-sync keys together with the row.
- **Storage deletion is best-effort and never blocks the row deletion.** `_s3_try_delete`
  from `app.tasks.files` logs and swallows a failure, which is what a delete wants: an object
  that already expired must not leave the row behind. The 7-day lifecycle rule on the
  `attachments/` prefix is the backstop for anything the best-effort path misses.
- **The delete removes the PDF page artifacts too.** A PDF attachment owns
  `ProcessingResultUploadable` rows, one per rasterised page, each pointing at its own object
  under `artifacts/pdf/`. Deleting only `attachment.s3_key` would leave one object per page.
- **The delete reuses `_s3_try_delete` across modules rather than growing a second copy.**
  `app.routes.chat` imports it from `app.tasks.files` alongside `process_attachment`. The
  underscore says "not part of that module's API", which is true and is the trade being made:
  duplicating the helper would let the two drift on what a delete does about a failure.
- **Deleting the generated offer also drops the generation result, and that is intended.**
  `Attachment.generation_result` carries `cascade="all"`, so deleting the attachment the agent
  produced takes the `GenerationResult` row with it. The alternative is a result that survives
  and points at a file the download route answers 404 for. `GET /chats/{id}/result` then reports
  `result: null`, which the frontend already handles.
- **Known limitation: deleting an attachment mid-processing races the worker.** A worker that
  already read the row can still write a status key for the deleted id. Nothing serves it,
  because the ownership entry is gone and `verify_attachment_id` refuses the id, and the key
  expires with its TTL. Making it airtight would mean a tombstone the workers consult; not
  worth it for a file the user has just removed.
## Admin system prompt editing (2026-10-06)

The admin settings page edits the system prompt over `GET/PUT /api/v1/admin/system-prompt`
with body `{ "prompt": string }`. The frontend contract is already implemented
(`AdminSettingsService`, `AdminSettingsPage`); the backend route is still pending — the
prompt currently lives as the `SYSTEM_PROMPT` constant in `app/harness.py`. When adding the
endpoint, return the same schema so the page keeps working unchanged.

- **The contract reuses the admin router** (`prefix="/admin"`, `require_admin` dependency) so
  authorization is a one-line `include_router` away and cannot leak to non-admins.
- **The frontend disables the editor until the prompt loads** instead of showing a blank
  editable field: saving a blank over an unknown prompt would silently wipe the real one.
## Admin machine parameters editing (2026-10-09)

The settings page edits production norms over `GET/PUT /api/v1/admin/parameters` with the
`Parameters` shape from `processing/calculator/calc.py`. Same split as the system prompt:
the frontend contract is implemented (`AdminSettingsService`, second card on
`AdminSettingsPage`), the backend route is still pending.

- **`max_positions` is immutable and not rendered at all**, so the PUT body
  (`MachineParametersPayload`) holds only the four editable rates. If the backend ever accepts
  it, the contract still matches — the page just never sends it.
- **The form stays disabled until the parameters load**, same rule as the prompt editor:
  saving defaults over unknown values would silently reset real norms.
- **Rates must be positive numbers** (`required` + numeric pattern + `min(0.01)`); the form
  uses `type="number"` inputs with dot decimals, converted with `Number()` on save.
## Users form as a slide-over panel (2026-10-09)

The "Новый пользователь" / "Редактирование пользователя" card on the admin users page is no
longer a second grid column: it is an `<aside>` that slides in over a host grid animating
`1fr 0fr` to `1.5fr 1fr`, the same mechanism as the "Результаты расчёта" panel in the agent
chat (`isResultsOpen`, host class binding, opacity/visibility staging, reduced-motion opt-out).

- **A slide-over, not a modal**, because the table stays visible and interactive behind the
  form, and no overlay/focus-trap machinery is needed — the pattern already exists in the
  codebase, so it is copied rather than reinvented.
- **The panel closes on save, cancel and the X button**, all through `closeForm()` (which
  resets the form). `selectUser()`/`resetForm()` stay pure form logic so existing callers and
  specs keep working; `openCreate()`/`openEdit()` only add the open step.
- **The open panel track carries a length floor so it fits its content.** A bare `1fr`
  track is `minmax(auto, 1fr)`, and the aside's `min-width: 0` (needed for the `0fr` collapse)
  lets the track shrink past the 32px panel titles — "Редактирование пользователя" spilled
  ~176px past the card at 1200px viewport, and the chat's "Результаты расчёта" wrapped to two
  lines for the same reason. The floor makes the table/chat side absorb the squeeze (both
  scroll internally); verified by Playwright measurements on the dev stack, not by eye.
- **The floor is a length inside `minmax()`, not `max-content`.** Applied instantly,
  `min-width: max-content` kills the slide, and animating it needs `interpolate-size`, which
  Safari lacks — the panel popped to full width there. `minmax(0, 1fr) minmax(0px, 0fr)` opening
  to `minmax(0, 1.5fr) minmax(600px, 1fr)` (440px in chat) interpolates as plain lengths
  everywhere; sampled frame widths ramp smoothly in both Chromium and WebKit
  (82→109→424→540→591→595). 600px fits the longest panel title; below 900px the users grid
  stacks and the floor is dropped.
- **The aside is `overflow: visible` only when open** (hidden while closed for the animation):
  the role `app-select` renders its dropdown as inline `position: absolute`, which a permanent
  `overflow: hidden` would clip. Below 900px the host stacks to one column and the closed
panel is `display: none`, otherwise its invisible content would hold open an empty grid row.

## Admin-editable system prompt extension (2026-10-09, issue #64)

- **`SYSTEM_PROMPT` is persisted per session, so the extension is composed at chat
  creation and frozen for that conversation's life.** `create_chat` is the only place that
  reads the prompt, storing it as the session's `SYSTEM` `ChatMessage`. Composing it there, via
  the pure `build_system_prompt(extension)`, means a settings change applies to new chats and
  never rewrites one in progress. The alternative — injecting the current prompt when the
  worker builds history — would let a conversation change rules midway, which is worse than a
  prompt being stale for its duration. `SYSTEM_REMINDER`, which used to sit next to
  `SYSTEM_PROMPT` and was never imported anywhere, was deleted in the same change: a second
  prompt constant that looks load-bearing is worse than no constant.
- **Storage is a singleton row, enforced by a check constraint.** `settings` holds one row with
  `id` fixed to `SETTINGS_ROW_ID = 1` and `CheckConstraint("id = 1")`, so "singleton" is a
  database invariant rather than a convention every query has to remember. A key/value table
  was rejected because each option would need its own accessor, validation and audit handling,
  and the type would be a guess at read time; a typed column per option arrives as a migration.
  Reading the value is a single indexed primary-key lookup per chat creation, so nothing is
  cached and there is no invalidation to get wrong.
- **Both admin tiers may edit it, and it is not blocked by `TEST_INSTANCE_MODE`.** Unlike the
  account mutations, this write holds no credential and no ownership, and an empty string undoes
  it, so the 450 gate would protect nothing while making a shared demo instance unable to tune
  its prompt. The absence of a 450 on `PUT /admin/settings` is deliberate; every other
  `POST`/`PATCH`/`DELETE` under `/admin` has one.
- **The audit columns are nullable.** `last_update_by` is a FK with `ON DELETE SET NULL`, not
  `RESTRICT`, so deleting an admin keeps the configuration still in force and drops only the
  attribution; `last_update_at` is null until the first write, because "never set" and "set to
  the empty extension" are different states and only one of them has a timestamp. `GET` therefore
  reports nulls rather than 404 on an untouched instance, since there is one settings row
  conceptually and it simply holds no value yet.
- **Reset is `PUT` with an empty string, and an explicit `null` is rejected.** The payload fields
  are optional so the next option can be added without disturbing this one, which makes "field
  omitted" and "field is null" both reachable — and they mean opposites, so `null` is a 422, the
  same treatment `AdminEditUserSchema` gives `role` and `username`.
- **The extension may reference material indices but must not change them, and the prompt says
  so.** The preamble wrapping the admin's text states that it can override the choice of
  material (for example by making some unavailable) but cannot add materials or renumber them.
  This matters because `MATERIALS` order is load-bearing: `material` is an integer index, so a
  renumbering instruction would corrupt every material in the list for every chat. The bound is
  the text of the preamble plus the admin tier, not validation — admin-authored prompt text is an
  accepted prompt-injection surface, limited to accounts that can already reset passwords.
- **`MAX_PROMPT_EXTENSION_LENGTH` is 8000, which is generous on purpose.** The intended content
  is site-specific tolerances and a list of unavailable materials, so a tight cap would get in
  the way; the bound exists to stop a pasted document being appended to every prompt the
  instance sends. The server `strip()`s what it stores, so trailing whitespace never becomes a
  dangling heading, and a whitespace-only value is treated as unset by `build_system_prompt`.

## Configurable production rates in the instance settings (2026-10-09, issue #64, follow-up)

- **The four production rates are editable per instance; `max_positions` is not.** The
  calculator's `Parameters` dataclass has five fields, and only four are exposed. `max_positions`
  stays fixed at 10 because three separate places assume that number: the backend truncates with
  `positions[:10]`, `_generate_kp` logs `too_many_positions` above it, and the Russian system
  prompt tells the model "Позиций может быть максимально 10". Exposing it would have meant an
  admin-facing field that silently does nothing, or a prompt that contradicts the code. It also
  drives `range(params.max_positions)` in `_clear_positions`, so a value above 10 reaches parts
  of the template no test covers. Making it configurable is a separate change that has to move
  all four together.
- **Rates live in one JSONB column, not one column per rate.** The set mirrors the `processing`
  dataclass, and a blob means adding a rate there is a change to that dataclass rather than a
  migration here. The cost is losing database-level typing on four numbers that are validated by
  Pydantic and read by one function, which is a trade worth making for a singleton settings row.
- **A rate set is all-or-nothing, and `null` is the reset.** Every field is required once
  `parameters` appears, so a payload naming one rate cannot silently return the other three to
  their defaults — these numbers become prices. Sending `parameters: null` restores the
  defaults, which is the way back from a bad edit; omitting the key leaves the current rates
  alone. The route distinguishes the two with `model_fields_set`, so `null` and absent are not
  conflated.
- **The API reports the effective rates, not the stored blob.** `GET` on an unconfigured instance
  returns the calculator's own defaults, so a form renders with real numbers in it. The defaults
  come from `Parameters` rather than being restated in the schema, and
  `test_rates_cover_every_editable_parameter` fails if a field is added to the dataclass without a
  decision about it — otherwise a new rate would be quietly unconfigurable with nothing failing.
- **Rates reach the workbook through the session, not a fresh query.** `_generate_kp` takes the
  `AsyncSession` the caller already has and passes a `Parameters` instance into
  `_generate_kp_job`, which hands it to `process_calculation`. `dataclasses.replace` builds it
  from `DEFAULT_PARAMETERS`, so a rate the API cannot edit keeps the dataclass value and the reset
  needs no branch. The dataclass is frozen, which also makes it safe to pass into the worker
  thread. Nothing is cached: one settings read per generated offer.
- **`GET /admin/settings` grew a field, so the response shape is no longer just the stored
  value.** The handler takes the same argument as every other admin mutation and is still not
  gated by `TEST_INSTANCE_MODE`.
- **A `RequestValidationError` handler sanitises non-finite numbers.** Starlette's `JSONResponse`
  writes with `allow_nan=False` and FastAPI's default handler copies the offending input into the
  error detail, so a body containing a `NaN` literal turned a 422 into a crash — measured, on
  every route, not only the one that introduced it. The handler replaces non-finite floats with
  their text form and then applies `jsonable_encoder`, which the default handler also needs and
  which is what makes error details containing Pydantic objects encodable.

## Review fixes to the settings API (2026-10-09, issue #64)

- **The painting rate was inert because the template carried it, not the code.** Laser,
  bending and welding hours are written into empty cells as `value / rate`, but the template
  ships `=E{row}/5.53` in every painting-hours cell, and `_write_position` wrote only the area
  beside it. So `Parameters.painting_rate_m2_per_hour` was configurable in the API and did
  nothing to any offer. Painting hours are now written like the other three, which makes the
  template's literal obsolete, and `_clear_positions` clears that cell too — otherwise a second
  run with fewer positions would keep stale hours, which it could not do while the cell was a
  formula. The three copies of `res/calc.xlsx` were left alone deliberately: the rate now comes
  from `Parameters`, so changing the template is no longer how it is configured.
- **Two concurrent first saves no longer 500.** The singleton row is created by the first PUT,
  so two admins saving together both read "no row" and both insert `Settings(id=1)`; the loser
  took a primary-key `IntegrityError` and lost its change to a 500. The loser now rolls back,
  adopts the row the winner inserted and re-applies its own update, so the last write wins —
  the same result as two sequential saves. If the competing transaction rolled back too, there
  is nothing to adopt and the request answers 409 rather than pretending to have saved.
- **`admin.id` and the timestamp are read before the rollback, not inside the recovery path.**
  A rollback expires every instance in the session, so touching `admin.id` afterwards triggers
  an implicit refresh that async SQLAlchemy refuses with `MissingGreenlet`. `_apply_settings`
  therefore takes the id and the stamp as plain values, which also means nothing in it can reach
  the database.
- **`AdminSettingsUpdate` forbids extra fields.** The likeliest mistake in this payload is
  sending the four rates without their `parameters` wrapper. With extras allowed those keys were
  ignored, nothing was set, the audit fields were stamped anyway and the caller got a 200 that
  changed nothing — a silent no-op on a settings screen. Rejecting extras turns it into a 422
 naming the key. This is the same failure this change's own tests hit while being written, so
 the behaviour is now pinned by a test rather than by luck.

## Frontend settings page synced to the unified settings endpoint (2026-10-10)

- **The two provisional frontend endpoints never existed on the backend.** The page was built
  against `GET/PUT /admin/system-prompt` (`{prompt}`) and `GET/PUT /admin/parameters` (bare
  rates), while the backend shipped the unified `GET/PUT /admin/settings` carrying
  `{prompt_extension, parameters, last_update_by, last_update_at}`. The service now exposes
  `getSettings()` plus `updateSettings(patch)` and each card saves a partial body
  (`{prompt_extension}` or `{parameters: {...}}`), which the backend's `model_fields_set`
  handling supports. This supersedes the "backend route is still pending" notes in the two
  earlier frontend sections above; those describe a contract that was never implemented.
- **The old shapes would have failed, not degraded.** Bare rates without the `parameters`
  wrapper are rejected with 422 by `extra="forbid"`, and `{prompt}` names a field the schema
  does not have, so the mismatch surfaced as errors rather than silent drift. No compatibility
  shim was added: both sides are owned by this repo and moved together.
- **The form refuses to save a blank prompt extension.** `canSave` requires the trimmed
  value to be non-empty, so whitespace-only input never reaches the server as a no-op
  write. The backend still treats `""` as the reset (reachable with a direct `PUT`), but
  the UI offers no "clear the extension" path: an accidental select-all plus save must not
  silently drop the site's tolerances. The "don't wipe an unknown value" rule is still kept
  separately by disabling the editor until the settings load.
- **`MAX_PROMPT_EXTENSION_LENGTH` is 8000 on both sides.** The page previously capped at
  20000, which would have passed values the server rejects with 422. The counter threshold
  moved with it (7000), since the old 15000 could never be reached under an 8000 cap.
- **`max_positions` is gone from the frontend model.** The backend never returns it
  (`AdminRatesSchema` has four fields), so `MachineParameters` now mirrors those four and
  `MachineParametersPayload` was removed. The card hint was also corrected: the extension
  applies to new chats, not to "new messages in all sessions" — in-progress sessions keep the
  prompt they started with.

## Shared table component (`app-table`) (2026-10-10)

The admin users table and the requests history table are visually identical, so the
styling was extracted into `frontend/src/app/shared/components/table/` instead of being
duplicated per page.

- The component is deliberately **dumb about data**: it renders `TableColumn<T>[]` and
  rows, and only *reports* sort intent through the `sort` model — it never sorts itself.
  The users page sorts client-side (its data is one unpaginated list), the history page
  re-queries the server (`sort`/`order` on `GET /chats`), and both keep their comparators.
- Custom cells (avatars, badges, action buttons, links) are projected via
  `ng-template[appTableCell="<column key>"]` with the row as `$implicit`; text-only cells
  use `TableColumn.text`.
- `interactiveRows` opts a table into clickable, hover-highlighted rows (history); the
  users table stays non-interactive. Class names `th.sortable` / `.th-content` are kept
  from the pre-refactor markup because both page specs select them.
