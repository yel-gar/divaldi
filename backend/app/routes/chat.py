import uuid
from datetime import timedelta

import structlog.stdlib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import aliased, selectinload

from app.cache import get_attachment_status_key, get_deletion_key, get_generation_key
from app.deps import (
    CurrentUser,
    DbSession,
    RedisSession,
    S3InternalClient,
    S3PublicClient,
    VerifiedAttachmentId,
    VerifiedMessageSession,
    chat_lock,
    require_login,
    user_rate_limiter,
)
from app.harness import FILE_ADDED_DESCRIPTION
from app.models.chat import (
    Attachment,
    ChatMessage,
    ChatSession,
    GenerationResult,
    GenerationResultType,
    ProcessingResult,
    ProcessingResultUploadable,
    UserRole,
)
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
from app.schemas.files import S3AttachmentStatusResponse, S3ChatUploadParams, S3ChatUploadRequest, S3UploadParams
from app.storage import get_s3_attachment_key
from app.tasks.api import generate_chat_message
from app.tasks.files import process_attachment

log = structlog.stdlib.get_logger(__name__)

ALLOWED_CHAT_CONTENT_TYPES = ["application/pdf", "application/dxf", "image/png", "image/jpeg"]
CHAT_MAX_UPLOAD_SIZE = 30 * 1024 * 1024


router = APIRouter(
    prefix="/chats",
    tags=["chat"],
    dependencies=[Depends(require_login), Depends(user_rate_limiter(100, timedelta(minutes=1), "chats:global"))],
)


@router.get("/", summary="Get all chats user has ever created", response_model=list[UserChatSchema])
async def get_chats(db: DbSession, user: CurrentUser):
    latest_per_session = (
        select(ChatMessage)
        .join(ChatMessage.session)
        .where(ChatSession.user_id == user.id)
        .order_by(
            ChatMessage.chat_session_id,
            ChatMessage.timestamp.desc(),
            ChatMessage.id.desc(),  # tiebreaker for equal timestamps
        )
        .distinct(ChatMessage.chat_session_id)
        .subquery()
    )

    LatestMessage = aliased(ChatMessage, latest_per_session)  # noqa: N806

    data = await db.scalars(
        select(LatestMessage)
        .order_by(LatestMessage.timestamp.desc())  # most recently active sessions first
        .options(selectinload(LatestMessage.attachments))
    )
    return [
        UserChatSchema(
            session_id=d.chat_session_id,
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
    summary="Create new chat, get session to send messages to",
    response_model=ChatCreatedSchema,
    status_code=202,
)
async def create_chat(user: CurrentUser, db: DbSession):
    session_uuid = uuid.uuid4()
    new_session = ChatSession(session_id=session_uuid, user_id=user.id)
    db.add(new_session)
    await db.commit()
    return ChatCreatedSchema(session_id=session_uuid)


@router.get("/{session_id}", summary="Get messages in chat", response_model=list[ChatMessageSchema])
async def get_chat(session_id: VerifiedMessageSession, db: DbSession):
    return await db.scalars(
        select(ChatMessage)
        .where(ChatMessage.chat_session_id == session_id)
        .order_by(ChatMessage.id)
        .options(selectinload(ChatMessage.attachments.and_(Attachment.ready == True)))
    )


@router.post(
    "/{session_id}",
    dependencies=[Depends(chat_lock), Depends(user_rate_limiter(5, timedelta(minutes=1), "chats:post"))],
    summary="Send text message to chat",
    status_code=202,
    response_model=MessageResponse,
)
async def send_message(session_id: VerifiedMessageSession, db: DbSession, data: SendMessageSchema):
    if await db.scalar(
        select(select(Attachment).where(Attachment.session_id == session_id, Attachment.ready == False).exists())
    ):
        raise HTTPException(status_code=400, detail="Not all attachments are ready")
    attachment_ids = select(Attachment.id).where(
        Attachment.session_id == session_id, Attachment.chat_message_id == None
    )
    uploadables = await db.scalars(
        select(ProcessingResultUploadable).where(
            ProcessingResultUploadable.attachment_id.in_(attachment_ids), ProcessingResultUploadable.sber_id != None
        )
    )
    files_str = None
    if uploadables:
        files_str = ",".join(u.sber_id for u in uploadables.all())  # type: ignore guaranteed to be non-none
    new_message = ChatMessage(chat_session_id=session_id, role=UserRole.USER, content=data.content, files_str=files_str)
    db.add(new_message)
    await db.execute(
        delete(ProcessingResultUploadable).where(ProcessingResultUploadable.attachment_id.in_(attachment_ids))
    )

    processing_results = await db.scalars(
        select(ProcessingResult)
        .where(ProcessingResult.attachment_id.in_(attachment_ids))
        .options(selectinload(ProcessingResult.attachment))
    )
    system_message = ""
    for result in processing_results:
        system_message += FILE_ADDED_DESCRIPTION.format(filename=result.attachment.name, description=result.output)
    if system_message:
        sys_msg = ChatMessage(
            chat_session_id=session_id,
            role=UserRole.SYSTEM,
            content=system_message,
        )
        db.add(sys_msg)
    await db.execute(delete(ProcessingResult).where(ProcessingResult.attachment_id.in_(attachment_ids)))
    await db.commit()
    await db.refresh(new_message)
    await db.execute(
        update(Attachment)
        .where(Attachment.session_id == session_id, Attachment.chat_message_id == None)
        .values(chat_message_id=new_message.id)
    )
    await db.commit()
    await generate_chat_message.kiq(session_id)
    return MessageResponse(message="Message sent")


@router.post(
    "/{session_id}/retry",
    dependencies=[Depends(chat_lock), Depends(user_rate_limiter(5, timedelta(minutes=1), "chats:post"))],
    response_model=MessageResponse,
)
async def retry_send(session_id: VerifiedMessageSession, db: DbSession):
    last_result = await db.scalar(select(GenerationResult).where(GenerationResult.chat_session_id == session_id))
    if last_result is None or last_result.type != GenerationResultType.ERROR:
        raise HTTPException(status_code=400, detail="There's nothing to retry")
    await generate_chat_message.kiq(session_id)
    return MessageResponse(message="Retrying")


@router.delete(
    "/{session_id}",
    summary="Delete chat",
    response_model=ChatDeletedResponse,
)
async def delete_chat(session_id: VerifiedMessageSession, redis_client: RedisSession, db: DbSession):
    await redis_client.set(
        get_deletion_key(session_id), "1", ex=300, nx=True
    )  # let worker know not to save results if it's running currently
    res = await db.execute(delete(ChatSession).where(ChatSession.session_id == session_id))
    await db.commit()
    if res.rowcount == 0:
        return ChatDeletedResponse(deleted=False)
    return ChatDeletedResponse(deleted=True)


@router.get(
    "/{session_id}/result",
    summary="Get last result if any user message was sent",
    response_model=ResultSchema,
)
async def get_result(session_id: VerifiedMessageSession, user: CurrentUser, db: DbSession, redis_client: RedisSession):
    if await redis_client.exists(get_generation_key(user.uuid)):
        return ResultSchema(running=True, result=None)
    result = await db.scalar(select(GenerationResult).where(GenerationResult.chat_session_id == session_id))
    if result is None:
        return ResultSchema(running=False, result=None)
    return ResultSchema(
        running=False,
        result=ResultSchemaContent.model_validate(result, from_attributes=True),
    )


@router.post(
    "/{session_id}/uploads",
    summary="Get link to upload file to chat, make sure to confirm the upload afterwards",
    response_model=S3ChatUploadParams,
)
async def upload_file(
    session_id: VerifiedMessageSession,
    db: DbSession,
    s3_public: S3PublicClient,
    redis: RedisSession,
    data: S3ChatUploadRequest,
):
    if data.content_type not in ALLOWED_CHAT_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Content type not allowed")
    if data.file_size > CHAT_MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="File size too large")

    s3_key = get_s3_attachment_key(session_id, data.filename)
    attachment = Attachment(name=data.filename, session_id=session_id, s3_key=s3_key)
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)

    await redis.set(get_attachment_status_key(attachment.id), "uploading", nx=True, ex=600)
    s3_post = await s3_public.generate_presigned_post(
        Bucket="uploads",
        Key=s3_key,
        Fields={"Content-Type": data.content_type},
        Conditions=[
            ["content-length-range", 1, CHAT_MAX_UPLOAD_SIZE],
            {"Content-Type": data.content_type},
        ],
        ExpiresIn=300,
    )
    return S3ChatUploadParams(attachment_id=attachment.id, params=S3UploadParams.model_validate(s3_post))


