"""Tests for ``/users`` in :mod:`app.routes.users` and for ``normalize_image``.

Two of the avatar routes shell out to S3 and Redis for real (the ``s3`` and
``redis_session`` fixtures), and ``users_set_avatar_complete`` hands off to the
``process_avatar`` worker — that enqueue is replaced with an ``AsyncMock`` so
nothing lands in RabbitMQ.

The rate limiters on the avatar routes are keyed by user id, and every test gets
a freshly rolled-back database, so the same numeric id recurs between tests. The
``ratelimit`` keys are therefore cleared by a helper rather than relying on ids
happening to differ.
"""

import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import generate_token
from app.cache import get_avatar_url_key, get_avatar_waiting_key, get_ratelimit_key, get_redis_client
from app.models.auth import Session, User
from app.storage import (
    MAX_AVATAR_FILE_SIZE,
    get_s3_avatar_processed_key,
    get_s3_avatar_unprocessed_key,
)
from app.util import MAX_DIMENSION, normalize_image


def png_bytes(size: tuple[int, int] = (64, 48), color: tuple[int, int, int] = (200, 30, 30)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest_asyncio.fixture
async def kiq_avatar(monkeypatch):
    """Capture the ``process_avatar`` enqueue instead of publishing it."""
    from app.routes import users as users_routes

    mock = AsyncMock()
    monkeypatch.setattr(users_routes.process_avatar, "kiq", mock)
    return mock


@pytest_asyncio.fixture
async def clear_ratelimits(redis_session):
    """Drop every avatar rate-limit key, so tests never inherit a tripped limit."""

    async def _clear(user: User) -> None:
        async with get_redis_client() as redis:
            for scope in ("user:avatar", "user:avatar-complete"):
                await redis.delete(get_ratelimit_key(scope, user.id))

    return _clear


# ---------------------------------------------------------------------------
# GET /users/me
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_users_me_returns_the_current_user(client: AsyncClient, test_user: User):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.get("/users/me")

    assert response.status_code == 200
    assert response.json() == {
        "id": test_user.id,
        "username": "test",
        "first_name": None,
        "last_name": None,
        "role": "user",
    }


@pytest.mark.asyncio
async def test_users_me_requires_auth(client: AsyncClient):
    assert (await client.get("/users/me")).status_code == 401


@pytest.mark.asyncio
async def test_users_me_rejects_an_unknown_session(client: AsyncClient):
    client.cookies.set("session_token", "not-a-real-token")

    response = await client.get("/users/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid session"


# ---------------------------------------------------------------------------
# POST /users/me/set-password
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_password_changes_the_password(client: AsyncClient, test_user: User, db_session: AsyncSession):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "new-password-123"},
    )

    assert response.status_code == 200
    assert "invalidated" in response.json()["message"]

    await client.post("/auth/logout")
    assert (
        await client.post("/auth/login", json={"username": "test", "password": "new-password-123"})
    ).status_code == 200
    assert (await client.post("/auth/login", json={"username": "test", "password": "password1234"})).status_code == 401


@pytest.mark.asyncio
async def test_set_password_keeps_the_current_session_alive(
    client: AsyncClient, test_user: User, db_session: AsyncSession
):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "new-password-123"},
    )
    assert response.status_code == 200

    # The cookie was not rotated out from under the caller.
    assert (await client.get("/users/me")).status_code == 200


@pytest.mark.asyncio
async def test_set_password_invalidates_other_sessions(client: AsyncClient, test_user: User, db_session: AsyncSession):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    # A second, already-established session for the same user.
    other_token = generate_token()
    db_session.add(Session(token=other_token, user_id=test_user.id, expires_at=datetime.now(UTC) + timedelta(days=7)))
    await db_session.commit()

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "new-password-123"},
    )
    assert response.status_code == 200

    remaining = set((await db_session.execute(select(Session.token))).scalars().all())

    assert other_token not in remaining
    assert len(remaining) == 1


@pytest.mark.asyncio
async def test_set_password_wrong_current_password(client: AsyncClient, test_user: User):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "not-my-password", "new_password": "new-password-123"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Bad old password"


@pytest.mark.asyncio
async def test_set_password_rejects_a_too_short_password(client: AsyncClient, test_user: User):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "short"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_set_password_rejects_a_too_long_password(client: AsyncClient, test_user: User):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "a" * 129},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_set_password_requires_auth(client: AsyncClient):
    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "new-password-123"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_set_password_is_blocked_on_a_test_instance(client: AsyncClient, test_user: User, monkeypatch):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    monkeypatch.setenv("TEST_INSTANCE_MODE", "true")

    response = await client.post(
        "/users/me/set-password",
        json={"old_password": "password1234", "new_password": "new-password-123"},
    )

    assert response.status_code == 450
    assert "test instance" in response.json()["detail"]
    # The block happens before the credential check, so even a valid pair is refused.
    assert (await client.post("/auth/login", json={"username": "test", "password": "password1234"})).status_code == 200


# ---------------------------------------------------------------------------
# GET /users/me/avatar
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_avatar_without_an_avatar(client: AsyncClient, test_user: User, s3, redis_session):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.get("/users/me/avatar")

    assert response.status_code == 200
    assert response.json() == {"avatar_url": None}


