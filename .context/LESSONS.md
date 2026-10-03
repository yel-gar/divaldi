# Lessons

Traps, gotchas and non-obvious behaviours discovered the hard way.
Flat bullet list, append at the bottom. One bullet, one lesson.

---

## Environment and tooling

- In CI workflows use `poetry install --no-root`, not `poetry install --with dev`. The
  `dev` group is installed by default, and the FastAPI project root must not be installed
  into its own venv. Production images use `poetry install --only main --no-root`.
- The pre-commit Python hooks **cannot fail your commit**: `scripts/precommit-black.py` and
  `scripts/precommit-ruff.py` pass `check=False` to `subprocess.run`. A clean-looking hook
  run proves nothing, so always run `black --check` and `ruff check` explicitly.
- `.pre-commit-config.yaml` is the single source of truth for all hooks, but
  `.github/workflows/pre-commit.yml` only runs the *generic* hooks (yaml, json, toml, eof,
  whitespace). Real lint and test coverage comes from `backend-ci.yml` and
  `processing-ci.yml`.
- `frontend-ci.yml` runs `ng lint` and `ng build` but **not** `ng test`. Vitest failures only
  ever surface locally, so run `npm --prefix frontend test` yourself.
- `pre-commit` hooks invoke a `python` executable. On systems where it is `python3` or `py`,
  the hook silently does nothing useful until you alias it.

## Docker and environment

- `docker-compose.override.yml` is **gitignored**. A fresh clone has no override, so Alembic
  cannot reach PostgreSQL because it is not published by default. Copy
  `docker-compose.override.yml.dev` to `docker-compose.override.yml`; that override publishes
  the DB on host port **5431**, which is what `backend/makemigrations.sh` expects.
- `backend/makemigrations.sh` starts the `db` service itself if it is not running, waits for
  its healthcheck, exports `POSTGRES_HOST=localhost POSTGRES_PORT=5431`, sources `.env`, and
  runs alembic. It **stops `db` on exit only if it started it** (`trap cleanup EXIT`). If it
  hangs, the healthcheck is failing: check `docker compose ps`.
- The app must run with CWD == `backend/`. `providers/sber.py` opens `res/gigachat-ca.cer` by
  **relative** path, so a different working directory raises at request time, or worse, only
  under the PERS-scope code path. `tasks/api.py` gets this right by anchoring on
  `Path(__file__).parent.parent.parent / "res/calc.xlsx"`.
- Service hostnames (`redis`, `rabbitmq`, `garage`, `taskiq_dashboard`) are hardcoded literals
  in the source. That is why the project cannot be run outside Compose; do not "improve" them
  into env vars without also changing the run model.
- Redis database **0 is general** (cache, locks, rate limits, statuses) and **1 is TaskIQ
  result storage only**. Writing task results to `/0` silently breaks every result read.

## Python and backend

- `app/providers/containers.py` builds a module-level `SberProvider(...)` **at import time**
  from `os.environ["SBER_API_KEY"]` and `os.environ["SBER_API_SCOPE"]`. Therefore *importing
  any route or task module* requires both env vars to exist. This is why
  `tests/conftest.py` has an autouse `env` fixture monkeypatching them to mock values:
  without it, every test errors on import rather than on assertion.
- **Redis `.get()` and `db.execute(...).scalar()` return `Any` or untyped values**, so type
  narrowing needs `# type: ignore` or an explicit cast. Do not "clean up" these by adding
  asserts that change runtime behaviour.
- Model files start with `from __future__ import annotations` and use
  `if typing.TYPE_CHECKING:` for circular imports. Removing the future import makes
  SQLAlchemy's `Mapped[]` resolution fail on string annotations.
- `app/models/__init__.py` uses `pkgutil.iter_modules` plus `importlib.import_module` to
  auto-register every model. **Do not add manual imports**: a new model file in the same
  package is picked up automatically, and manual entries are how duplicates creep in.
- `alembic/versions/` is excluded from both black and ruff. Reformatting generated migrations
  produces a noisy diff on every regeneration and is explicitly not wanted.
- `alembic/env.py` reads the URL from `get_database_url()` and does `.replace("%", "%%")`. The
  doubling is required because `alembic.ini` uses `ConfigParser` interpolation, and a raw
  password containing `%` otherwise crashes the interpreter.
