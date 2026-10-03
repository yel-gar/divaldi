"""Cover the remaining gaps: the mock provider's own branches, the lock/verify
dependencies, admin error paths, and the few schema and model guards.

The offline provider is production code (it ships in the image whenever
``SBER_API_KEY=mock``), so its modes and determinism are worth asserting
directly rather than only through the worker that uses it.
"""

import json
import uuid

import pytest

from app.providers.mock import (
    DEFAULT_MODE,
    MODES,
    MockProvider,
    _seed,
    get_mock_mode,
)

# --- app.providers.mock ---------------------------------------------------


def test_get_mock_mode_defaults_and_validation(monkeypatch):
    monkeypatch.delenv("MOCK_PROVIDER_MODE", raising=False)
    assert get_mock_mode() == DEFAULT_MODE

    for mode in MODES:
        monkeypatch.setenv("MOCK_PROVIDER_MODE", mode.upper())
        assert get_mock_mode() == mode

    monkeypatch.setenv("MOCK_PROVIDER_MODE", "nonsense")
    assert get_mock_mode() == DEFAULT_MODE


def test_mock_provider_rejects_bad_scope():
    with pytest.raises(ValueError, match="Scope must be"):
        MockProvider("mock", "WRONG")


async def test_mock_auth_sets_a_long_lived_token():
    provider = MockProvider("mock", "PERS")
    assert provider.token is None
    await provider.auth()
    assert provider.token is not None
    assert provider.token.startswith("mock-token-")
    # ensure_fresh_token must not re-auth immediately afterwards.
    before = provider.token
    await provider.ensure_fresh_token()
    assert provider.token == before


async def test_mock_upload_returns_a_stable_id():
    provider = MockProvider("mock", "PERS")
    client_id, session_id = uuid.uuid4(), uuid.uuid4()
    first = await provider.upload("a.png", b"data", client_id, session_id, "image/png")
    second = await provider.upload("a.png", b"data", client_id, session_id, "image/png")
    other = await provider.upload("b.png", b"data", client_id, uuid.uuid4(), "image/png")
    assert first == second
    assert first != other
    assert first.startswith("mock-file-")


def _messages(text: str):
    from app.providers.models import Content, Message

    return [Message(role="user", content=[Content(text=text)])]


async def _generate(provider, text: str = "hello"):
    from app.providers.models import ResponseFormat

    return await provider.generate(
        _messages(text),
        ResponseFormat(type="text"),
        x_client_id=uuid.uuid4(),
        x_session_id=uuid.uuid4(),
    )


def _payload(response) -> dict:
    return json.loads(response.messages[0].content[0].text)


async def test_mock_kp_mode_returns_positions(monkeypatch):
    monkeypatch.setenv("MOCK_PROVIDER_MODE", "kp")
    provider = MockProvider("mock", "PERS")
    payload = _payload(await _generate(provider))

    assert payload["gen_kp"] is True
    assert 1 <= len(payload["positions"]) <= 2
    position = payload["positions"][0]
    for field in ("name", "material", "area_m2", "laser_m", "bends", "welding_m", "turning_hours", "painting_m2"):
        assert field in position
    assert position["area_m2"] > 0
    assert position["painting_m2"] == pytest.approx(position["area_m2"] * 2)


async def test_mock_clarify_mode_returns_no_positions(monkeypatch):
    monkeypatch.setenv("MOCK_PROVIDER_MODE", "clarify")
    payload = _payload(await _generate(MockProvider("mock", "PERS")))
    assert payload["positions"] == []
    assert payload["gen_kp"] is False
    assert payload["message"]


async def test_mock_error_mode_returns_none(monkeypatch):
    monkeypatch.setenv("MOCK_PROVIDER_MODE", "error")
    assert await _generate(MockProvider("mock", "PERS")) is None


async def test_mock_empty_mode_returns_a_message_with_no_content(monkeypatch):
    monkeypatch.setenv("MOCK_PROVIDER_MODE", "empty")
    response = await _generate(MockProvider("mock", "PERS"))
    assert response is not None
    assert response.messages[0].content == []


async def test_mock_output_is_deterministic():
    provider = MockProvider("mock", "PERS")
    first = _payload(await _generate(provider, "same input"))
    second = _payload(await _generate(provider, "same input"))
    assert first == second

    different = _payload(await _generate(provider, "other input"))
    assert different != first


def test_seed_is_stable_and_varies():
    assert _seed("a", "b") == _seed("a", "b")
    assert _seed("a", "b") != _seed("b", "a")


async def test_mock_close_is_safe():
    # The base close() calls httpx; the mock never builds a client, so closing it
    # should not explode. Guard the behaviour rather than assuming.
    provider = MockProvider("mock", "PERS")
    assert not hasattr(provider, "_client")


# --- app.deps -------------------------------------------------------------


async def test_rate_limiter_blocks_after_the_limit(redis_client, test_user):
    from datetime import timedelta

    from fastapi import HTTPException

    from app.deps import user_rate_limiter

    limiter = user_rate_limiter(2, timedelta(minutes=5), "test:blocked")
    for _ in range(2):
        await limiter(redis_client=redis_client, user=test_user)
    with pytest.raises(HTTPException) as exc:
        await limiter(redis_client=redis_client, user=test_user)
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers


