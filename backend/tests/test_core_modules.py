"""Tests for the small cross-cutting modules.

These are the pieces the route and worker suites reach only indirectly:
URL/origin assembly, engine construction, the app lifespan, and the session
cleanup cron.
"""

import pytest

from app.cache import get_redis_client
from app.tasks.users import cleanup_expired_sessions
from tests.helpers import run_task

# --- app.util -------------------------------------------------------------


def test_get_database_url_builds_from_env(monkeypatch):
    from app.util import get_database_url

    get_database_url.cache_clear()
    monkeypatch.setenv("POSTGRES_USER", "u")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p")
    monkeypatch.setenv("POSTGRES_HOST", "h")
    monkeypatch.setenv("POSTGRES_DB", "d")
    monkeypatch.delenv("POSTGRES_PORT", raising=False)

    assert get_database_url() == "postgresql+asyncpg://u:p@h:5432/d"

    monkeypatch.setenv("POSTGRES_PORT", "5431")
    get_database_url.cache_clear()
    assert get_database_url().endswith(":5431/d")
    get_database_url.cache_clear()


def test_get_debug_truthiness(monkeypatch):
    from app.util import get_debug

    # get_debug is @cache'd, so each value needs the cache cleared or the first
    # result is returned forever.
    # The implementation lowercases, so mixed case must count as false.
    for value in ("0", "no", "false", "NO", "False"):
        monkeypatch.setenv("DEBUG", value)
        get_debug.cache_clear()
        assert get_debug() is False, f"DEBUG={value!r} should be False"
    for value in ("1", "yes", "true", "anything"):
        monkeypatch.setenv("DEBUG", value)
        get_debug.cache_clear()
        assert get_debug() is True, f"DEBUG={value!r} should be True"
    get_debug.cache_clear()


def test_get_origins_production_requires_both_urls(monkeypatch):
    from app.util import get_debug, get_origins

    get_origins.cache_clear()
    get_debug.cache_clear()
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.delenv("BACKEND_URL", raising=False)
    get_origins.cache_clear()
    with pytest.raises(RuntimeError):
        get_origins()

    monkeypatch.setenv("BACKEND_URL", "http://backend")
    with pytest.raises(RuntimeError):
        get_origins()

    monkeypatch.setenv("FRONTEND_URL", "http://frontend")
    get_origins.cache_clear()
    assert get_origins() == ["http://backend", "http://frontend"]
    get_origins.cache_clear()
    get_debug.cache_clear()


def test_get_origins_debug_falls_back_to_wildcard(monkeypatch):
    from app.util import get_debug, get_origins

    get_origins.cache_clear()
    get_debug.cache_clear()
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.delenv("BACKEND_URL", raising=False)
    assert get_origins() == ["*"]
    get_origins.cache_clear()
    get_debug.cache_clear()


def test_normalize_image_rejects_non_image():
    from app.util import normalize_image

    with pytest.raises(ValueError):
        normalize_image(b"definitely not an image")


# --- app.database ---------------------------------------------------------


def test_get_engine_is_cached(monkeypatch):
    from app import database

    database.get_engine.cache_clear()
    monkeypatch.setattr(database, "get_database_url", lambda: "postgresql+asyncpg://u:p@localhost:5432/d")
    first = database.get_engine()
    assert database.get_engine() is first
    database.get_engine.cache_clear()


def test_get_session_maker_is_cached(monkeypatch):
    from app import database

    database.get_session_maker.cache_clear()
    monkeypatch.setattr(database, "get_database_url", lambda: "postgresql+asyncpg://u:p@localhost:5432/d")
    first = database.get_session_maker()
    assert database.get_session_maker() is first
    database.get_session_maker.cache_clear()