- `tests/test_migrations.py` runs `alembic upgrade head`, `downgrade base` **and
  `alembic check`** in a subprocess. It is a real drift gate: change a model, forget the
  migration, and the suite fails with the exact command to run. There is currently only one
  revision (`58cdf8dfcbba`, `down_revision=None`).
- Backend tests require a **Docker daemon** because `postgres_container` and
  `redis_container` are `testcontainers` fixtures scoped to the session. A test run without
  Docker fails at fixture setup, not at an assertion, so read the error before debugging code.
- `conftest.py` builds the schema with `Base.metadata.create_all`, **not** migrations. Only
  `test_migrations.py` exercises the Alembic path.
- The `httpx.AsyncClient` in tests carries cookies between requests, mirroring a browser. A
  test that logs in and then calls an admin route without re-logging in *will* pass auth. This
  is intentional, but it means "logged out" assertions need a fresh client.
- `@pytest.mark.asyncio` is still written explicitly even though `asyncio_mode = "auto"`.
  Both work; match the surrounding file rather than "fixing" the inconsistency.

## The GigaChat harness

- **`MATERIALS` order is a data contract.** The `material` in every generated position is an
  **integer index** into that list. Inserting a grade in the middle silently reinterprets
  every already-persisted position. Append only, and note it in `DECISIONS.md`.
- **An empty `positions` list means "ask clarifying questions"**, not "generation failed". The
  prose in `message` is the question. Distinguishing the two in the UI, for example by showing
  an error, is a bug.
- The prompt-injection guard is a *model-level* control in `SYSTEM_REMINDER`, not a parser
  check. It can be talked around, so do not describe it in docs as a security boundary.
- GigaChat PERS-scope calls take a **global Redis lock** (`api:global:lock`). Concurrent
  requests queue for up to 60 s and then raise, so a burst of generation requests looks like
  failures even though nothing is broken.

## Processing library

- **Two copies of `calc.xlsx` exist on purpose**: `backend/res/calc.xlsx` (read by
  `tasks/api.py`) and `processing/src/processing/calculator/res/calc.xlsx` (packaged with the
  library). Editing only one produces a mismatch between what the library ships and what the
  backend renders.
- `processing/tests/conftest.py` inserts `processing/src` into `sys.path` so the tests run
  **without installing the package**. A test that only passes after `poetry install` is
  testing something other than the library.
- The DXF parser is hand-rolled. New entity types need explicit handling in the group-code
  walk; adding `ezdxf` "just for this" would change the dependency profile and the error types
  (`DXFStructureError`) that callers already catch.
- `SUPPORTED_ENCODINGS = ["utf-8", "cp1251", "latin-1"]` reflects real customer files.
  Removing `cp1251` because it looks legacy breaks Russian-locale DXFs.
- **`float("1500,50")` raises, so a comma-decimal price is silently dropped.**
  `_load_material_prices` skips it like any other unparseable value, which means the material
  vanishes from the price map rather than being priced at zero. Worth knowing if a template
  ever arrives from a Russian-locale Excel.
- **`dxf_parser.py` can never reach 100% and that is not a testing failure.** The
  `UnicodeDecodeError` fallback after the encoding loop is unreachable because `latin-1`
  decodes any byte sequence, and the six `except ValueError, TypeError: continue` blocks
  around `_get_float` calls are unreachable because `_get_float` swallows those errors and
  returns `0.0`. Both verified by script. Do not write tests to chase them.
- **`get_measurements_data` and `extract_measurements` are separate walkers over the same
  entities**, with their own copies of every ARC and LWPOLYLINE branch. A test for one tells
  you nothing about the other, which is how `dxf_parser.py` sat at 77% while looking well
  covered.
- **A dangling group code at the end of a DXF is dropped, not stored empty.** The parser
  breaks before consuming the value, so `{10: []}` never appears; asserting on that shape
  will fail.

- **The global npm is newer than the pinned one and breaks installs two different ways.**
  `package.json` pins `packageManager: npm@10.9.2` but the machine has npm 12, which fails
  with `Cannot read properties of null (reading 'children')` (an arborist crash), and then,
  with an explicit version, with `EALLOWREMOTE` because it refuses the remote tarball
  dependency `xlsx@https://cdn.sheetjs.com/...`. **Use the pinned version:
  `npx --yes npm@10.9.2 install ...` from `frontend/`.** Do not "upgrade" the lockfile with
  a newer npm as a side effect.