@router.post(
    "/{session_id}/uploads/{attachment_id}/uploaded",
    summary="Send request here after uploading attachment to provided URL",
    response_model=MessageResponse,
)
async def attachment_uploaded(
    session_id: VerifiedMessageSession,
    attachment_id: int,
    db: DbSession,
    s3_internal: S3InternalClient,
    redis: RedisSession,
):
    lock = redis.lock(f"attachment:upload:lock:{attachment_id}", timeout=10)
    if not await lock.acquire(blocking=False):
        raise HTTPException(status_code=422, detail="Stop spamming")
    try:
        if await redis.get(get_attachment_status_key(attachment_id)) not in {"uploading", "error"}:
            raise HTTPException(status_code=400, detail="File has already been uploaded")
        attachment = await db.scalar(
            select(Attachment).where(Attachment.id == attachment_id, Attachment.session_id == session_id)
        )
        if attachment is None:
            raise HTTPException(status_code=404, detail="Attachment not found")
        try:
            await s3_internal.head_object(Bucket="uploads", Key=attachment.s3_key)
        except Exception as e:
            log.warning("upload_not_uploaded", key=attachment.s3_key, exc=e)
            raise HTTPException(status_code=400, detail="You haven't uploaded yet") from e

        await redis.set(get_attachment_status_key(attachment_id), "processing", nx=False, ex=600)
        await process_attachment.kiq(attachment_id)
        return MessageResponse(message="File uploaded, processing started")
    finally:
        await lock.release()


@router.post(
    "/{session_id}/uploads/{attachment_id}/status",
    summary="Get current status of the attachment",
    response_model=S3AttachmentStatusResponse,
)
async def attachment_status(attachment_id: VerifiedAttachmentId, redis: RedisSession):
    status = await redis.get(get_attachment_status_key(attachment_id))
    if status is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return S3AttachmentStatusResponse(status=status)  # type: ignore
