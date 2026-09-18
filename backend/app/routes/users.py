import os
from typing import Annotated

import structlog.stdlib
from fastapi import APIRouter, HTTPException
from fastapi.params import Cookie
from sqlalchemy import delete

from app.auth import hash_password, verify_password
from app.cache import get_avatar_url_key
from app.deps import (
    CurrentUser,
    DbSession,
    RedisSession,
    S3InternalClient,
    S3PublicClient,
)
from app.models.auth import Session
from app.schemas import MessageResponse
from app.schemas.files import S3AvatarUrlSchema
from app.schemas.users import SetPasswordSchema, UserSchema
from app.storage import (
    get_s3_avatar_processed_key,
)

log = structlog.stdlib.get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/me", response_model=UserSchema, summary="Get current authenticated user")
async def users_me(user: CurrentUser):
    return user


@router.post(
    "/me/set-password",
    response_model=MessageResponse,
    summary="Set password of current user",
)
async def users_set_password(
    user: CurrentUser,
    db: DbSession,
    data: SetPasswordSchema,
    session_token: Annotated[str | None, Cookie()] = None,
):
    if os.getenv("TEST_INSTANCE_MODE", "false") in {"true", "yes", "1"}:
        raise HTTPException(status_code=450, detail="Password changing on test instance is not allowed")
    if not verify_password(user.password_hash, data.old_password):
        raise HTTPException(status_code=400, detail="Bad old password")
    user.password_hash = hash_password(data.new_password)
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.token != session_token))
    await db.commit()
    return MessageResponse(message="Password changed successfully, all sessions except current are invalidated")


@router.get("/me/avatar", response_model=S3AvatarUrlSchema)
async def users_get_avatar(
    user: CurrentUser,
    s3_public: S3PublicClient,
    s3_internal: S3InternalClient,
    redis: RedisSession,
):
    redis_cache_key = get_avatar_url_key(user.uuid)
    val: str | None = await redis.get(redis_cache_key)  # type: ignore
    if val is not None:
        if val == "0":
            return S3AvatarUrlSchema(avatar_url=None)
        return S3AvatarUrlSchema(avatar_url=val)

    avatar_key = get_s3_avatar_processed_key(user.uuid)
    try:
        await s3_internal.head_object(Bucket="avatars", Key=avatar_key)
    except Exception as e:
        log.warning("no_avatar", key=avatar_key, exc=e)
        await redis.set(redis_cache_key, "0", ex=3600, nx=True)
        return S3AvatarUrlSchema(avatar_url=None)
    url = await s3_public.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": "avatars",
            "Key": avatar_key,
            "ResponseContentType": "image/webp",
        },
        ExpiresIn=3600,
    )
    await redis.set(redis_cache_key, url, ex=3600, nx=True)
    return S3AvatarUrlSchema(avatar_url=url)
