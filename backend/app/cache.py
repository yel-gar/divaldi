import uuid

from redis.asyncio import Redis

redis_client = Redis.from_url("redis://redis:6379/0")


def get_generation_key(session: uuid.UUID) -> str:
    return f"chat:generation:{session}"