- **A bare `npm install -D @vitest/coverage-v8` installs the wrong major version.** The
  registry's latest is the v5 line, which does not match the project's Vitest `4.1.11`.
  Pin it: `@vitest/coverage-v8@4.1.11`. The coverage provider and the runner must share a
  major version, and nothing warns you about the mismatch.
- **Angular's unit-test builder owns the Vitest config; do not add `vitest.config.ts`.**
  `@angular/build:unit-test` exposes `coverage`, `coverageReporters`, `coverageInclude`,
  `coverageExclude`, `coverageThresholds` and `coverageWatermarks` directly, and requires
  `@vitest/coverage-v8` by name. Settings belong in the `test` target of `angular.json`.
- **Coverage output nests under the project name**: `frontend/coverage/frontend/`, not
  `frontend/coverage/`. A CI upload path pointing at `coverage/coverage-summary.json` will
  find nothing. Already gitignored by `frontend/.gitignore`'s `/coverage`.
- **Omitting `coverageInclude` inflates the number.** V8 then reports only files a test
  actually imported, so untouched files vanish from the denominator. The same suite reads
  78.15% implicitly and 67.6% with an explicit include; the lower figure is the honest one.
- **A failing suite suppresses the coverage report entirely.** With 14 failures in
  `sidebar.component.spec.ts`, `ng test --coverage` wrote an empty `coverage/` directory and
  printed no summary. To measure a red suite, exclude the broken spec with
  `--exclude "**/<name>.spec.ts"` and treat the result as provisional.
- **`sidebar.component.spec.ts` was red on `main`: the jsdom test environment has no
  `localStorage` at all.** The visible error was misleading. The reported failure was
  `Cannot configure the test module when the test module has already been instantiated`,
  but the real first error was
  `Cannot read properties of undefined (reading 'getItem')` thrown from
  `_ThemeService.restoreTheme` during **field initialization**; the 13 other errors were a
  cascade from the `afterEach` avatar flush hitting an unassigned `http`.
- **Diagnose from the FIRST error in the file, not the summary.** The `TestBed` message
  looked like a test-structure problem and would have sent you to `resetTestingModule()`. A
  throwaway probe spec printed `typeof window === 'object'`, `document.URL ===
  'http://localhost:3000/'`, and `typeof localStorage === 'undefined'`, which located the
  real cause in one run. jsdom sets `window._localStorage` unconditionally in its
  constructor, so a *bare* `new JSDOM(url)` returns a working `Storage`; the gap comes
  from how the environment is built for Vitest, not from jsdom.
- **Fix an environment gap in the environment, not in production code.** The shim lives in
  `src/test-setup.ts`, registered via the builder's `setupFiles` option, and only installs
  when storage is missing so it self-disables if a future upgrade fixes it. Guarding
  `ThemeService` with `typeof localStorage === 'undefined'` would have been the wrong fix:
  the app is not broken, and it would add defensive branches to every caller forever.
- **`Sidebar` is the only consumer of `localStorage` in the app**, which is why exactly one
  spec file failed and the other 19 passed. A failure isolated to a single spec is often a
  clue about which service it pulls in, not about that spec.
- **Verify a test fix with a mutation, not just green output.** After the shim made 14 tests
  pass, the assertions could have been vacuous. Renaming the history title in the sidebar
  template to `MUTANT` correctly failed 1 test, proving the spec really exercises the
  component. Reverted after checking.

## Frontend

- **Never hardcode a backend URL.** `environment.prod.ts` holds the placeholder
  `apiUrl: '__BACKEND_URL__/api/v1'`, rewritten at image build time by
  `docker/rewrite-env.mjs` from the `BACKEND_URL` build arg. A literal URL in a service works
  locally and breaks the moment the deployment moves.
- The build arg reaches the frontend through `docker-compose.yaml` (`args.BACKEND_URL`), and
  in dev through the bind-mounted `ng serve` in `docker-compose.override.yml.dev`. If dev and
  prod disagree about the API URL, check both.
- **`docx-preview`, `xlsx` and `hyperformula` are lazily `import()`ed.** Promoting any of them
  to a static top-level import bloats the eager bundle for every user, including those who
  never open a preview.
