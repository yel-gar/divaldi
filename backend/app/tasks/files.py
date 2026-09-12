import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import structlog.stdlib
from processing.parser import PDFToImageConverter, extract_measurements
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cache import (
    get_attachment_status_key,
    get_avatar_url_key,
    get_avatar_waiting_key,
    get_pdf_sync_key,
    get_redis_client,
)
from app.models.auth import User
from app.models.chat import Attachment, ChatSession, ProcessingResult, ProcessingResultUploadable
from app.providers.containers import provider
from app.storage import get_s3_avatar_processed_key, get_s3_pdf_image_key, storage
from app.tasks.conf.broker import broker, tsq_db
from app.util import normalize_image

log = structlog.stdlib.get_logger(__name__)


def _process_pdf(pdf_bytes: bytes) -> list[bytes]:
    processor = PDFToImageConverter()
    return processor.pdf_bytes_to_png_bytes(pdf_bytes)


def _process_dxf(dxf_bytes: bytes) -> str:
    return extract_measurements(dxf_bytes)


async def _get_user_uuid_from_attachment_id(attachment_id: int, db: AsyncSession | None) -> uuid.UUID | None:
    q = select(User.uuid).join(User.chat_sessions).join(ChatSession.attachments).where(Attachment.id == attachment_id)
    if db is not None:
        return await db.scalar(q)
    async with tsq_db() as db:
        return await db.scalar(q)


async def _redis_error(key: str):
    async with get_redis_client() as redis:
        await redis.set(key, "error", nx=False, ex=3600)


async def _add_image_to_s3(attachment_id: int, data: bytes) -> int:
    async with tsq_db() as db, storage.internal_client() as s3:
        key = get_s3_pdf_image_key(attachment_id)
        await s3.put_object(Bucket="uploads", Key=key, Body=data)
        uploadable = ProcessingResultUploadable(
            attachment_id=attachment_id,
            s3_key=key,
            sber_id=None,
        )
        db.add(uploadable)
        await db.commit()
        await db.refresh(uploadable)
    return uploadable.id


async def _s3_try_delete(s3_key: str):
    try:
        async with storage.internal_client() as s3:
            await s3.delete_object(Bucket="uploads", Key=s3_key)
    except Exception as e:
        log.warning("delete_upload_s3_failure", s3_key=s3_key, exc=e)


async def _s3_get_object(bucket: str, s3_key: str):
    async with storage.internal_client() as s3:
        resp = await s3.get_object(Bucket=bucket, Key=s3_key)
        async with resp["Body"] as body:
            return await body.read()


@broker.task(queue_name="default", schedule=[{"interval": timedelta(hours=1)}])
async def cleanup_orphan_attachments():
    log.info("orphan_attachments_cleanup_start")
    async with tsq_db() as db:
        clause = (Attachment.ready == False, Attachment.timestamp < datetime.now(tz=UTC) - timedelta(hours=1))
        orphans = await db.scalars(select(Attachment).where(*clause))
        log.info("orphan_attachments_cleanup_count", count=len(orphans.all()))
        tasks = [_s3_try_delete(a.s3_key) for a in orphans]
        await asyncio.gather(*tasks)
        await db.execute(delete(Attachment).where(*clause))
        await db.commit()
        log.info("orphan_attachments_cleanup_ok")


@broker.task(queue_name="default", schedule=[{"interval": timedelta(hours=1)}])
async def cleanup_stale_results():
    log.info("stale_results_cleanup_start")
    async with tsq_db() as db:
        cutoff = datetime.now(tz=UTC) - timedelta(hours=1)
        old_attachment_ids = select(Attachment.id).where(Attachment.timestamp < cutoff)
        res = await db.execute(delete(ProcessingResult).where(ProcessingResult.attachment_id.in_(old_attachment_ids)))
        log.info("cleanup_orphan_attachments_stale_results", count=res.rowcount)
        res = await db.execute(
            delete(ProcessingResultUploadable).where(ProcessingResultUploadable.attachment_id.in_(old_attachment_ids))
        )
        log.info("cleanup_orphan_attachments_stale_uploadables", count=res.rowcount)
        await db.commit()


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
        data = await _s3_get_object("avatars", s3_unprocessed_key)
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
        data = _s3_get_object("uploads", attachment.s3_key)

        result: list[bytes] = await asyncio.to_thread(_process_pdf, data)
        # todo: there might be just a bit too many pages in the pdf
        s3_add_tasks = [_add_image_to_s3(attachment_id, d) for d in result]
        uploadables_ids = await asyncio.gather(*s3_add_tasks)

        async with get_redis_client() as redis:
            await redis.set(get_pdf_sync_key(attachment_id), len(uploadables_ids), nx=False, ex=600)
        for id_ in uploadables_ids:
            await upload_image.kiq(f"{attachment.name}-{id_}.png", attachment_id, id_)

    except Exception as e:
        _log.error("unknown_pdf_exception", exc=e)
        await _redis_error(get_attachment_status_key(attachment_id))


