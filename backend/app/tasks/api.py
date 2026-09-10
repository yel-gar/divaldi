import uuid
from datetime import UTC, datetime, timedelta

import structlog.stdlib
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import get_generation_key, get_redis_client
from app.models.auth import User
from app.models.chat import ChatMessage, GenerationResult, GenerationResultType, UserRole
from app.providers.containers import provider
from app.providers.models import Message, ResponseFormat
from app.tasks.conf.broker import broker, tsq_db

log = structlog.stdlib.get_logger(__name__)


async def _add_error_result(db: AsyncSession, session: uuid.UUID, error_msg: str):
    db.add(GenerationResult(message_session=session, type=GenerationResultType.ERROR, content=error_msg))
    await db.commit()


@broker.task(queue_name="default", schedule=[{"interval": timedelta(hours=1)}])
async def cleanup_old_results():
    log.info("old_results_cleanup_start")
    async with tsq_db() as db:
        res = await db.execute(
            delete(GenerationResult).where(GenerationResult.timestamp < datetime.now(tz=UTC) - timedelta(hours=1))
        )
        await db.commit()
        log.info("old_results_cleanup_ok", count=res.rowcount)


@broker.task(queue_name="network")
async def generate_chat_message(session: uuid.UUID):
    async with tsq_db() as db:
        await db.execute(delete(GenerationResult).where(GenerationResult.message_session == session))
        await db.commit()

        user_uuid = await db.scalar(
            select(User.uuid)
            .join(ChatMessage, User.id == ChatMessage.user_id)
            .where(ChatMessage.message_session == session)
            .limit(1)
        )
        if user_uuid is None:
            log.error("no_user_for_session", session=session)
            await _add_error_result(db, session, "Invalid message session")
            return
        key = get_generation_key(user_uuid)
        async with get_redis_client() as redis_client:
            acquired = await redis_client.set(key, "1", ex=300, nx=True)
            if not acquired:
                log.error("generate_chat_message_already_running", session=session)
                return
    try:
        async with tsq_db() as db:
            messages_data = await db.scalars(
                select(ChatMessage).where(ChatMessage.message_session == session).order_by(ChatMessage.id)
            )
            messages = [Message.from_chat_message(msg) for msg in messages_data]
            if not messages:
                log.error("no_messages_for_session", session=session)
                await _add_error_result(db, session, "Invalid message session: no messages to send")
                return

            log.debug("text_message_generation", last_message=messages[-1])

        response = await provider.generate(
            messages,
            ResponseFormat(type=ResponseFormat.TYPE_TEXT, strict=False),
            x_client_id=user_uuid,
            x_session_id=session,
        )
        log.debug("text_generation_response", response=response)

        async with tsq_db() as db:
            if not response:
                result = GenerationResult(
                    message_session=session,
                    type=GenerationResultType.ERROR,
                    content="Internal server error occurred, please try again later or contact support.",
                )
                db.add(result)
                await db.commit()
                return
            if not response.messages:
                log.error("empty_response", session=session)
                await _add_error_result(db, session, "Provider did not respond properly")
                return

            text = response.messages[0].content.text
            result = GenerationResult(message_session=session, type=GenerationResultType.SUCCESS, content=text)
            message = ChatMessage(
                user_id=user_uuid,
                message_session=session,
                role=UserRole.ASSISTANT,
                content=text,
            )
            db.add(result)
            db.add(message)
            await db.commit()
    finally:
        async with get_redis_client() as redis_client:
            await redis_client.delete(key)