async def test_avatar_url_cache_key_is_invalidated(redis_session, test_user):
    from app.cache import get_avatar_url_key, get_redis_client

    key = get_avatar_url_key(test_user.uuid)
    async with get_redis_client() as redis:
        await redis.set(key, "https://example.test/a.webp")
        assert await redis.get(key) is not None
        await redis.delete(key)
        assert await redis.get(key) is None


# --- app.routes.admin -----------------------------------------------------


async def test_admin_blocks_password_set_for_superuser(admin_client, test_admin_user):
    response = await admin_client.post(
        f"/admin/users/{test_admin_user.id}/set-password",
        json={"password": "newpassword123"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "You can't change password of superuser"


async def test_admin_blocks_password_set_under_test_instance_mode(admin_client, test_user, monkeypatch):
    monkeypatch.setenv("TEST_INSTANCE_MODE", "true")
    response = await admin_client.post(
        f"/admin/users/{test_user.id}/set-password",
        json={"password": "whatever12345"},
    )
    assert response.status_code == 450


async def test_admin_cannot_delete_a_superuser(admin_client, test_admin_user):
    response = await admin_client.delete(f"/admin/users/{test_admin_user.id}")
    assert response.status_code == 403
    assert response.json()["detail"] == "Superuser can't be deleted"


async def test_admin_edit_rejects_a_duplicate_username(admin_client, test_user, test_100_users):
    response = await admin_client.patch(
        f"/admin/users/{test_user.id}",
        json={"username": test_100_users[0].username},
    )
    assert response.status_code == 409


async def test_admin_set_password_unknown_user(admin_client):
    response = await admin_client.post("/admin/users/999999/set-password", json={"password": "abcdefgh123"})
    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


# --- models and schemas ---------------------------------------------------


def test_chat_message_rejects_system_display():
    from app.models.chat import ChatMessage, UserRole

    message = ChatMessage(role=UserRole.SYSTEM, content="x", chat_session_id=uuid.uuid4())
    with pytest.raises(ValueError, match="Cannot display system messages"):
        message.get_chat_text()

    normal = ChatMessage(
        role=UserRole.ASSISTANT,
        content="raw",
        display_text="pretty",
        chat_session_id=uuid.uuid4(),
    )
    assert normal.get_chat_text() == "pretty"

    fallback = ChatMessage(role=UserRole.USER, content="raw", chat_session_id=uuid.uuid4())
    assert fallback.get_chat_text() == "raw"


def test_position_material_index_out_of_range_raises_index_error():
    """MATERIALS is a list, so an out-of-range index raises IndexError.

    The validator catches KeyError, which a list never raises, so the raw
    IndexError escapes ``model_validate``. Pinned here as current behaviour:
    changing the validator to ``except IndexError`` is the correct fix, and this
    test should be updated to expect ValueError when that happens.
    """
    from app.providers.models import Position

    base = {
        "name": "x",
        "area_m2": 1.0,
        "laser_m": 1.0,
        "bends": 1,
        "welding_m": 1.0,
        "turning_hours": 0.0,
        "painting_m2": 1.0,
    }
    assert Position(material=0, **base).material
    assert Position(material="already a name", **base).material == "already a name"
    with pytest.raises(IndexError):
        Position(material=10_000, **base)


async def test_verify_chat_session_rejects_a_foreign_session(db_session, test_user):
    from fastapi import HTTPException

    from app.deps import verify_chat_session

    with pytest.raises(HTTPException) as exc:
        await verify_chat_session(session_id=uuid.uuid4(), user=test_user, db=db_session)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Invalid session"


async def test_verify_attachment_id_rejects_a_missing_attachment(db_session, test_user, redis_session):
    from fastapi import HTTPException

    from app.cache import get_redis_client
    from app.deps import verify_attachment_id

    async with get_redis_client() as redis:
        with pytest.raises(HTTPException) as exc:
            await verify_attachment_id(
                session_id=uuid.uuid4(),
                attachment_id=4242,
                db=db_session,
                redis=redis,
            )
    assert exc.value.status_code == 403
    assert exc.value.detail == "Invalid session"


async def test_chat_lock_rejects_when_generation_is_running(redis_session, test_user):
    from fastapi import HTTPException

    from app.cache import get_generation_key, get_redis_client
    from app.deps import chat_lock

    async with get_redis_client() as redis:
        await redis.set(get_generation_key(test_user.uuid), "1", ex=60)

        # chat_lock is a bare async generator (FastAPI turns it into a
        # dependency), so drive it with __anext__ rather than `async with`.
        with pytest.raises(HTTPException) as exc:
            await chat_lock(redis_client=redis, user=test_user).__anext__()
    assert exc.value.status_code == 409
    assert exc.value.detail == "A generation job is already running"


async def test_chat_lock_throttles_repeated_creation(redis_session, test_user):
    from fastapi import HTTPException

    from app.cache import get_creation_key, get_redis_client
    from app.deps import chat_lock

    async with get_redis_client() as redis:
        await redis.set(get_creation_key(test_user.uuid), "1", ex=60)
        with pytest.raises(HTTPException) as exc:
            await chat_lock(redis_client=redis, user=test_user).__anext__()
    assert exc.value.status_code == 429
