from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Response
from sqlalchemy import select
from starlette.status import HTTP_401_UNAUTHORIZED

from app.auth import generate_token, verify_password
from app.deps import CurrentUser, DbSession
from app.models.auth import Session, User
from app.schemas.auth import UserLogin
from app.util import get_debug

SESSION_VALID_TIME = timedelta(days=7)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", summary="Login user, sets `session_token` cookie")
async def login(data: UserLogin, response: Response, db: DbSession):
    res = await db.execute(select(User).where(User.username == data.username))
    user = res.scalar_one_or_none()

    if not user or not verify_password(user.password_hash, data.password):
        raise HTTPException(HTTP_401_UNAUTHORIZED, "Incorrect username or password")

    token = generate_token()
    session = Session(
        token=token,
        user_id=user.id,
        expires_at=datetime.now(UTC) + SESSION_VALID_TIME,
    )
    db.add(session)
    await db.commit()

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=not get_debug(),
        samesite="lax",
        max_age=int(SESSION_VALID_TIME.total_seconds()),
        path="/",
    )

    return {"message": "Login OK"}


@router.post("/logout")
async def logout(
    response: Response,
    user: CurrentUser,
    db: DbSession,
    session_token: Annotated[str | None, Cookie()] = None,
):
    if session_token:
        res = await db.execute(select(Session).where(Session.token == session_token, Session.user_id == user.id))
        session = res.scalar_one_or_none()
        if session:
            await db.delete(session)
            await db.commit()

    response.delete_cookie(key="session_token", path="/")
    return {"message": "Logout OK"}