- The `.xlsx` preview evaluates formulas **across sheets** with HyperFormula, because the
  generated `kp.xlsx` prices rows using workbook formulas. Rendering cells without the formula
  engine shows blanks where prices should be.
- Component **class naming is inconsistent by history**: `CalculationChatComponent` versus
  `HistoryPage`, `Layout`, `Sidebar`, `Textarea`, `Select`. Files are always
  `<kebab-name>.component.ts`. Follow the file you are editing; do not mass-rename.
- Angular schematics have `skipTests: true`, so `ng generate component` **does not create a
  spec file**. If you add a component with logic, write the spec by hand.
- Component tests use two idioms: `HttpTestingController` for services, and hand-rolled fakes
  (`class FakeUploader`) plus inline `TestHost` components for components. Match the
  neighbouring spec rather than mixing the two in one file.
- ESLint lints `src/**/*.ts` and `src/**/*.html` but **not `.scss`**. Prettier formats styles,
  but there is no stylelint, so a bad SCSS rule will not be caught by any gate.
- The `app-` selector prefix is enforced by `@angular-eslint/component-selector` (kebab-case)
  and `directive-selector` (camelCase). Renaming a selector without updating the prefix fails
  `ng lint`.
- Colours must come from CSS custom properties; light and dark is `html[data-theme='dark']`
  plus `localStorage['theme']`. A hardcoded hex in a component is invisible to the theme
  toggle.

## Test infrastructure

- **Patching `app.cache.get_redis_client` does nothing for the workers.** The task modules
  do `from app.cache import get_redis_client`, which binds the name into their own
  namespace; `monkeypatch.setattr("app.cache.get_redis_client", ...)` leaves those bindings
  pointing at the real `redis://redis:6379`. Patch `app.cache.get_redis_pool` instead, so
  every call site is covered at once. The same trap applies to `tsq_db`, where all three
  task modules must be patched, not just `app.tasks.conf.broker`.
- **Worker tests must commit, not use the `db_session` fixture.** `db_session` wraps
  everything in a transaction it rolls back, and the worker's `tsq_db` opens a separate
  connection, so it cannot see pending rows at all. Tests that appeared to pass were
  silently asserting against an empty database until they committed through the engine.
- **`app.storage` and `app.providers.containers` read `os.environ` at import time**, so
  the test env must be set at the top of `conftest.py` *before* any `app` import. An
  autouse fixture is too late: fixtures run after collection, and these modules import
  during it. This surfaced as `KeyError: S3_SECRET_KEY` at collection.
- **`get_redis_pool` and friends are `@cache`d, so tests that change the environment must
  call `cache_clear()`.** `get_debug` returned a stale value across every value of `DEBUG`
  until the cache was cleared, which looked like the truthiness logic being wrong.
- **`redis-py` 8 made `ConnectionPool.get_connection()` a coroutine.** `async with
  pool.get_connection()` is a `TypeError`; it must be awaited.
- **A failing suite silently suppresses the coverage report.** With failures present,
  `pytest --cov` writes an empty `coverage/` directory and prints no summary, so a coverage
  number can look like "no change" when in fact nothing was measured.
- **Testcontainers' MinIO helper needs the `minio` python package**, which the project does
  not depend on. `DockerContainer(image, command=..., env=..., ports=[9000])` plus a retry
  loop around `create_bucket` achieves the same thing with no new dependency, and reports
  the real S3 error when MinIO never comes up.
- **`@broker.task` objects are not awaitable**; `task.original_func` is the underlying
  coroutine. `tests/helpers.run_task` wraps this so worker tests never touch RabbitMQ.
- **`RUF003` rejects Cyrillic in comments** but not in string literals, so refer to Russian
  sheet and material names without quoting them in a comment.

## End-to-end

- **A rate-limited backend makes an e2e suite trip its own limiter.** `chats:post` allows 5
  per minute per user for both chat creation and message sending. One run creates several
  chats as a single shared user, so the limit is reached *within* the suite. The failure is
  far from the cause: the chat is created (202), the send is rejected (429), and the create
  page never navigates, so the assertion reports "expected URL to match /chats/.+".
  `workers: 1` plus clearing `ratelimit:*` in Redis before each test is the fix; parallel
  workers make per-test clearing useless because they trip each other.
