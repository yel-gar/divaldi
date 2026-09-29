---
name: fastapi
description: Conventions for writing FastAPI routes, dependencies, schemas and response models in the divaldi backend. Use when adding or changing any endpoint, router, Pydantic schema, or dependency in backend/app/routes/, backend/app/schemas/, or backend/app/deps.py.
---

# FastAPI — divaldi conventions

Python 3.14, FastAPI >= 0.141, Pydantic v2, SQLAlchemy 2.0 async.
The API is mounted at `/api/v1`. Docs are served only when `DEBUG` is truthy.

## The dependency idiom

`backend/app/deps.py` exports `Annotated[...]` aliases. Use them as the parameter type;
never wrap them in `Depends()` at the call site.

```python
from fastapi import APIRouter, Depends, HTTPException
from app.deps import AdminUser, DbSession, RedisSession, user_rate_limiter

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_login), Depends(user_rate_limiter(10, timedelta(minutes=1), "admin:users"))],
)


@router.get("/users")
async def admin_get_users(db: DbSession, admin: AdminUser):
    ...
```

Available aliases:

| Alias | Resolves to |
|---|---|
| `DbSession` | `AsyncSession` from `get_db` |
| `CurrentUser` | the logged-in `User` |
| `AdminUser` | `CurrentUser` plus a superuser check, raising 403 |
| `RedisSession` | `redis.asyncio.Redis`, `yield`ed and closed |
| `VerifiedMessageSession` | session plus ownership check for a chat |
| `VerifiedAttachmentId` | attachment id plus ownership check |
| `S3PublicClient` / `S3InternalClient` | aioboto3 S3 clients |

To add a dependency, write the async function in `deps.py`, export an `Annotated[...]`
alias, and attach it to a router's `dependencies=[...]`.

## Routers

- One `APIRouter` per domain file in `app/routes/`: `auth.py`, `users.py`, `admin.py`, `chat.py`.
- Set `prefix` and `tags` on the router, not in `main.py`'s `include_router`.
- Handler names are `<domain>_<action>`, for example `admin_get_users`, `users_me`, `send_message`.
- One HTTP operation per function. Do not branch on the method inside a handler.

## Response models

- Declare a Pydantic return type or `response_model=`; the route files use `response_model=`.
- Set `model_config = {"from_attributes": True}` on anything derived from an ORM model.
- Response schemas use the `*Schema` suffix (`UserSchema`, `AdminUserSchema`, `ChatMessageSchema`);
  request/response wrappers use `*Request` and `*Response`.
- Shared building blocks live in `app/schemas/__init__.py`, for example `PasswordField`
  (`Annotated[str, Field(min_length=8, max_length=128)]`).
- Return a declared model rather than a raw dict of internal columns, so fields are filtered out.

## Docstrings and documented errors

Chat routes carry a docstring and an explicit `responses={...}` map. Keep it:

```python
@router.post(
    "/{session_id}/messages",
    response_model=MessageResponse,
    responses={401: {}, 403: {}, 404: {}, 409: {}, 429: {}},
)
async def send_message(...):
    """Send a user message and kick off generation.

    Returns 202 immediately; poll GET /chats/{id}/result for the outcome.
    """
```

## Async rules

- Handlers are `async def`. Never introduce a sync `def` endpoint.
- Offload blocking work with `await asyncio.to_thread(...)` for Pillow, openpyxl and PyMuPDF.
- DB access is `await db.execute(...)` with an explicit `db.commit()`. There is no unit of work.

## Error handling

- Raise `HTTPException(status.HTTP_4XX, "message")` using constants from `starlette.status`,
  not raw integers.
- Model and validation failures raise a custom exception that the route maps to a status.
- `TEST_INSTANCE_MODE` gates destructive mutations with HTTP 450. That is intentional, not a typo.
- Rate limits return 429 with a `Retry-After` header, as implemented in `user_rate_limiter`.

## Gotchas

- `app/providers/containers.py` builds the GigaChat provider at import time from
  `os.environ`, so importing a route module requires `SBER_API_KEY` and `SBER_API_SCOPE`.
- Logging is `structlog` via `structlog.stdlib.get_logger(__name__)`. No `print()`.
- There is no service layer; queries live in routes. Do not add a repository without asking.
- CORS origins come from `FRONTEND_URL` and `BACKEND_URL`, both required in production.

## Verify

```bash
poetry -C backend run black --check .
poetry -C backend run ruff check .
poetry -C backend run pytest          # needs a Docker daemon
```

Ruff enforces line length 120, `I` import order, `N` naming, `B` bugbear, `ASYNC`, `ARG`,
`PTH` and `RUF`. `alembic/versions/` is excluded from both tools.
