import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette import status

from app.cache import get_creation_key, get_generation_key, get_redis_client
from app.database import get_db
from app.models.auth import Session, User
from app.models.chat import ChatMessage

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def require_login(
    db: DbSession,
    session_token: Annotated[str | None, Cookie()] = None,
) -> User:
    if session_token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    res = await db.execute(select(Session).options(selectinload(Session.user)).where(Session.token == session_token))
    session = res.scalar_one_or_none()

    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")

    if session.expires_at < datetime.now(UTC):
        await db.delete(session)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")

    return session.user


CurrentUser = Annotated[User, Depends(require_login)]


async def require_admin(user: CurrentUser) -> User:
    if not user.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You're not allowed here")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


async def redis_session() -> AsyncGenerator[Redis]:
    async with get_redis_client() as session:
        yield session


RedisSession = Annotated[Redis, Depends(redis_session)]


async def chat_lock(redis_client: RedisSession, user: CurrentUser) -> AsyncGenerator[None]:
    user_uuid = user.uuid
    generation_key = get_generation_key(user_uuid)
    creation_key = get_creation_key(user_uuid)
    if await redis_client.exists(generation_key):
        raise HTTPException(status_code=409, detail="A generation job is already running")
    if not await redis_client.set(creation_key, "1", ex=5, nx=True):
        raise HTTPException(status_code=429, detail="Stop spamming")
    try:
        yield
    finally:
        await redis_client.delete(creation_key)


async def verify_chat_session(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> uuid.UUID:
    session_valid = await db.scalar(
        select(
            select(ChatMessage)
            .where(ChatMessage.message_session == session_id, ChatMessage.user_id == user.id)
            .exists()
        )
    )
    if not session_valid:
        raise HTTPException(status_code=403, detail="Invalid session")
    return session_id


VerifiedMessageSession = Annotated[uuid.UUID, Depends(verify_chat_session)]
