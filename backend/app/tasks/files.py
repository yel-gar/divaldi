import asyncio
import uuid

import structlog.stdlib

from app.cache import get_attachment_status_key, get_avatar_url_key, get_avatar_waiting_key, get_redis_client
from app.models.chat import Attachment
from app.storage import get_s3_avatar_processed_key, storage
from app.tasks.conf.broker import broker, tsq_db
from app.util import normalize_image
from processing.parser import PDFToImageConverter

log = structlog.stdlib.get_logger(__name__)

def _process_pdf(pdf_bytes: bytes) -> list[bytes]:
    processor = PDFToImageConverter()
    return processor.pdf_bytes_to_png_bytes(pdf_bytes)

async def _redis_error(key: str):
    async with get_redis_client() as redis:
        await redis.set(key, "error", nx=False, ex=3600)


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


@broker.task(queue_name="default")
async def process_attachment(attachment_id: int):
    _log = log.bind(attachment_id=attachment_id)
    redis_status_key = get_attachment_status_key(attachment_id)
    async with tsq_db() as db:
        attachment = await db.get(Attachment, attachment_id)
    if attachment is None:
        _log.error("null_attachment_id")
        await _redis_error(redis_status_key)
        return

    async with storage.internal_client() as s3:
        try:
            resp = await s3.head_object(Bucket="uploads", Key=attachment.s3_key)
        except Exception as e:
            _log.error("s3_attachment_acquire_failed", exc=e)
            await _redis_error(redis_status_key)
            return

    content_type = resp["ContentType"]
    match content_type:
        case "application/pdf":
            await process_pdf.kiq(attachment_id)
        case "application/dxf":
            await process_dxf.kiq(attachment_id)
        case "image/png" | "image/jpeg":
            await process_image.kiq(attachment_id)
        case _:
            _log.error("s3_bad_content_type", key=attachment.s3_key, content_type=content_type)
            await _redis_error(redis_status_key)
            return


@broker.task(queue_name="default")
async def process_pdf(attachment_id: int):
    _log = log.bind(attachment_id=attachment_id)
    try:
        async with tsq_db() as db:
            attachment = await db.get(Attachment, attachment_id)
            if attachment is None:
                raise ValueError("null_attachment_id")
        async with storage.internal_client() as s3:
            resp = await s3.get_object(
                Bucket="uploads",
                Key=attachment.s3_key,
            )
            async with resp["Body"] as body:
                data = await body.read()

        result: list[bytes] = await asyncio.to_thread(_process_pdf, data)
        # todo: there might be just a bit too many pages in the pdf


    except Exception as e:
        _log.error("unknown_pdf_exception", exc=e)
        await _redis_error(get_attachment_status_key(attachment_id))


@broker.task(queue_name="default")
async def process_dxf(attachment_id: int): ...


@broker.task(queue_name="default")
async def process_image(attachment_id: int): ...
