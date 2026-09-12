from datetime import timedelta
from typing import Annotated

import structlog.stdlib
from fastapi import APIRouter, HTTPException
from fastapi.params import Cookie, Depends
from sqlalchemy import delete

from app.auth import hash_password, verify_password
from app.cache import get_avatar_url_key, get_avatar_waiting_key
from app.deps import CurrentUser, DbSession, RedisSession, S3InternalClient, S3PublicClient, user_rate_limiter
from app.models.auth import Session
from app.schemas import MessageResponse
from app.schemas.files import S3AvatarUrlSchema, S3UploadParams, S3UploadRequest
from app.schemas.users import SetPasswordSchema, UserSchema
from app.storage import (
    MAX_AVATAR_FILE_SIZE,
    get_s3_avatar_processed_key,
    get_s3_avatar_unprocessed_key,
)
from app.tasks.files import process_avatar

log = structlog.stdlib.get_logger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/me", response_model=UserSchema, summary="Get current authenticated user")
async def users_me(user: CurrentUser):
    return user


@router.post("/me/set-password", response_model=MessageResponse, summary="Set password of current user")
async def users_set_password(
    user: CurrentUser,
    db: DbSession,
    data: SetPasswordSchema,
    session_token: Annotated[str | None, Cookie()] = None,
):
    if not verify_password(user.password_hash, data.old_password):
        raise HTTPException(status_code=400, detail="Bad old password")
    user.password_hash = hash_password(data.new_password)
    await db.execute(delete(Session).where(Session.user_id == user.id, Session.token != session_token))
    await db.commit()
    return MessageResponse(message="Password changed successfully, all sessions except current are invalidated")


@router.get("/me/avatar", response_model=S3AvatarUrlSchema)
async def users_get_avatar(
    user: CurrentUser, s3_public: S3PublicClient, s3_internal: S3InternalClient, redis: RedisSession
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


@router.post(
    "/me/set-avatar",
    dependencies=[Depends(user_rate_limiter(3, timedelta(minutes=5), "user:avatar"))],
    response_model=S3UploadParams,
)
async def users_set_avatar(user: CurrentUser, s3: S3PublicClient, redis: RedisSession, data: S3UploadRequest):
    if data.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Bad content type. Allowed types: {ALLOWED_CONTENT_TYPES}")
    if data.file_size > MAX_AVATAR_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Max size: {MAX_AVATAR_FILE_SIZE} bytes")

    redis_key = get_avatar_waiting_key(user.uuid)
    await redis.delete(redis_key)

    key = get_s3_avatar_unprocessed_key(user.uuid)
    s3_data = await s3.generate_presigned_post(
        Bucket="avatars",
        Key=key,
        Fields={"Content-Type": data.content_type},
        Conditions=[
            ["content-length-range", 1, MAX_AVATAR_FILE_SIZE],
            {"Content-Type": data.content_type},
        ],
        ExpiresIn=300,
    )
    await redis.set(redis_key, str(key), ex=600, nx=True)
    return s3_data


@router.post(
    "/me/set-avatar/complete",
    dependencies=[Depends(user_rate_limiter(1, 60, "user:avatar-complete"))],
    response_model=MessageResponse,
)
async def users_set_avatar_complete(user: CurrentUser, s3: S3InternalClient, redis: RedisSession):
    if not await redis.exists(get_avatar_waiting_key(user.uuid)):
        raise HTTPException(status_code=404, detail="You were not uploading anything or your upload expired")
    try:
        await s3.head_object(Bucket="avatars", Key=get_s3_avatar_unprocessed_key(user.uuid))
    except Exception as e:
        log.warning("no_avatar", key=get_s3_avatar_unprocessed_key(user.uuid), exc=e)
        raise HTTPException(status_code=400, detail="Object has not been uploaded yet") from e

    await process_avatar.kiq(user.uuid)
    return MessageResponse(message="Upload OK, processing started")
