import asyncio
import uuid

import structlog.stdlib

from app.cache import get_avatar_url_key, get_avatar_waiting_key, get_redis_client
from app.storage import get_s3_avatar_processed_key, storage
from app.tasks.conf.broker import broker
from app.util import normalize_image

log = structlog.stdlib.get_logger(__name__)


@broker.task(queue_name="default")
async def process_avatar(user_uuid: uuid.UUID):
    avatar_waiting_key = get_avatar_waiting_key(user_uuid)
    _log = log.bind(avatar_waiting_key=avatar_waiting_key)
    async with get_redis_client() as redis:
        s3_unprocessed_key: str | None = await redis.getdel(avatar_waiting_key)  # type: ignore
        if s3_unprocessed_key is None:
            _log.warning("inexistent_avatar")
            return

    try:
        async with storage.internal_client() as s3:
            resp = await s3.get_object(Bucket="avatars", Key=s3_unprocessed_key)
            async with resp["Body"] as body:
                data = await body.read()
    except Exception as e:
        _log.error("s3_avatar_acquire_failed", exc=e)
        return

    try:
        normalized = await asyncio.to_thread(normalize_image, data)
    except ValueError as e:
        _log.error("s3_invalid_image", exc=e)
        return

    async with storage.internal_client() as s3:
        await s3.put_object(
            Bucket="avatars",
            Key=get_s3_avatar_processed_key(user_uuid),
            Body=normalized,
            ContentType="image/webp",
        )
        await s3.delete_object(Bucket="avatars", Key=s3_unprocessed_key)
    async with get_redis_client() as redis:
        await redis.delete(get_avatar_url_key(user_uuid))
