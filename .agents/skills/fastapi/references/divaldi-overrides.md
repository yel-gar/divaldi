# divaldi overrides for the generic FastAPI skill

The upstream `SKILL.md` in this directory is the generic FastAPI guide. **Where it
disagrees with this file, this file wins.** These are the only divergences; everything else
in the generic guide applies.

Read this before writing any route, dependency or schema.

---

## 1. Dependency injection: use `Annotated` aliases, never `= Depends(...)`

The generic guide shows `db: AsyncSession = Depends(get_db)`. **Divaldi does not do that.**
`backend/app/deps.py` exports `Annotated[...]` aliases used as the parameter type directly,
with no `Depends()` at the call site:

```python
# divaldi
from app.deps import AdminUser, DbSession, RedisSession

@router.post("/users/{user_id}/password")
async def admin_set_password(user_id: int, admin: AdminUser, db: DbSession):
    ...
```

Existing aliases: `DbSession`, `CurrentUser`, `AdminUser`, `RedisSession`,
`VerifiedMessageSession`, `VerifiedAttachmentId`, `S3PublicClient`, `S3InternalClient`.

To add a dependency, define the async function in `deps.py`, export an `Annotated[...]`
alias, then attach it to the router.

## 2. There is no service or repository layer

The generic guide may suggest repositories or service classes. **Divaldi queries the
database directly from routes and tasks.** Do not introduce a repository unless the user
explicitly asks for one.

## 3. SQLAlchemy 2.0 only, never SQLModel

`Mapped[]` / `mapped_column` with explicit `nullable`, in models under `backend/app/models/`.
`from __future__ import annotations` is required at the top of every model file so
`Mapped[]` resolves string annotations. `models/__init__.py` auto-imports every submodule
via `pkgutil`; never add manual imports. See the `sqlalchemy-async` skill.

## 4. Blocking work must be offloaded

`await asyncio.to_thread(...)` for PyMuPDF, openpyxl, Pillow, the DXF parser. Never block
the event loop. The generic guide's advice about sync `def` endpoints for threadpool
execution does **not** apply: every handler here is `async def`.

## 5. Logging is structlog, never print

```python
import structlog
log = structlog.stdlib.get_logger(__name__)
log = log.bind(attachment_id=...)   # bind context per task
```

## 6. Docstrings and documented errors are mandatory

Chat routes carry a multi-line docstring **and** a `responses={...}` map for 401 / 403 /
404 / 409 / 429. Keep this pattern on new endpoints.

## 7. Naming

| Thing | Convention | Example |
|---|---|---|
| Handler | `<domain>_<action>` | `admin_get_users`, `send_message` |
| Schema | `*Schema`, or `*Request` / `*Response` | `UserSchema`, `MessageResponse` |
| Cache key | `get_*_key(...)` in `cache.py` | `get_generation_key(uuid)` |
| S3 key | `get_*_key(...)` in `storage.py` | `get_attachment_key(id)` |

`prefix` and `tags` are set on the `APIRouter` itself, not in `include_router`.

## 8. Project-specific behaviours

- The API is mounted at **`/api/v1`**. Docs at `/api/v1/docs` are served **only when
  `DEBUG` is truthy**.
- Auth is a cookie session (`session_token`, httpOnly, 7 days, argon2-cffi hashes), not JWT.
- `TEST_INSTANCE_MODE` gates destructive admin/user mutations with **HTTP 450**. Intentional.
- `app/providers/containers.py` constructs the GigaChat provider at import time from
  `os.environ`, so importing any route module requires `SBER_API_KEY` and `SBER_API_SCOPE`.
- **Python 3.14 floor:** PEP 758 brace-less `except ValueError, TypeError:` is valid and is
  what black emits at `target-version = "py314"`. Do not add parentheses.
- The LLM contract lives in `app/harness.py`. `MATERIALS` order is a data contract because
  the model returns `material` as an integer index. Append only.

## 9. Testing

- **`SBER_API_KEY=mock` is not a test-only hack.** It selects `app/providers/mock.py`, a
  real `AIClient` implementation that ships in the image. Its mode comes from
  `MOCK_PROVIDER_MODE` (`kp`, `clarify`, `empty`, `error`) and its output is
  deterministic, so tests and e2e never depend on an LLM.
- **PostgreSQL, Redis and MinIO are real testcontainers**, not fakes. Only the LLM and the
  `httpx` calls inside `SberProvider` (via `httpx.MockTransport`) are stubbed.
- **Worker tasks are not awaitable.** Use `tests.helpers.run_task(task, *args)`, which
  calls `task.original_func`, so nothing is enqueued to RabbitMQ.
- **Worker tests must commit rows through the engine**, not via the `db_session` fixture:
  the worker's `tsq_db` opens its own connection and cannot see an uncommitted
  transaction, so such a test silently asserts against an empty database.
- **Patch `app.cache.get_redis_pool`, not `get_redis_client`.** Task modules bind
  `get_redis_client` into their own namespace with `from ... import`, so patching the
  defining module alone does not affect them.
- **Live API tests carry `@pytest.mark.live`** and are deselected by
  `addopts = "-m 'not live'"`. They cost money per call; run them only deliberately with a
  real key via `pytest -m live`.

## 10. Dependencies

Add Python dependencies with **`poetry add`** from `backend/` or `processing/`, never by
hand-editing `pyproject.toml`. There is no `requirements.txt` and no `uv`.

## 11. Verify

```bash
poetry -C backend run black --check .
poetry -C backend run ruff check .
poetry -C backend run pytest      # needs a Docker daemon (testcontainers)
```
