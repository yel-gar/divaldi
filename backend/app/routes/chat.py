import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select

from app.cache import get_deletion_key, get_generation_key
from app.deps import (
    CurrentUser,
    DbSession,
    RedisSession,
    VerifiedMessageSession,
    chat_lock,
    require_login,
    user_rate_limiter,
)
from app.models.chat import ChatMessage, GenerationResult, GenerationResultType, UserRole
from app.schemas import MessageResponse
from app.schemas.chat import (
    ChatCreatedSchema,
    ChatDeletedResponse,
    ChatMessageSchema,
    ResultSchema,
    ResultSchemaContent,
    SendMessageSchema,
    UserChatSchema,
)
from app.tasks.api import generate_chat_message

router = APIRouter(
    prefix="/chats",
    tags=["chat"],
    dependencies=[Depends(require_login), Depends(user_rate_limiter(100, timedelta(minutes=1), "chats:global"))],
)


@router.get("/", summary="Get all chats user has ever created", response_model=list[UserChatSchema])
async def get_chats(db: DbSession, user: CurrentUser):
    data = await db.scalars(
        select(ChatMessage)
        .where(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.message_session, ChatMessage.timestamp.desc())
        .distinct(ChatMessage.message_session)
    )
    return [
        UserChatSchema(
            session_id=d.message_session,
            last_message=ChatMessageSchema(id=d.id, role=d.role, content=d.content, timestamp=d.timestamp),
        )
        for d in data
    ]


@router.post(
    "/",
    dependencies=[
        Depends(chat_lock),
        Depends(user_rate_limiter(20, timedelta(minutes=10), "chats:create")),
        Depends(user_rate_limiter(5, timedelta(minutes=1), "chats:post")),
    ],
    summary="Create new chat",
    response_model=ChatCreatedSchema,
    status_code=202,
)
async def create_chat(db: DbSession, user: CurrentUser, data: SendMessageSchema):
    session_uuid = uuid.uuid4()
    new_message = ChatMessage(user_id=user.id, message_session=session_uuid, role=UserRole.USER, content=data.content)
    db.add(new_message)
    await db.commit()
    await generate_chat_message.kiq(session_uuid)
    return ChatCreatedSchema(session_id=session_uuid)


@router.get("/{session_id}", summary="Get messages in chat", response_model=list[ChatMessageSchema])
async def get_chat(session_id: VerifiedMessageSession, db: DbSession, user: CurrentUser):
    return await db.scalars(
        select(ChatMessage)
        .where(ChatMessage.user_id == user.id, ChatMessage.message_session == session_id)
        .order_by(ChatMessage.id)
    )


@router.post(
    "/{session_id}",
    dependencies=[Depends(chat_lock), Depends(user_rate_limiter(5, timedelta(minutes=1), "chats:post"))],
    summary="Send text message to chat",
    status_code=202,
    response_model=MessageResponse,
)
async def send_message(session_id: VerifiedMessageSession, db: DbSession, user: CurrentUser, data: SendMessageSchema):
    new_message = ChatMessage(user_id=user.id, message_session=session_id, role=UserRole.USER, content=data.content)
    db.add(new_message)
    await db.commit()
    await generate_chat_message.kiq(session_id)
    return MessageResponse(message="Message sent")


@router.post(
    "/{session_id}/retry",
    dependencies=[Depends(chat_lock), Depends(user_rate_limiter(5, timedelta(minutes=1), "chats:post"))],
    response_model=MessageResponse,
)
async def retry_send(session_id: VerifiedMessageSession, db: DbSession):
    last_result = await db.scalar(select(GenerationResult).where(GenerationResult.message_session == session_id))
    if last_result is None or last_result.type != GenerationResultType.ERROR:
        raise HTTPException(status_code=400, detail="There's nothing to retry")
    await generate_chat_message.kiq(session_id)
    return MessageResponse(message="Retrying")


@router.delete(
    "/{session_id}",
    summary="Delete chat",
    response_model=ChatDeletedResponse,
)
async def delete_chat(session_id: VerifiedMessageSession, redis_client: RedisSession, db: DbSession, user: CurrentUser):
    await redis_client.set(
        get_deletion_key(session_id), "1", ex=300, nx=True
    )  # let worker know not to save results if it's running currently
    res = await db.execute(
        delete(ChatMessage).where(ChatMessage.user_id == user.id, ChatMessage.message_session == session_id)
    )
    await db.execute(delete(GenerationResult).where(GenerationResult.message_session == session_id))
    await db.commit()
    if res.rowcount == 0:
        return ChatDeletedResponse(deleted=False)
    return ChatDeletedResponse(deleted=True)


@router.get(
    "/{session_id}/result",
    summary="Get last result if any user message was sent",
    response_model=ResultSchema,
)
async def get_result(session_id: VerifiedMessageSession, db: DbSession, redis_client: RedisSession):
    if await redis_client.exists(get_generation_key(session_id)):
        return ResultSchema(running=True, result=None)
    result = await db.scalar(select(GenerationResult).where(GenerationResult.message_session == session_id))
    if result is None:
        return ResultSchema(running=False, result=None)
    return ResultSchema(
        running=False,
        result=ResultSchemaContent.model_validate(result, from_attributes=True),
    )
