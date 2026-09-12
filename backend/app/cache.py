import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from functools import cache

from redis.asyncio import ConnectionPool, Redis


@cache
def get_redis_pool() -> ConnectionPool:
    return ConnectionPool.from_url("redis://redis:6379/0", max_connections=20, decode_responses=True)


@asynccontextmanager
async def get_redis_client() -> AsyncGenerator[Redis]:
    async with Redis(connection_pool=get_redis_pool()) as conn:
        yield conn


def get_generation_key(user_uuid: uuid.UUID) -> str:
    return f"chat:generation:{user_uuid}"


def get_creation_key(user_uuid: uuid.UUID) -> str:
    return f"chat:creation:{user_uuid}"


def get_deletion_key(session_id: uuid.UUID) -> str:
    return f"chat:deletion:{session_id}"


def get_ratelimit_key(key: str, user_id: int) -> str:
    return f"ratelimit:{key}:{user_id}"


def get_avatar_waiting_key(user_uuid: uuid.UUID) -> str:
    return f"avatar:waiting:{user_uuid}"


def get_avatar_url_key(user_uuid: uuid.UUID) -> str:
    return f"avatar:url:{user_uuid}"


def get_attachment_status_key(attachment_id: int) -> str:
    return f"attachment:{attachment_id}:status"


def get_attachment_ownership_key(session_id: uuid.UUID, attachment_id: int) -> str:
    return f"attachment:ownership:{session_id}:{attachment_id}"


def get_pdf_sync_key(attachment_id: int) -> str:
    return f"attachment:pdf:sync:{attachment_id}"