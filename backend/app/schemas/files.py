from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.chat import MAX_FILENAME_LENGTH


class S3UploadParams(BaseModel):
    """Parameters for a presigned POST upload directly to S3-compatible storage."""

    url: str = Field(description="URL to POST the file to")
    fields: dict = Field(description="Form fields to include in the POST request body, alongside the file")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "url": "http://localhost:3900/avatars",
                "fields": {
                    "Content-Type": "image/jpeg",
                    "key": "avatars-unprocessed/b5942871-dd53-464d-abee-3f048f942f67",
                    "x-amz-algorithm": "AWS4-HMAC-SHA256",
                    "x-amz-credential": "GK.../20260101/garage/s3/aws4_request",
                    "policy": "very-secret-key",
                    "x-amz-signature": "very-secret-signature",
                },
            }
        }
    )


class S3UploadRequest(BaseModel):
    content_type: str = Field(max_length=64)
    file_size: int = Field(description="File size in bytes")


class S3ChatUploadRequest(S3UploadRequest):
    """Request body to obtain an upload URL for a chat attachment."""

    filename: str = Field(max_length=MAX_FILENAME_LENGTH)


class S3ChatUploadParams(BaseModel):
    """Response to a chat upload request: attachment reference plus where to upload it."""

    attachment_id: int = Field(description="Use this id to confirm the upload and to track its status")
    params: S3UploadParams


class S3AttachmentStatusResponse(BaseModel):
    status: Literal["uploading", "processing", "completed", "error"]


#: Same values as `S3AttachmentStatusResponse.status`, plus `unknown` for the case where the
#: Redis status key has already expired while the attachment row still exists.
ChatSessionAttachmentStatus = Literal["uploading", "processing", "completed", "error", "unknown"]


class ChatSessionAttachmentSchema(BaseModel):
    """
    A file currently on a chat session, whether or not a message references it yet.

    `status` is read from the Redis upload state and is therefore ephemeral; `ready`
    is the durable database flag and survives the status key's TTL.
    """

    id: int
    filename: str
    status: ChatSessionAttachmentStatus
    ready: bool = Field(description="True once processing finished, so the file may be sent in a message")
    chat_message_id: int | None = Field(
        description="Message the file belongs to, null while it is still staged for the next message"
    )
    timestamp: datetime


class AttachmentDeletedResponse(BaseModel):
    deleted: bool = Field(description="Always true: an attachment that is already gone answers 404")


class S3AvatarUrlSchema(BaseModel):
    avatar_url: str | None


class S3AttachmentSchema(BaseModel):
    """Presigned download link for an attachment. Cached and short-lived; refetch if expired."""

    attachment_url: str
    filename: str