@pytest.mark.asyncio
async def test_get_avatar_without_an_avatar_caches_the_miss(client: AsyncClient, test_user: User, s3, redis_session):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    await client.get("/users/me/avatar")

    async with get_redis_client() as redis:
        assert await redis.get(get_avatar_url_key(test_user.uuid)) == "0"


@pytest.mark.asyncio
async def test_get_avatar_returns_a_presigned_url(client: AsyncClient, test_user: User, s3, s3_put, redis_session):
    await s3_put(
        png_bytes(),
        get_s3_avatar_processed_key(test_user.uuid),
        bucket="avatars",
        content_type="image/webp",
    )
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.get("/users/me/avatar")

    assert response.status_code == 200
    url = response.json()["avatar_url"]
    assert url is not None
    assert "avatars" in url


@pytest.mark.asyncio
async def test_get_avatar_serves_the_cached_miss(client: AsyncClient, test_user: User, s3, redis_session):
    # "0" is the sentinel the route writes for "there is no avatar", so the
    # cached branch has to distinguish it from a real URL.
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    async with get_redis_client() as redis:
        await redis.set(get_avatar_url_key(test_user.uuid), "0", ex=3600)

    response = await client.get("/users/me/avatar")

    assert response.status_code == 200
    assert response.json() == {"avatar_url": None}


@pytest.mark.asyncio
async def test_get_avatar_serves_the_cached_url(client: AsyncClient, test_user: User, s3, redis_session):
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    async with get_redis_client() as redis:
        await redis.set(get_avatar_url_key(test_user.uuid), "http://minio/avatars/cached", ex=3600)

    response = await client.get("/users/me/avatar")

    assert response.json() == {"avatar_url": "http://minio/avatars/cached"}


@pytest.mark.asyncio
async def test_get_avatar_requires_auth(client: AsyncClient, s3, redis_session):
    assert (await client.get("/users/me/avatar")).status_code == 401


