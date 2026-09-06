from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response, Cookie
from sqlalchemy import select
from starlette.status import HTTP_401_UNAUTHORIZED

from auth import verify_password, generate_token
from deps import DbSession, CurrentUser
from models.auth import User, Session
from schemas.auth import UserLogin
from util import get_debug

SESSION_VALID_TIME = timedelta(days=7)

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

@router.post("/login", summary="Login user, sets `session_token` cookie")
async def login(data: UserLogin, response: Response, db: DbSession):
    res = await db.execute(select(User).where(User.username == data.username))
    user = res.scalar_one_or_none()

    if not user or not verify_password(user.password_hash, data.password):
        raise HTTPException(HTTP_401_UNAUTHORIZED, "Incorrect username or password")

    token = generate_token()
    session = Session(token=token, user_id=user.id, expires_at=datetime.now(timezone.utc) + SESSION_VALID_TIME)
    db.add(session)
    await db.commit()

    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=not get_debug(),
        samesite="lax",
        max_age=int(SESSION_VALID_TIME.total_seconds()),
        path="/"
    )

    return {"message": "Login OK"}

@router.post("/logout")
async def logout(response: Response, user: CurrentUser, session_token: Annotated[str | None, Cookie()], db: DbSession):
    if session_token:
        res = await db.execute(select(Session).where(Session.token == session_token, Session.user_id == user.id))
        session = res.scalar_one_or_none()
        if session:
            await db.delete(session)
            await db.commit()

    response.delete_cookie(key="session_token", path="/")
    return {"message": "Logout OK"}