@broker.task(queue_name="default")
async def process_dxf(attachment_id: int):
    try:
        async with tsq_db() as db:
            attachment = await db.get(Attachment, attachment_id)
            if attachment is None:
                raise ValueError("null_attachment_id")

            data = await _s3_get_object("uploads", attachment.s3_key)
            output: str = await asyncio.to_thread(_process_dxf, data)
            result = ProcessingResult(
                attachment_id=attachment_id,
                output=output,
            )
            db.add(result)
            attachment.ready = True
            await db.commit()
    except Exception as e:
        log.error("process_dxf_exception", exc=e)
        await _redis_error(get_attachment_status_key(attachment_id))
    else:
        log.info("process_dxf_ok", attachment_id=attachment_id)
        async with get_redis_client() as redis:
            await redis.set(get_attachment_status_key(attachment_id), "completed", nx=False, ex=600)


@broker.task(queue_name="default")
async def process_image(attachment_id: int):
    try:
        async with tsq_db() as db:
            attachment = await db.get(Attachment, attachment_id)
            if attachment is None:
                raise ValueError("null_attachment")
            user_uuid = _get_user_uuid_from_attachment_id(attachment_id, db=db)
            session_id = await db.scalar(
                select(ChatSession.session_id).join(ChatSession.attachments).where(Attachment.id == attachment_id)
            )
            if user_uuid is None or session_id is None:
                log.error("required_data_null", user_uuid=user_uuid, session_id=session_id)
                raise ValueError("required_data_null")

            data = await _s3_get_object("uploads", attachment.s3_key)
            sber_id = await provider.upload(attachment.name, data, x_client_id=user_uuid, x_session_id=session_id)

            uploadable = ProcessingResultUploadable(
                attachment_id=attachment_id,
                s3_key=attachment.s3_key,
                sber_id=sber_id,
            )
            db.add(uploadable)
            attachment.ready = True
            await db.commit()
    except Exception as e:
        log.error("process_image_exception", exc=e)
        await _redis_error(get_attachment_status_key(attachment_id))
    else:
        log.info("process_image_ok", attachment_id=attachment_id)
        async with get_redis_client() as redis:
            await redis.set(get_attachment_status_key(attachment_id), "completed", nx=False, ex=600)


@broker.task(queue_name="network")
async def upload_image(filename: str, attachment_id: int, uploadable_id: int):
    failed = False
    try:
        async with tsq_db() as db:
            user_uuid = _get_user_uuid_from_attachment_id(attachment_id, db=db)
            session_id = await db.scalar(
                select(ChatSession.session_id).join(ChatSession.attachments).where(Attachment.id == attachment_id)
            )
            uploadable = await db.get(ProcessingResultUploadable, uploadable_id)
            if user_uuid is None or session_id is None or uploadable is None:
                log.error("required_data_null", user_uuid=user_uuid, session_id=session_id, uploadable=uploadable)
                raise ValueError("required_data_null")
            data = await _s3_get_object("uploads", uploadable.s3_key)
            sber_id = await provider.upload(filename, data, x_client_id=user_uuid, x_session_id=session_id)
            uploadable.sber_id = sber_id
            await db.commit()
    except Exception as e:
        log.error("image_upload_failure", exc=e, attachment_id=attachment_id, uploadable_id=uploadable_id)
        failed = True
        async with get_redis_client() as redis:
            await redis.set(get_attachment_status_key(attachment_id), "error", nx=False, ex=600)
    else:
        log.info("image_upload_ok", attachment_id=attachment_id)
    finally:
        async with get_redis_client() as redis:
            count = await redis.decr(get_pdf_sync_key(attachment_id))
            if count <= 0 or failed:
                await pdf_upload_cleanup.kiq(attachment_id)


@broker.task(queue_name="default")
async def pdf_upload_cleanup(attachment_id: int):
    async with get_redis_client() as redis:
        if await redis.getdel(get_pdf_sync_key(attachment_id)) is None:
            log.warning("pdf_duplicate_cleanup", attachment_id=attachment_id)
            return
        try:
            async with tsq_db() as db:
                attachment = await db.get(
                    Attachment, attachment_id, options=[selectinload(Attachment.processing_result_uploadables)]
                )
                if attachment is None:
                    raise ValueError("null_attachment_id")
                tasks = [_s3_try_delete(uploadable.s3_key) for uploadable in attachment.processing_result_uploadables]
                await asyncio.gather(*tasks)
                if await redis.get(get_attachment_status_key(attachment_id)) != "error":
                    await redis.set(get_attachment_status_key(attachment_id), "completed", nx=False, ex=600)
                    attachment.ready = True
                await db.commit()
        except Exception as e:
            log.error("pdf_upload_cleanup_failure", exc=e, attachment_id=attachment_id)
            await _redis_error(get_attachment_status_key(attachment_id))
        else:
            log.info("pdf_upload_cleanup_ok", attachment_id=attachment_id)
