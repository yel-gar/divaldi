# AGENTS.md

> **Mandatory harness for any AI or human agent working in this repository.**
> Read this file in full before making a change. It describes how this project
> actually works, not how it ideally would.

**Repo:** `divaldi` — AI-assisted quotation engine for sheet-metal fabrication
**Product language:** Russian (all UI strings, LLM prompt, Excel sheet names)
**Code language:** English (identifiers, comments, docs)

---

## 0. Non-negotiable rules

These five rules override any other instinct you have.

| # | Rule |
|---|---|
| 1 | **All Python dependencies are added via `poetry add`.** Never hand-edit `pyproject.toml` dependencies, never write a `requirements.txt`. Use `poetry add <pkg>` (runtime) or `poetry add --group dev <pkg>` (dev) from the relevant package directory (`backend/` or `processing/`). Commit the updated `poetry.lock` with it. |
| 2 | **All frontend dependencies are added via `npm install`.** From `frontend/`, use `npm install <pkg>` (runtime) or `npm install -D <pkg>` (dev). Commit `frontend/package-lock.json` with it. Never hand-edit dependency versions in `package.json`; let npm resolve them and write the lockfile. |
| 3 | **The full project can only be run via Docker.** `docker compose up -d --build`. There is no supported local run of the application: the backend expects service hostnames (`db`, `redis`, `rabbitmq`, `minio`) and resolves two paths relative to `backend/` as CWD. Never claim the app works without stating how you started it in Docker. |
| 4 | **Tests may be run locally.** `poetry -C backend run pytest`, `poetry -C processing run pytest -v`, `npm --prefix frontend test`. Backend tests need a running Docker *daemon* (they use testcontainers) but not the full stack. |
| 5 | **Update `.context/` as you work.** See [section 7](#7-context-directory). A change with no recorded decision or lesson is a change the next agent will re-litigate. |

---

## 1. Repository layout

```
divaldi/
├── backend/            FastAPI service + TaskIQ workers     owner @yel-gar
├── processing/         shared library (PDF, DXF, Excel)     owner @AX-Ray
├── frontend/           Angular 21 SPA                        owner @krchvl
├── conf/               infra config: redis.conf, minio init, ILM rules, pg init
├── scripts/            pre-commit shims for per-package Poetry tools
├── .context/           decisions / lessons / project state
├── .agents/skills/     task-specific playbooks
├── docker-compose.yaml
└── .pre-commit-config.yaml   single source of truth for hooks
```

There is **no monorepo tool**: no npm workspaces, no Nx, no Bazel. Orchestration is
Docker Compose only. The root `package.json` holds *only* commitlint (for the
`commit-msg` hook); the real frontend dependencies live in `frontend/package.json` with
its own lockfile.

---

## 2. Backend conventions

**Stack:** Python 3.14, FastAPI, SQLAlchemy 2.0 (async), asyncpg, Alembic, Pydantic v2,
TaskIQ, structlog, argon2-cffi, aioboto3, Pillow.

**3.14-only syntax is expected.** `requires-python = ">=3.14,<4"` and
`target-version = ["py314"]` for both black and ruff. In particular, PEP 758 makes
`except ValueError, TypeError:` (no parentheses) valid, and black *emits* that form. Do not
"fix" it; adding parentheses fights the formatter.

### Layering (there is no service/repository layer)

```
routes/  ->  deps.py  ->  models/ + schemas/  ->  tasks/  ->  providers/
```

Routes talk to the database directly. Do **not** introduce a repository layer unless the
user explicitly asks for one.

### Naming

| Thing | Convention | Example |
|---|---|---|
| Route handler | `<domain>_<action>` | `admin_get_users`, `send_message` |
| Router | `APIRouter(prefix=..., tags=..., dependencies=[...])` | `chat.py`, `users.py` |
| Pydantic schema | `*Schema` for payloads, `*Request` / `*Response` otherwise | `UserSchema`, `MessageResponse` |
| Cache key | `get_*_key(...)` in `cache.py`, never inline f-strings | `get_generation_key(uuid)` |
| S3 key | `get_*_key(...)` in `storage.py`, never inline f-strings | `get_attachment_key(id)` |
| Model constants | defined next to the model that uses them | `MAX_USERNAME_LENGTH = 32` |
| Enum | `StrEnum` | `UserRole`, `GenerationResultType` |

### The Annotated dependency idiom

`app/deps.py` defines `Annotated[...]` aliases used **directly as parameter types**,
with no `Depends(...)` at the call site:

```python
from app.deps import AdminUser, DbSession

@router.post("/users/{user_id}/password")
async def admin_set_password(user_id: int, admin: AdminUser, db: DbSession):
    ...
```

Existing aliases: `DbSession`, `CurrentUser`, `AdminUser`, `RedisSession`,
`VerifiedMessageSession`, `VerifiedAttachmentId`, `S3PublicClient`, `S3InternalClient`.

Rate limiters are **factories** returning a dependency:

```python
router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(user_rate_limiter(3, timedelta(minutes=5), "user:avatar"))],
)
```

### Async, honestly

Everything is `async`. **CPU-bound and blocking work must be offloaded with
`await asyncio.to_thread(...)`**: PDF rasterising, DXF parsing, xlsx generation, Pillow
resizing. Never block the event loop.

### Docstrings are part of the API contract

Chat routes carry a multi-line docstring **and** a `responses={...}` dict documenting
401 / 403 / 404 / 409 / 429. Keep this pattern when adding endpoints.

### Models

Every model file starts with `from __future__ import annotations` (SQLAlchemy needs it),
uses `Mapped[]` / `mapped_column`, and sets `nullable` explicitly.
`models/__init__.py` auto-imports every submodule via `pkgutil` so Alembic always sees the
full metadata. **Never add manual imports to it.**

### Logging

`structlog` only: `log = structlog.stdlib.get_logger(__name__)`. Bind context per task
with `log = log.bind(attachment_id=...)`. Never use `print()`.

---

## 3. Processing conventions

Separate Poetry package with `src/` layout, imported by the backend via the path
dependency `processing @ ../processing`.

- Prefer pure functions. `calc.py` is bytes-in / bytes-out with no I/O; keep it that way.
- The DXF parser is hand-rolled (no `ezdxf`); supported encodings are listed in
  `SUPPORTED_ENCODINGS`. Do not add a parser dependency without asking.
- Excel sheet names are Russian (`Расчёт`, `Цены на металл`). They are part of the
  business output; do not "fix" them to English.
- Production norms (laser 10.0 m/h, welding 2.0 m/h, bending 84 bends/h, painting
  5.53 m²/h) live as named constants.

---

## 4. Frontend conventions

**Stack:** Angular 21.2 standalone, signals, TypeScript 5.9 strict, SCSS.

### Folder tiers

| Folder | Holds |
|---|---|
| `core/` | singletons: `services/`, `guards/`, `interceptors/`, `models/` |
| `features/` | route-level feature areas (`calculation-chat/`, `order-create/`) |
| `pages/` | routed pages (`login-page/`, `history-page/`, `profile-page/`, `admin/`) |
| `shared/` | reusable components and utils |

### State

No NgRx or Redux. **Signals only**: `signal()`, `computed()`, `effect()`,
`afterRenderEffect()`, `toSignal()`, `takeUntilDestroyed()`. Services are
`@Injectable({ providedIn: 'root' })`. Cross-component handoff uses small one-shot "state
services" (`set()` / `consume()`).

The list-refresh idiom is a version signal: `ChatService.historyVersion = signal(0)`, bumped
by the service and read by the sidebar to re-fetch.

### Templates and styles

- Selector prefix **`app-`** (kebab-case), enforced by ESLint. Directives use `app` camelCase.
- `ChangeDetectionStrategy.OnPush`.
- One `.component.scss` per component, referenced via `styleUrl` (singular).
- Theming via **CSS custom properties**, never hardcoded colours. Light/dark under
  `:root` and `html[data-theme='dark']`.
- BEM-ish modifiers: `.button--main`, `.card--shadow`, `.input--error`.
- `@use '...' as *` with relative paths and **no file extension**.

### API layer

Services build URLs as `` `${environment.apiUrl}/chats` ``. `apiUrl` comes from
`src/environments/environment*.ts`, injected at image build time by
`docker/rewrite-env.mjs` from the `BACKEND_URL` build arg. **Never hardcode a backend
URL.** Auth is cookie-based; `credentialsInterceptor` sets `withCredentials: true`.

### Polling, not WebSockets

Chat results poll `GET /chats/{id}/result` every 2 s with a 5 min timeout
(`POLL_INTERVAL_MS`, `POLL_TIMEOUT_MS` in the chat component). Upload status polls every
2 s up to 150 attempts (`AttachmentUploadService`). Respect these constants.

### Heavy deps are lazy

`docx-preview`, `xlsx` and `hyperformula` are **dynamically `import()`ed** inside
`file-preview.component.ts` so they never enter the eager bundle. Keep new heavy
dependencies lazy too.

---

## 5. Docker and environment

### Bringing the stack up

```bash
cp .env{.example,}                      # then fill in required values
docker compose up -d --build
docker compose logs -f
```

Dev hot-reload (this override also publishes PostgreSQL on port **5431**, which is
required for migrations):

```bash
cp docker-compose.override.yml{.dev,}
docker compose up -d --build
```

The resulting `docker-compose.override.yml` is **gitignored**. Never commit it.

### Hardcoded service hostnames

`redis://redis:6379`, `amqp://...@rabbitmq:5672/taskiq`, `http://minio:9000` and
`http://taskiq_dashboard:8000` are literals in the source. Do not parameterise them
without being asked; it would break the Docker-only run model this project relies on.

### Two CWD-sensitive paths

| Path | Consumer |
|---|---|
| `res/gigachat-ca.cer` | `providers/sber.py`, relative path, requires CWD == `backend/` |
| `res/calc.xlsx` | `tasks/api.py`, via `Path(__file__).parent.parent.parent / "res/calc.xlsx"` |

Both Dockerfiles handle this with `WORKDIR /app`. Follow the same pattern for any new
resource file.

### `.env` is secret

Never commit `.env`; use `.env.example`. Generate secrets with `openssl rand -hex 48`.

---

## 6. Quality gates

Run all of these **before** proposing a change is done.

### Backend

```bash
poetry -C backend run black --check .      # line-length 120, py314
poetry -C backend run ruff check .         # select F,E,W,I,N,UP,B,ASYNC,C4,PIE,T20,Q,RET,SIM,ARG,PTH,RUF
poetry -C backend run pytest               # needs Docker daemon (testcontainers)
poetry -C backend run pytest --cov         # with a branch-coverage report
```

### Coverage

Backend coverage is measured with `pytest-cov` and **reported but not enforced**. The
threshold lives in exactly one place, `fail_under` in `backend/pyproject.toml`, which
pytest-cov reads and enforces. It is currently `0`, so nothing blocks.

| Where | What it does |
|---|---|
| `backend/pyproject.toml` | `[tool.coverage.*]` config, including `fail_under` |
| `.pre-commit-config.yaml` | `pytest-coverage` hook, **pre-push** stage, reports only |
| `.github/workflows/backend-coverage.yml` | runs the same command, uploads `coverage.json` |

**To make 90% the gate:** set `fail_under = 90` in `backend/pyproject.toml`. Nothing else
needs to change. This was verified to work: at `fail_under = 90` the run exits 1 with
`Required test coverage of 90.0% not reached`, and at `0` it exits 0.

Branch coverage is on (`branch = true`) and `source = ["app"]`. Coverage artifacts
(`.coverage*`, `coverage.json`, `coverage.xml`, `htmlcov/`) are gitignored.

### Processing

```bash
poetry -C processing run black --check src tests
poetry -C processing run ruff check src tests
poetry -C processing run pytest -v
```

### Frontend

```bash
npm --prefix frontend run lint             # ng lint (eslint, ts + html)
npm --prefix frontend run format           # prettier --write src
npm --prefix frontend test                 # vitest via @angular/build:unit-test
npm --prefix frontend run build            # prod build; also typechecks
```

### Frontend coverage

Coverage uses `@vitest/coverage-v8`, driven by the `@angular/build:unit-test` builder's
**native** `coverage` options. There is no `vitest.config.ts` in this project and there
should not be one: the builder owns the Vitest configuration and hard-requires
`@vitest/coverage-v8` when `coverage` is enabled.

```bash
npx ng test --coverage --watch=false      # or: npx --prefix frontend ng test --coverage
```

Config lives in the `test` target of `frontend/angular.json` (`coverage`,
`coverageReporters`, `coverageInclude`, `coverageExclude`). Reporters are `text-summary`,
`json-summary` and `html`; output lands in `frontend/coverage/frontend/`, which is already
gitignored.

**To make 90% the gate:** add a `coverageThresholds` object to the `test` target in
`frontend/angular.json`. The builder enforces it and exits non-zero. Nothing else changes,
and no percentage is hardcoded in the hook or the workflow.

Current baseline is **62.77% statements / 65.39% branches / 57.64% functions**. Note that
`coverageInclude` counts untested files at 0%, so the number is honest rather than
flattering.

> **The frontend suite is currently red on `main`.** 14 tests in
> `sidebar.component.spec.ts` fail with `Cannot configure the test module when the test
> module has already been instantiated`. This is pre-existing and unrelated to coverage.
> Because the `vitest-coverage` pre-push hook runs the real suite, it will fail for everyone
> until that spec is fixed. See `.context/PROJECT_STATE.md`.


### Migrations are mandatory

Any change to `app/models/` **must** ship a migration. `tests/test_migrations.py` runs
`alembic upgrade head`, `downgrade base` and `alembic check`, and fails if the models
drift. Generate one with:

```bash
./backend/makemigrations.sh "short description"
```

Note that `alembic/versions/` is **excluded** from black and ruff. Do not reformat
generated files.

---

## 7. `.context/` directory

`.context/` is the project's memory. **Every meaningful change updates it.** Three flat
files, no subdirectories:

| File | Contains | Write an entry when |
|---|---|---|
| `.context/DECISIONS.md` | Architectural and design decisions with the **why**. One `##` section per topic, appended chronologically. | You choose an approach, change a convention, or set a non-obvious rule (for example why a queue is split, why a column is nullable, why a status code is unusual). |
| `.context/LESSONS.md` | Traps, gotchas and non-obvious behaviours discovered the hard way. A flat bullet list, newest at the bottom. | You hit something surprising, lost time to it, or found a fix whose mechanism is not obvious from the diff. |
| `.context/PROJECT_STATE.md` | Where the project stands right now: what is done, what is in flight, what is next. Rewritten in place. | You complete a feature, change the roadmap, or finish a batch of work. |

Rules for writing them:

- **Record the reason, not just the outcome.** A future agent reading "use TaskIQ" learns
  nothing; reading "TaskIQ because Celery's async Redis broker blocked the event loop"
  prevents the same mistake.
- **Do not duplicate what the code already says.** `AGENTS.md` documents *how*;
  `.context/` documents *why it is that way*.
- **One bullet, one lesson.** Long paragraphs get skimmed and skipped.
- **Append** to `DECISIONS.md` and `LESSONS.md`; **rewrite** `PROJECT_STATE.md` wholesale
  so it cannot go stale.
- **Include a date or commit** so entries can be aged out later.

---

## 8. `.agents/skills/` directory

Task-specific playbooks live in `.agents/skills/<skill-name>/SKILL.md`, each with YAML
frontmatter (`name`, `description`) and progressive disclosure through a `references/`
subfolder for detail that is only sometimes needed.

### Provenance and precedence

Six skills are project-specific and were written from this repository's source:
`sqlalchemy-async`, `taskiq-workers`, `python-testing`, `frontend-file-preview`,
`docker-compose`, `conventional-commits`. They encode divaldi's actual conventions.

Two are **third-party** and installed from public registries:

| Skill | Source | License |
|---|---|---|
| `fastapi` | [`samuelpkg/skills`](https://github.com/samuelpkg/skills) | MIT |
| `angular` | [`xfstudio/skills`](https://github.com/xfstudio/skills) | see `metadata.json` |

Each third-party skill ships a **`references/divaldi-overrides.md`** that states where the
generic guide conflicts with this project. **Precedence, highest first:**

1. `AGENTS.md` and `.context/DECISIONS.md` — this project's rules
2. `references/divaldi-overrides.md` inside a skill — project-specific divergences
3. The skill's own `SKILL.md` — generic framework guidance
4. Your own general knowledge

Where a generic guide and this project disagree, the project wins. Read the overrides file
before writing code against `fastapi` or `angular`.

**Exception to the no-emoji rule:** the upstream `SKILL.md` bodies of the two third-party
skills are kept **verbatim** so they can be re-installed or diffed against their source
repos. The Angular guide contains a few checkmark and cross marks. Everything authored for
this repository, including both `divaldi-overrides.md` files, is emoji-free.

| Skill | Origin | When to load it |
|---|---|---|
| `fastapi` | third-party | Writing or changing routes, dependencies, schemas, response models |
| `sqlalchemy-async` | project | Touching ORM models, sessions, queries, or migrations |
| `taskiq-workers` | project | Adding or changing a background job, queue assignment, or schedule |
| `python-testing` | project | Writing tests or fixtures, or debugging test failures |
| `angular` | third-party | Writing components, services, signals, templates, or styles |
| `frontend-file-preview` | project | Working on the docx/xlsx/pdf/image preview and its lazy dependencies |
| `docker-compose` | project | Changing services, Dockerfiles, env plumbing, or the dev overrides |
| `conventional-commits` | project | Writing a commit message or naming a branch |

**Load the relevant skill before doing the work it covers.** If a skill is missing or
inaccurate, fixing it as part of your change is expected, not out of scope.

---

## 9. Commits and branches

**[Conventional Commits](https://www.conventionalcommits.org/)**, enforced by
`commitlint.config.js` through the `commit-msg` pre-commit hook.

```
<type>(<optional scope>): <subject>
```

Examples:

```
feat(backend): add pagination to the admin user list
fix(frontend): sliding pill indicator stuck on a hidden xlsx sheet
docs: explain the two task queues
refactor!: drop the legacy parser shim
```

| Type | Use for |
|---|---|
| `feat` | new capability |
| `fix` | bug fix |
| `refactor` | behaviour-preserving change |
| `perf` | performance |
| `docs` | documentation only |
| `test` | tests only |
| `build` / `ci` | dependencies, workflows, Docker |
| `chore` | housekeeping |
| `!` after type or scope, plus a `BREAKING CHANGE:` footer | breaking change |

Observed scopes: `backend`, `frontend`, `processing`, `ci`. Branch prefixes in use: `jut/`,
`feat/`, `fix/`, `docs/`, `feature/`.

### No commit metadata beyond the message

The commit message is the **only** metadata allowed. Never add these, and never accept them
from a tool that appends them automatically:

- `Co-Authored-By:` trailers, or any other attribution trailer
- `Generated with ...` style footers, with or without a robot emoji
- Signed-off-by, Reviewed-by, or any other `git interpret-trailers` entry
- `--author` overrides or `--trailer` flags passed to `git commit`
- `git commit --amend` used to inject attribution

If a template, hook or assistant suggests appending attribution, drop it. Authorship and
history are already recorded in git itself: the commit author, the branch and the PR link.

Commitlint validates the message only, so none of this is machine-enforced. It is a rule you
follow.

---

## 10. Things that will bite you

1. **`providers/containers.py` constructs the provider at import time.** Importing any
   task or route module requires `SBER_API_KEY` and `SBER_API_SCOPE` to exist. The tests
   set them in the autouse `env` fixture for exactly this reason.
2. **The app must run with CWD == `backend/`.** See the CWD-sensitive paths in section 5.
3. **The LLM prompt is Russian and drives the output schema.** `harness.py` defines
   `MATERIALS` (27 indexed steel grades) and `HARNESS_STRUCTURED_SCHEMA`. The `material`
   field is an **integer index into that list**, so changing the list order silently
   corrupts every material. If you add one, append and record it in `DECISIONS.md`.
4. **`TEST_INSTANCE_MODE` blocks admin mutations with HTTP 450.** This non-standard code
   will look like a typo in any frontend `switch`. It is intentional.
5. **The root `parser/` directory is dead.** It contains only `__pycache__`. The real code
   is in `processing/`. Do not add anything there and do not import from it.
6. **Frontend `npm test` is not in CI.** CI runs only `ng lint` and `ng build`. Run the
   Vitest suite yourself before claiming tests pass.
7. **Pre-commit Python hooks never fail the commit.** `scripts/precommit-*.py` call
   `subprocess.run(..., check=False)`. Rely on the explicit `black --check` and
   `ruff check` commands instead.
8. **There is no service layer.** If you want to inject a repository, ask the user first.

---

## 11. Pre-submission checklist

- [ ] Dependencies added with `poetry add` / `npm install`, lockfiles committed
- [ ] `black --check` and `ruff check` clean in every touched Python package
- [ ] `pytest` green in every touched Python package
- [ ] `poetry -C backend run pytest --cov` run if backend code changed; coverage did not drop
- [ ] `ng lint`, `ng build` and `vitest` green if the frontend was touched
- [ ] `npx ng test --coverage` run if frontend code changed; coverage did not drop
- [ ] Migration added if any ORM model changed (`alembic check` proves it)
- [ ] No secrets, no committed `.env`, no committed `docker-compose.override.yml`
- [ ] `.context/DECISIONS.md`, `LESSONS.md` and `PROJECT_STATE.md` updated as warranted
- [ ] Commit message follows Conventional Commits
- [ ] No commit metadata beyond the message (no `Co-Authored-By`, no generated-with footer)
- [ ] Any new skill or convention recorded in `AGENTS.md` or `.agents/skills/`
