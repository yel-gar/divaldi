from datetime import UTC, datetime
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette import status

from app.database import get_db
from app.models.auth import Session, User

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
