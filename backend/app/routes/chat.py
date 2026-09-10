import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from starlette.responses import Response

from app.cache import get_creation_key, get_generation_key
from app.deps import CurrentUser, DbSession, RedisSession, require_login
from app.models.chat import ChatMessage, GenerationResult, UserRole
from app.schemas import MessageResponse
from app.schemas.chat import (
    ChatCreatedSchema,
    ChatMessageSchema,
    CreateChatSchema,
    ResultSchema,
    ResultSchemaContent,
    SendMessageSchema,
    UserChatSchema,
)
from app.tasks.api import generate_chat_message

router = APIRouter(prefix="/chats", tags=["chat"], dependencies=[Depends(require_login)])


@router.get("/", summary="Get all chats user has ever created", response_model=list[UserChatSchema])
async def get_chats(db: DbSession, user: CurrentUser):
    data = await db.scalars(
        select(ChatMessage)
        .where(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.timestamp.desc())
        .distinct(ChatMessage.message_session)
    )
    return [
        UserChatSchema(
            session_id=d.message_session,
            last_message=ChatMessageSchema(role=d.role, content=d.content, timestamp=d.timestamp),
        )
        for d in data
    ]


@router.post("/", summary="Create new chat", response_model=ChatCreatedSchema, status_code=202)
async def create_chat(redis_client: RedisSession, db: DbSession, user: CurrentUser, data: CreateChatSchema):
    user_uuid = user.uuid
    generation_key = get_generation_key(user_uuid)
    creation_key = get_creation_key(user_uuid)
    if await redis_client.exists(generation_key):
        raise HTTPException(status_code=409, detail="A generation job is already running")
    if not await redis_client.set(creation_key, "1", ex=5, nx=True):
        raise HTTPException(status_code=429, detail="Stop spamming")
    try:
        session_uuid = uuid.uuid4()
        new_message = ChatMessage(
            user_id=user.id, message_session=session_uuid, role=UserRole.USER, content=data.initial_message
        )
        db.add(new_message)
        await db.commit()
        await generate_chat_message.kiq(session_uuid)
        return ChatCreatedSchema(session_id=session_uuid)
    finally:
        await redis_client.delete(creation_key)


@router.get("/{session_id}", summary="Get messages in chat")
async def get_chat(session_id: uuid.UUID, db: DbSession, user: CurrentUser):

    return await db.scalars(
        select(ChatMessage)
        .where(ChatMessage.user_id == user.id, ChatMessage.message_session == session_id)
        .order_by(ChatMessage.id)
    )


@router.post("/{session_id}", summary="Send text message to chat", status_code=202, response_model=MessageResponse)
async def send_message(
    redis_client: RedisSession, session_id: uuid.UUID, db: DbSession, user: CurrentUser, data: SendMessageSchema
):
    user_uuid = user.uuid
    generation_key = get_generation_key(user_uuid)
    creation_key = get_creation_key(user_uuid)
    if await redis_client.exists(generation_key):
        raise HTTPException(status_code=409, detail="A generation job is already running")
    if not await redis_client.set(creation_key, "1", ex=5, nx=True):
        raise HTTPException(status_code=429, detail="Stop spamming")
    try:
        new_message = ChatMessage(user_id=user.id, message_session=session_id, role=UserRole.USER, content=data.content)
        db.add(new_message)
        await db.commit()
        await generate_chat_message.kiq(session_id)
        return MessageResponse(message="Message sent")
    finally:
        await redis_client.delete(creation_key)


@router.delete(
    "/{session_id}",
    summary="Delete chat",
    response_model=MessageResponse,
    responses={200: {"message": "Chat deleted"}, 204: {"message": "Unmodified"}},
)
async def delete_chat(response: Response, session_id: uuid.UUID, db: DbSession, user: CurrentUser):
    res = await db.execute(
        delete(ChatMessage).where(ChatMessage.user_id == user.id, ChatMessage.message_session == session_id)
    )
    await db.execute(delete(GenerationResult).where(GenerationResult.message_session == session_id))
    await db.commit()
    if res.rowcount == 0:
        response.status_code = 204
        return MessageResponse(message="Unmodified")
    return MessageResponse(message="Chat deleted")


@router.get(
    "/{session_id}/result",
    summary="Get last result if any user message was sent",
    response_model=ResultSchema,
    responses={200: {"result": ResultSchemaContent}, 204: {"result": None}},
)
async def get_result(response: Response, session_id: uuid.UUID, db: DbSession, redis_client: RedisSession):
    if await redis_client.exists(get_generation_key(session_id)):
        response.status_code = 204
        return ResultSchema(result=None)
    result = await db.scalar(select(GenerationResult).where(GenerationResult.message_session == session_id))
    return ResultSchema(
        result=ResultSchemaContent.model_validate(result, from_attributes=True),
    )