- **`docker compose exec` does not forward host env vars** into the container. Seeding a
  user from a heredoc needs `docker compose exec -T -e NAME=value ...`.
- **Python inside the backend container needs `poetry run python`**, not bare `python`; the
  venv is not on the system path. This is the same reason `createsuperuser.sh` wraps it.
- **`import.meta` is unavailable in Playwright specs** here, because the config and specs
  are transpiled to CommonJS. Use `process.cwd()` or an env var for the repo root.
- **Icon-only buttons have no accessible name unless one is set.** The chat results panel
  toggles via `aria-label="Панель результатов расчёта"`, and guessing a visible-text locator
  for it fails. Prefer the aria-label in specs.
- **`app-input` renders both a hidden input and the textarea**, so
  `getByPlaceholder` resolves to two elements and trips strict mode. Target
  `textarea[placeholder="..."]` instead.
- **User-facing errors are toasts, not inline field errors.** A failed login raises a
  notification; there is no `.auth-error` element to assert on.
- **The admin user form is always visible**, not a dialog, and its submit button reads
  "Сохранить" in both create and edit mode.

## Frontend test environment

- **jsdom implements neither `window.matchMedia` nor `Element.prototype.scrollTo`**, and
  the chat component's `afterRenderEffect` uses both, so every spec that renders it must
  stub them or the render throws. This was masked as an unrelated `TypeError`.
- **`fixture.destroy()` before `TestBed.resetTestingModule()` is mandatory for components
  that own a timer.** `DestroyRef.onDestroy` is what clears the poll interval, so a
  fake-timer test that skips teardown leaves hundreds of queued HTTP requests. Flushing
  them is also wrong: the subscription is already unsubscribed, so it throws
  `Cannot flush a cancelled request`.