async def test_get_db_yields_a_session(monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.database import get_db

    maker = async_sessionmaker()
    monkeypatch.setattr("app.database.get_session_maker", lambda: maker)
    generator = get_db()
    session = await generator.__anext__()
    assert session is not None
    with pytest.raises(StopAsyncIteration):
        await generator.__anext__()


# --- app.main -------------------------------------------------------------


async def test_lifespan_starts_and_stops_the_broker(monkeypatch):
    from app.main import lifespan

    started = []

    class FakeBroker:
        async def startup(self):
            started.append("startup")

        async def shutdown(self):
            started.append("shutdown")

    fake_module = type("m", (), {"broker": FakeBroker()})
    monkeypatch.setitem(__import__("sys").modules, "app.tasks.conf.broker", fake_module)

    async with lifespan(None):
        assert started == ["startup"]
    assert started == ["startup", "shutdown"]


def test_main_routes_are_registered():
    from app.main import app

    # This FastAPI version nests routers as `_IncludedRouter` objects, which
    # carry the prefix on the parent APIRouter and have no `.path` themselves.
    # Recursing through `original_router` reaches the real leaf routes.
    def collect(routes, prefix=""):
        found = set()
        for route in routes:
            path = getattr(route, "path", None)
            if path:
                found.add(f"{prefix}{path}")
            original = getattr(route, "original_router", None)
            if original is not None:
                found |= collect(original.routes, f"{prefix}{original.prefix}")
        return found

    paths = collect(app.routes)

    # Segment names repeat the router prefix, so "/api/v1/auth/auth/login" is the
    # real mounted path. Assert on that rather than a hand-guessed string.
    assert "/api/v1/auth/auth/login" in paths
    assert any(p.startswith("/api/v1/chats") for p in paths)
    assert any(p.startswith("/api/v1/users") for p in paths)
    assert any(p.startswith("/api/v1/admin") for p in paths)


# --- app.tasks.users ------------------------------------------------------


async def test_cleanup_expired_sessions_deletes_only_expired(engine, task_db):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.auth import hash_password
    from app.models.auth import Session, User

    # The worker opens its own session through tsq_db, so rows must be COMMITTED,
    # not left pending in a rolled-back transaction.
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with maker() as db:
        user = User(username="sessions-user", password_hash=hash_password("password1234"))
        db.add(user)
        await db.commit()
        await db.refresh(user)

        # Session is keyed by token, not a surrogate id.
        expired_token = "expired-token-for-cleanup-test"
        alive_token = "alive-token-for-cleanup-test"
        expired = Session(
            user_id=user.id,
            token=expired_token,
            expires_at=datetime.now(UTC) - timedelta(days=1),
        )
        alive = Session(
            user_id=user.id,
            token=alive_token,
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        db.add_all([expired, alive])
        await db.commit()
        user_id = user.id

    await run_task(cleanup_expired_sessions)

    async with maker() as db:
        remaining = set((await db.scalars(select(Session.token))).all())
    assert expired_token not in remaining
    assert alive_token in remaining

    async with maker() as db:
        await db.delete(await db.get(Session, alive_token))
        await db.delete(await db.get(User, user_id))
        await db.commit()


# --- app.cache ------------------------------------------------------------


async def test_redis_pool_is_reused(redis_session):
    from app.cache import get_redis_pool

    assert get_redis_pool() is get_redis_pool()
    async with get_redis_client() as redis:
        assert await redis.ping() is True


def test_validation_errors_survive_non_finite_input():
    """A validation error quoting a NaN must still be serialisable.

    Starlette's `JSONResponse` writes with `allow_nan=False`, and FastAPI's default
    handler puts the offending input straight into the detail, so a body containing a
    `NaN` literal turned a clean 422 into a crash: the client got a broken response
    instead of the message naming the offending field. The handler in `app.main`
    replaces non-finite numbers with their text form, which is what this pins down.
    """
    import asyncio
    import json as jsonlib

    from fastapi.exceptions import RequestValidationError

    from app.main import validation_exception_handler

    error = RequestValidationError(
        [
            {
                "type": "finite_number",
                "loc": ("body", "parameters", "bending_rate_per_hour"),
                "msg": "Input should be a finite number",
                "input": float("nan"),
            }
        ]
    )

    response = asyncio.run(validation_exception_handler(None, error))

    assert response.status_code == 422
    body = jsonlib.loads(response.body)
    assert body["detail"][0]["input"] == "nan"
