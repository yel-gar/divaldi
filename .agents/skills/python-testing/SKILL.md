---
name: python-testing
description: Conventions for pytest, pytest-asyncio, testcontainers and fixtures in the divaldi backend and processing packages. Use when writing tests, adding fixtures, or debugging a failing test suite.
---

# Python testing — divaldi conventions

pytest >= 9.1, pytest-asyncio >= 1.4 (auto mode), httpx `ASGITransport`,
testcontainers for PostgreSQL and Redis.

## Running

```bash
poetry -C backend run pytest                                  # needs a Docker daemon
poetry -C backend run pytest --cov                            # branch-coverage report
poetry -C backend run pytest tests/test_migrations.py          # the migration drift gate
poetry -C processing run pytest -v                             # pure, no Docker
```

**Tests may be run locally.** The full application may not; see AGENTS.md.

## Coverage

- `pytest-cov` is a `dev` dependency of the backend package. `source = ["app"]` with
  `branch = true`.
- The threshold is `fail_under` in `backend/pyproject.toml`, currently `0`, so the run
  reports without blocking. **Set it to 90 to make coverage a gate**; nothing else changes.
- `--cov` alone prints the terminal report and writes no file. Add
  `--cov-report=json` when a `coverage.json` artifact is wanted, since
  `[tool.coverage.json] output` only applies when that report is actually requested.
- Read the `Missing` column as a work list, not the percentage as a score. It points at the
  untested chat routes and TaskIQ workers.
- A `pre-push` pre-commit hook and `.github/workflows/backend-coverage.yml` both run this.
  After adding a pre-push hook, run `pre-commit install --hook-type pre-push`, otherwise a
  clone that installed only `pre-commit` and `commit-msg` silently skips it.

## Layout and naming

- `backend/tests/test_*.py`, flat, with `tests/__init__.py` present.
- `processing/tests/test_*.py` plus `processing/tests/conftest.py`, which inserts
  `processing/src` into `sys.path` so the tests run without installing the package.
- `pyproject.toml` sets `testpaths = ["tests"]`, `asyncio_mode = "auto"`, and both
  `asyncio_default_fixture_loop_scope` and `asyncio_default_test_loop_scope` to `"session"`.

## Writing a test

```python
@pytest.mark.asyncio
async def test_something(client, test_user):
    res = await client.post("/api/v1/auth/login", json={"username": "u", "password": "p"})
    assert res.status_code == 200
```

- Tests are `async def`. `@pytest.mark.asyncio` is written explicitly even though auto mode is
  on; match the surrounding file.
- The `httpx.AsyncClient` **carries cookies between requests**, mirroring a browser. A test
  that logs in and then calls an admin route without re-logging in will pass auth. Use a fresh
  client for "logged out" assertions.

## Key fixtures in `backend/tests/conftest.py`

| Fixture | Purpose |
|---|---|
| `env` | autouse; monkeypatches `SBER_API_KEY`, `SBER_API_SCOPE`, `RABBITMQ_*`, `TASKIQ_API_TOKEN`, `MINIO_ROOT_PASSWORD` |
| `postgres_container` / `redis_container` | session-scoped testcontainers |
| `engine` | session-scoped; builds the schema with `Base.metadata.create_all` |
| `db_session` | per-test session, truncated |
| `client` | `httpx.AsyncClient` over `ASGITransport`, base URL `http://test/api/v1` |
| `test_user`, `test_100_users`, `test_admin_user`, `admin_client` | ready-made principals |

The autouse `env` fixture is **mandatory in practice**: `app/providers/containers.py` reads
`SBER_API_KEY` and `SBER_API_SCOPE` at import time, so without it every test errors on import
rather than on an assertion.

## Migration testing

`tests/test_migrations.py` shells out to `alembic upgrade head`, `downgrade base` and
`alembic check`, and fails with a message naming the command to run when models drift. Treat
it as a real gate: change a model, generate the migration, do not try to weaken the test.

## Gotchas

- **Backend tests require a running Docker daemon.** Failures appear at fixture setup, not at
  an assertion, so read the error before suspecting the code.
- `testcontainers` uses `postgres:18-alpine` with the `asyncpg` driver, and `redis:8`. This
  matches production rather than using SQLite.
- The app lifespan is **not** run in tests; the DB is created and disposed by session fixtures
  instead.
- Ruff's `per-file-ignores` sets `ARG001` (unused function argument) as allowed under
  `tests/**/*.py`, so fixture-driven tests with unused parameters are fine.

## Language version: Python 3.14

Both Poetry projects pin `requires-python = ">=3.14,<4"`, and black and ruff are set to
`target-version = ["py314"]`. Syntax that looks archaic can therefore be correct.

The one that bites: **PEP 758 allows `except ValueError, TypeError:` without parentheses.**
It appears in `processing/src/processing/calculator/calc.py` and six times in
`processing/src/processing/parser/dxf_parser.py`, and black with `target-version = "py314"`
formats it exactly that way.

```python
# correct here, and what black produces -- do not "fix" it
try:
    prices[str(name).strip()] = float(value)
except ValueError, TypeError:
    continue
```

It reads as Python 2 to almost everyone, and has been misreported as a critical bug more than
once. Adding parentheses would fight the formatter and be reverted by the next `black` run.

## Verify

```bash
poetry -C backend run black --check .
poetry -C backend run ruff check .
poetry -C backend run pytest
poetry -C backend run pytest --cov     # reports coverage; enforced via fail_under
```

Coverage artifacts (`.coverage*`, `coverage.json`, `coverage.xml`, `htmlcov/`) are
gitignored. Do not commit them.