- **jsdom exposes no `localStorage` at all**, which broke every spec touching `ThemeService`
  (the sidebar's 14 tests). Fixed in `src/test-setup.ts` via the builder's `setupFiles`,
  not by guarding application code.
- **`extractApiErrorMessage` collapses every 5xx to `Ошибка сервера`**, so a test asserting
  the backend's `detail` string on a 500 fails. Assert the normalised message, or use a 4xx
  where `detail` is passed through.
- **`rm -rf coverage` while a test run is in flight intermittently breaks the run** with
  "Something removed the coverage directory". Just run the coverage command; do not clean it
  first.

## Object storage (Garage)

- **The `dxflrs/garage` image has no shell at all** — no `/bin/sh`, no `curl`, no `mc`, not even
  `ls`. Anything the bootstrap needs has to come from another image.
- **Do not lift binaries out of busybox into the Garage image.** Copying `/bin/sh` in that
  direction builds an image whose shell fails with `exec /bin/sh: no such file or directory`
  even though the binary is present and executable, because those binaries expect a loader
  and directory layout the distroless base lacks. Base on busybox and copy the garage binary
  *in* instead.
- **`GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN` must be exactly 32 bytes of hex (64
  characters).** The failure is `Invalid RPC secret key: expected 32 bytes of random hex`, which
  does not say the value is the wrong length. `openssl rand -hex 48`, used for every other
  secret in `.env`, produces 96 characters and is rejected.
- **testcontainers mounts a volume read-only by default**, and Garage creates its own LMDB
  directory inside the mount point, so the container exits with `Unable to create LMDB data
  directory: Read-only file system`. Pass `mode="rw"` to `with_volume_mapping`. MinIO tolerated
  the read-only mount, so this only appeared after the migration.
- **A presigned POST rejects any form field that is not also a policy condition**, with
  `Key 'content-type' is not allowed in policy`. The upload routes pass `Content-Type` in both
  `Fields` and `Conditions`, which is why they work; a new call site that adds a field without
  the matching condition will get HTTP 400.
- **The region decides the signature version.** With credentials defaulting to `us-east-1`,
  botocore signs presigned POSTs with the legacy `signature` field. Any other region, including
  the `garage` region this project now uses, produces `x-amz-signature`. A test asserting
  `signature` was passing for the wrong reason.
- **Garage's lifecycle worker runs once per day at midnight**, so a 1-day expiration rule
  cannot be observed in a test. An already-past `Expiration.Date` is accepted but is only
  applied by the next daily sweep.
- **The garage admin API (port 3903) resets connections when proxied**, so the admin API is not
  a reliable readiness probe here. The CLI over RPC, or the S3 port answering `GET /`, is what
  the healthcheck and the bootstrap use.
- **A secret written with `echo` carries a trailing newline**, which aiohttp rejects as
  `Forbidden control character detected in headers`. Strip it when loading credentials from a
  file in a test.

## Agent skills and documentation

- **Do not hand-write a skill for a framework you can install.** `openai/skills` (curated)
  and `anthropics/skills` have no FastAPI/Angular/Docker/Python-testing entries, but
  `samuelpkg/skills`, `xfstudio/skills` and `github/awesome-copilot` do. Install with
  `~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo
  <owner>/<repo> --path <dir> --dest <dest>`. A hand-written flat `SKILL.md` cannot carry
  real framework depth, and guessing at framework APIs is where an agent invents things.
- **An installed vendor skill silently contradicts a project-specific one.** The Angular
  skill assumes SSR, hydration and zoneless change detection; this app has none of them. The
  FastAPI skill shows `db: AsyncSession = Depends(get_db)`, while `deps.py` mandates
  `Annotated` aliases used as parameter types. Installing without an override file makes the
  harness actively wrong.
- **A `references/` file nothing links to will never be read.** An agent loads `SKILL.md` and
  stops. Point at the overrides from the frontmatter `description` *and* a callout at the
  top of the body, or it is dead documentation.
- **A skill's own `metadata` can misdescribe the project.** `xfstudio/skills:angular`
  declares `organization: "Antigravity Awesome Skills"` while living in a repo by a
  different author. Verify provenance from the source repo, not the payload.
- **`websearch` returned HTTP 403 in this environment; the Code Mode `search` tool returned
  nothing.** Use `curl` against `api.github.com`, or the authenticated `gh api`, instead.
  `gh` is logged in, which also unlocks code search (`gh api "search/code?q=..."`) that
  unauthenticated curl cannot do.
- **Document new tooling in README, not just AGENTS.** The old README had no
  architecture, feature, port, test or contribution documentation at all, which is why the
  project had three unrunnable-looking parts (`parser/`, no `.env.example` entry for
  `TEST_INSTANCE_MODE`, no LICENSE).

## Verifying migrations

- **`backend/tests/test_migrations.py` already proves every migration works.** It runs
  `alembic upgrade head`, `downgrade base`, re-`upgrade` and `alembic check` against a real
  PostgreSQL container. I did not know this, so I hand-rolled a throwaway postgres to run
  `alembic check` by hand — and the container published 5431, colliding with the developer's dev
  database and knocking it offline. The suite had already answered the question in 12 seconds.
  **Read the existing tests before writing a verification step.**
- **Do not run `alembic` from a worktree without a reachable database.** It resolves
  `POSTGRES_HOST` from the environment, and the db port is only published by the dev override.
  With the e2e override in place the port is unpublished and the command fails on a DNS or
  connection error that looks like a migration bug.

## Destructive operations

- **`docker compose down -v` destroyed the developer's PostgreSQL data.** I ran it to prove the
  object-storage bootstrap works from empty volumes, reasoning that the database was "just a
  test database". That reasoning was mine to make and it was wrong: the volume can hold real
  accounts, chats and attachments, and there is no way to check from the host whether it does.
  The user had to tell me not to do it again.
- **The general rule: never issue a command whose effect is irreversible and invisible.**
  `-v` is a single character that deletes a database. If a verification seems to need a
  destructive step, ask first, or verify against a throwaway name instead — in this case a
  fresh `docker run` or a separate Compose project name would have proved the same thing
  without touching anything.
- **"It is probably fine" is not a risk assessment when the cost is someone else's data.**
  Blast radius decides whether a guess is acceptable, and here the blast radius was the user's
  work.

## Cross-cutting

- **`pytest-cov` needs to be a dev-group dependency, not a global install.** `poetry add
  --group dev pytest-cov` from `backend/` is the only correct route; the pre-push hook runs
  `poetry -C backend run pytest --cov`, which resolves the plugin from the backend venv.
  A globally installed `pytest-cov` will not be visible there.
- **`--cov` alone does not produce `coverage.json`.** Coverage is configured in
  `backend/pyproject.toml` under `[tool.coverage.json] output = "coverage.json"`, but that
  section only takes effect when the `json` report is actually requested. The CI step uses
  `--cov --cov-report=term-missing --cov-report=json`; a bare `--cov` prints the terminal
  report and writes nothing, so the upload-artifact step would fail on a missing file.
- **`pytest-cov` is silent about a missing threshold, which is fine.** With `fail_under = 0`
  the run exits 0 and still prints `TOTAL`. Do not read "exit 0" as "no coverage"; read the
  `TOTAL` line.
- **Coverage of untested code should be read as a work list, not a score.** The
  `Missing` column of the terminal report is the actionable output: it points at
  `routes/chat.py`, `tasks/files.py`, `tasks/api.py`, `routes/users.py` and
  `providers/sber.py`, which is the same gap `.context/PROJECT_STATE.md` already records.
- **A pre-push hook that needs a Docker daemon will fail on a machine without one.** The
  coverage hook inherits the backend suite's testcontainers requirement, so a developer
  without Docker cannot push. This is the same constraint as the existing `pytest` hook and
  is accepted deliberately; CI is the authoritative check.
- **`pre-commit install --hook-type pre-push` must be re-run** after adding a hook with
  `stages: [pre-push]`. A clone that only installed `pre-commit` and `commit-msg` has no
  `.git/hooks/pre-push` and will silently skip the coverage report entirely.
- **The root `parser/` directory is dead**: only `__pycache__` from the pre-`processing/` era,
  with Python 3.13 bytecode. Nothing in the build, pre-commit or CI references it. If a file
  you need seems to be "missing" from `processing/`, search the git history
  (`git log --all --diff-filter=D -- 'parser/*'`) rather than writing it into `parser/`.
- Read `backend/app/harness.py` before changing anything about generation output. The
  structured schema and the prompt are a single coupled contract; a prompt edit without a
  schema edit, or the reverse, is how the model starts returning unparseable JSON.
- **`except ValueError, TypeError:` is valid Python 3.14 here, not Python 2 syntax.** PEP 758
  allows `except` and `except*` to omit parentheses for multiple exception types. It appears in
  `processing/src/processing/calculator/calc.py` and six times in
  `processing/src/processing/parser/dxf_parser.py`, and black with
  `target-version = ["py314"]` **formats it without parentheses**. `requires-python = ">=3.14,<4"`
  in both `pyproject.toml` files makes this safe. It looks exactly like Python 2 syntax to a
  reader, an older linter, or an automated review, and has been misreported as a critical bug
  more than once. Do not "fix" it by adding parentheses; doing so produces a diff against the
  project's own formatter and will be reverted by the next `black` run.
- **Check `target-version` before judging unusual syntax in either language.** This project
  pins `py314` for black and ruff and Angular 21 / ES2022 for the frontend, so modern-only
  constructs are expected rather than suspicious.
- **`Position.material_id_to_material_str` catches the wrong exception**
  (`app/providers/models.py`). It does `MATERIALS[int(val)]` inside
  `except KeyError`, but `MATERIALS` is a **list**, so an out-of-range index raises
  `IndexError` and the raw error escapes `model_validate` instead of the intended
  `ValueError("Invalid material id")`. A negative index also silently wraps to the last
  element. A test pins the current behaviour and says what the fix is; the one-word fix
  (`except IndexError`) is left for a maintainer.
- **`cleanup_orphan_attachments` deletes rows but leaks their S3 objects**
  (`app/tasks/files.py`). It calls `orphans.all()` to log a count, which exhausts the
  `ScalarResult`; the following list comprehension then iterates a closed result and
  collects nothing, so `asyncio.gather` runs zero `_s3_try_delete` calls. The logged
  `count` is rows found, not rows whose objects were removed.
- **The assistant's own reply lives in `chat_messages`, so "the whole history" includes it.**
  `process_response` stores the raw provider JSON as a `ChatMessage` with
  `role=UserRole.ASSISTANT`, not in `generation_results` alone, which is why a retry handed the
  model the answer it was being asked to replace. Anything that reads the session as history
  has to cut it at the last `UserRole.USER` row; the reasoning is in `DECISIONS.md`.
- **`redis_keys` in a worker test signature is not dead weight, and deleting it breaks the test
  with a DNS error.** It looks unused when a test never calls it, but it is what pulls in
  `redis_session`, which stands the testcontainer up and repoints the `@cache`d pool at it.
  Remove it and the worker dials the Compose hostname `redis`, failing with
  `socket.gaierror: Name or service not known` inside aioredis' reconnect loop.
- **`generate_chat_message` cannot tell a retry from a new message.** Both `send_message` and
  `retry_send` call the same task with the same session id, so history shaping has to live in
  the worker. Fixing it in the route looks right and leaves the other caller unfixed.
- **Two chat endpoints disagree about attachment readiness.** `GET /chats/` returns every
  attachment while `GET /chats/{id}` filters on `ready == True`. Pinned by tests rather
  than papered over; one of the two is a bug.
- **Verify claims against the source before reporting them, and verify your own corrections.**
  The misdiagnosis above was first rejected with the wrong reason ("the review misread a
  wrapped tuple") and only later traced to PEP 758. Confirming *that* a file parses is not the
  same as confirming *why* it parses, and a confident wrong explanation is worse than the
  original false positive.
- **`PurePath` does not split on a backslash when running on POSIX.** `PurePath("..\\..\\x.pdf").suffix`
  is `.pdf` and `PurePath("/etc/passwd.pdf").suffix` is `.pdf` too, so an extension check built
  on `PurePath` happily accepts a name that is really a path. That is why the chat upload route
  tests the name shape separately (`_is_bare_filename`) before it tests the suffix.
- **A NUL byte in a string column is a 500, not a 400.** asyncpg refuses the write with
  `CharacterNotInRepertoireError: invalid byte sequence for encoding "UTF8": 0x00`, so a request
  carrying `"filename": "dr\0awing.pdf"` used to get past every check in `upload_file` and blow
  up in the commit. `str.isprintable()` is False for NUL and for every other control character, so
  one call covers the whole class.
- **`HttpTestingController.expectOne(url)` matches the full URL including the query
  string.** Passing `` `${apiUrl}/chats/` `` to a request that now carries `?page=0&...`
  fails to match with an unhelpful "Expected no open requests", and the error names the
  URL it did find. Match with a predicate on `r.url` plus `r.params.get(...)`, and prefer
  that when the params are the thing under test.
- **Client-side sorting does not survive pagination.** The history page sorted the whole
  array in a `computed()`, which is exactly what stops being possible once the server
  returns one page: page 2 under one order has nothing to do with page 2 under another.
  The same trap applies to any list that gains paging later, so "sort in the browser" in
  this codebase is a decision with an expiry date.
- **A loading flag that hides the table makes paging look like a crash.** With
  `@if (loading())` around the whole list, clicking "next page" replaced the rows with a
  skeleton and any assertion on the pager failed because the pager was gone. Gating the
  skeleton on `loading() && sessions().length === 0` keeps the current page on screen
  while the next one is in flight, which is also what the user expects.

- **`ScalarResult.all()` exhausts the result; a second iteration silently yields nothing.**
  `cleanup_orphan_attachments` in `app/tasks/files.py` calls `orphans.all()` for the count and
  then iterates `orphans` again to build the S3 delete tasks, so it always logs `count=0` and
  never deletes an object. The bulk `delete(Attachment)` after it is a separate statement and
  does still run, so rows disappear and the S3 objects are left to the lifecycle rules. Not
  fixed here (issue #47 does not own it); collect into a list once instead of iterating twice.
- **`Literal` in a response schema turns a stale cache value into a 500.** `list_attachments`
  maps any Redis status it does not recognise to `unknown` rather than handing it to
  `ChatSessionAttachmentSchema`, because a 500 for a cosmetic label is the wrong trade.
- **A frontend "delete" that only forgets locally is a data leak.** `DragNDropComponent.removeItem`
  dropped the row from its signal and nothing else, so the file stayed on the session and was
  attached to the next message. The upload observable now reports the attachment id as soon as
  the backend registers the file, which is what makes the delete reachable at all.
- **`redis.mget([])` never reaches the server, and that is redis-py, not Redis.** `MGET` with
  no keys is a protocol error, so `list_attachments` would have 500ed on a session with no
  attachments if the client passed it through; `redis.commands.core.mget` substitutes an
  `EMPTY_RESPONSE` option and answers `[]` locally. Convenient, but it is a client detail, so
  a route that relied on it is one redis-py rewrite away from a 500.