# ---------------------------------------------------------------------------
# POST /users/me/set-avatar
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_avatar_returns_presigned_post_params(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-avatar",
        json={"content_type": "image/png", "file_size": 1024},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["url"]
    assert data["fields"]["Content-Type"] == "image/png"
    assert data["fields"]["key"] == get_s3_avatar_unprocessed_key(test_user.uuid)
    assert "policy" in data["fields"]
    # SigV4, not the legacy v2 form. The old assertion looked for "signature"
    # and passed only because the credentials defaulted to us-east-1, where
    # botocore still signs with SigV2. Any other region, including the "garage"
    # region this project now uses, produces "x-amz-signature".
    assert "x-amz-signature" in data["fields"]
    assert "x-amz-algorithm" in data["fields"]


@pytest.mark.asyncio
async def test_set_avatar_records_the_waiting_key(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    await client.post("/users/me/set-avatar", json={"content_type": "image/jpeg", "file_size": 10})

    async with get_redis_client() as redis:
        assert await redis.get(get_avatar_waiting_key(test_user.uuid)) == get_s3_avatar_unprocessed_key(test_user.uuid)


@pytest.mark.asyncio
async def test_set_avatar_clears_a_stale_waiting_key(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    async with get_redis_client() as redis:
        await redis.set(get_avatar_waiting_key(test_user.uuid), "a-previous-attempt", ex=600)

    await client.post("/users/me/set-avatar", json={"content_type": "image/png", "file_size": 10})

    async with get_redis_client() as redis:
        assert await redis.get(get_avatar_waiting_key(test_user.uuid)) == get_s3_avatar_unprocessed_key(test_user.uuid)


@pytest.mark.parametrize("content_type", ["image/gif", "application/pdf", "text/html"])
@pytest.mark.asyncio
async def test_set_avatar_rejects_a_bad_content_type(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits, content_type
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-avatar",
        json={"content_type": content_type, "file_size": 10},
    )

    assert response.status_code == 400
    assert "Bad content type" in response.json()["detail"]


@pytest.mark.asyncio
async def test_set_avatar_rejects_an_oversized_file(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-avatar",
        json={"content_type": "image/png", "file_size": MAX_AVATAR_FILE_SIZE + 1},
    )

    assert response.status_code == 400
    assert str(MAX_AVATAR_FILE_SIZE) in response.json()["detail"]


@pytest.mark.asyncio
async def test_set_avatar_accepts_exactly_the_maximum_size(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post(
        "/users/me/set-avatar",
        json={"content_type": "image/webp", "file_size": MAX_AVATAR_FILE_SIZE},
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_set_avatar_rate_limits(client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    statuses = [
        (await client.post("/users/me/set-avatar", json={"content_type": "image/png", "file_size": 10})).status_code
        for _ in range(4)
    ]

    assert statuses[:3] == [200, 200, 200]
    assert statuses[3] == 429


@pytest.mark.asyncio
async def test_set_avatar_requires_auth(client: AsyncClient, s3, redis_session):
    response = await client.post("/users/me/set-avatar", json={"content_type": "image/png", "file_size": 10})

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /users/me/set-avatar/complete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_avatar_complete_starts_processing(
    client: AsyncClient,
    test_user: User,
    s3,
    s3_put,
    redis_session,
    clear_ratelimits,
    kiq_avatar,
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    await client.post("/users/me/set-avatar", json={"content_type": "image/png", "file_size": 1024})
    await s3_put(
        png_bytes(),
        get_s3_avatar_unprocessed_key(test_user.uuid),
        bucket="avatars",
        content_type="image/png",
    )

    response = await client.post("/users/me/set-avatar/complete")

    assert response.status_code == 200
    assert response.json() == {"message": "Upload OK, processing started"}
    kiq_avatar.assert_awaited_once_with(test_user.uuid)


@pytest.mark.asyncio
async def test_set_avatar_complete_without_a_pending_upload(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits, kiq_avatar
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})

    response = await client.post("/users/me/set-avatar/complete")

    assert response.status_code == 404
    assert "not uploading anything" in response.json()["detail"]
    kiq_avatar.assert_not_awaited()


@pytest.mark.asyncio
async def test_set_avatar_complete_before_the_object_lands(
    client: AsyncClient, test_user: User, s3, redis_session, clear_ratelimits, kiq_avatar
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    # Presign the upload but never actually PUT the bytes.
    await client.post("/users/me/set-avatar", json={"content_type": "image/png", "file_size": 1024})

    response = await client.post("/users/me/set-avatar/complete")

    assert response.status_code == 400
    assert response.json()["detail"] == "Object has not been uploaded yet"
    kiq_avatar.assert_not_awaited()


@pytest.mark.asyncio
async def test_set_avatar_complete_rate_limits(
    client: AsyncClient, test_user: User, s3, s3_put, redis_session, clear_ratelimits, kiq_avatar
):
    await clear_ratelimits(test_user)
    await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    await client.post("/users/me/set-avatar", json={"content_type": "image/png", "file_size": 1024})
    await s3_put(
        png_bytes(),
        get_s3_avatar_unprocessed_key(test_user.uuid),
        bucket="avatars",
        content_type="image/png",
    )

    first = await client.post("/users/me/set-avatar/complete")
    second = await client.post("/users/me/set-avatar/complete")

    assert first.status_code == 200
    assert second.status_code == 429


@pytest.mark.asyncio
async def test_set_avatar_complete_requires_auth(client: AsyncClient, s3, redis_session):
    assert (await client.post("/users/me/set-avatar/complete")).status_code == 401


# ---------------------------------------------------------------------------
# normalize_image
# ---------------------------------------------------------------------------


def test_normalize_image_converts_png_to_webp():
    result = normalize_image(png_bytes())

    assert result[:4] == b"RIFF"
    assert result[8:12] == b"WEBP"


def test_normalize_image_produces_a_fixed_square():
    result = normalize_image(png_bytes(size=(640, 480)))

    with Image.open(BytesIO(result)) as image:
        assert image.format == "WEBP"
        assert image.size == (200, 200)
        assert image.mode == "RGB"


def test_normalize_image_converts_rgba_png():
    buf = BytesIO()
    Image.new("RGBA", (32, 32), (10, 20, 30, 128)).save(buf, format="PNG")

    result = normalize_image(buf.getvalue())

    with Image.open(BytesIO(result)) as image:
        assert image.mode == "RGB"


def test_normalize_image_rejects_garbage():
    with pytest.raises(ValueError, match="not a valid image"):
        normalize_image(b"definitely not an image")


def test_normalize_image_rejects_an_empty_payload():
    with pytest.raises(ValueError, match="not a valid image"):
        normalize_image(b"")


def test_normalize_image_rejects_oversized_dimensions():
    with pytest.raises(ValueError, match="exceed"):
        normalize_image(png_bytes(size=(MAX_DIMENSION + 1, 8)))


def test_normalize_image_accepts_exactly_the_maximum_dimension():
    result = normalize_image(png_bytes(size=(MAX_DIMENSION, 8)))

    with Image.open(BytesIO(result)) as image:
        assert image.size == (200, 200)


def test_normalize_image_centre_crops():
    # A tall image: the square crop must come from the middle band, so a marker
    # painted only in the top corner is cut away.
    image = Image.new("RGB", (200, 600), (0, 0, 0))
    image.paste((255, 255, 255), (0, 0, 200, 5))
    buf = BytesIO()
    image.save(buf, format="PNG")

    result = normalize_image(buf.getvalue())

    with Image.open(BytesIO(result)) as out:
        assert out.getpixel((0, 0)) != (255, 255, 255)


# ---------------------------------------------------------------------------
# key helpers the routes lean on
# ---------------------------------------------------------------------------


def test_avatar_keys_are_distinct_per_user():
    a, b = uuid.uuid4(), uuid.uuid4()

    assert get_s3_avatar_unprocessed_key(a) == f"avatars-unprocessed/{a}"
    assert get_s3_avatar_processed_key(a) == f"avatars/{a}"
    assert get_s3_avatar_unprocessed_key(a) != get_s3_avatar_unprocessed_key(b)
