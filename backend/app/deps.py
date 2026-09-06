from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, Cookie, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette import status

from database import get_db
from models.auth import User, Session

DbSession = Annotated[AsyncSession, Depends(get_db)]

async def require_login(session_token: Annotated[str | None, Cookie()], db: DbSession) -> User:
    if session_token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    res = await db.execute(select(Session).options(selectinload(Session.user)).where(Session.token == session_token))
    session = res.scalar_one_or_none()

    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")

    if session.expires_at < datetime.now(timezone.utc):
        await db.delete(session)
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")

    return session.user

CurrentUser = Annotated[User, Depends(require_login)]
