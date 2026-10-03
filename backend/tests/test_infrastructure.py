"""Smoke tests for the shared test infrastructure itself.

These exist so a broken fixture fails here with an obvious message, rather than
as a confusing error in whichever suite happens to run first.
"""

import pytest

from app.cache import get_redis_client
from app.storage import get_s3_avatar_processed_key, storage


async def test_redis_client_reaches_the_test_container(redis_session: None):
    async with get_redis_client() as redis:
        await redis.set("smoke:key", "value")
        assert await redis.get("smoke:key") == "value"


async def test_object_storage_round_trip(s3: None):
    import uuid as _uuid

    key = f"smoke/{_uuid.uuid4()}.txt"
    async with storage.internal_client() as client:
        await client.put_object(Bucket="uploads", Key=key, Body=b"hello", ContentType="text/plain")
        response = await client.get_object(Bucket="uploads", Key=key)
        async with response["Body"] as body:
            assert await body.read() == b"hello"
        await client.delete_object(Bucket="uploads", Key=key)


def test_mock_provider_is_selected(monkeypatch):
    from app.providers.mock import MockProvider
    from app.providers.sber import SberProvider

    def build(key: str):
        import importlib

        monkeypatch.setenv("SBER_API_KEY", key)
        module = importlib.reload(importlib.import_module("app.providers.containers"))
        return module.provider

    assert isinstance(build("mock"), MockProvider)
    assert isinstance(build("real-key"), SberProvider)


@pytest.mark.parametrize("mode", ["kp", "clarify", "empty", "error"])
def test_s3_key_builders_are_namespaced(mode: str):
    import uuid as _uuid

    user = _uuid.uuid4()
    assert get_s3_avatar_processed_key(user).startswith("avatars/")
