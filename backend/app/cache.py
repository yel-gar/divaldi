import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from functools import cache

from redis.asyncio import ConnectionPool, Redis


@cache
def get_redis_pool() -> ConnectionPool:
    return ConnectionPool.from_url("redis://redis:6379/0", max_connections=20)


@asynccontextmanager
async def get_redis_client() -> AsyncGenerator[Redis]:
    async with Redis(connection_pool=get_redis_pool()) as conn:
        yield conn


def get_generation_key(user_uuid: uuid.UUID) -> str:
    return f"chat:generation:{user_uuid}"


def get_creation_key(user_uuid: uuid.UUID) -> str:
    return f"chat:creation:{user_uuid}"
