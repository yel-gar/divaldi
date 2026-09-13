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
                "url": "http://localhost:9000/avatars",
                "fields": {
                    "Content-Type": "image/jpeg",
                    "key": "b5942871-dd53-464d-abee-3f048f942f67/avatar-unprocessed",
                    "AWSAccessKeyId": "minio",
                    "policy": "very-secret-key",
                    "signature": "very-secret-signature",
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


class S3AvatarUrlSchema(BaseModel):
    avatar_url: str | None


class S3AttachmentSchema(BaseModel):
    """Presigned download link for an attachment. Cached and short-lived; refetch if expired."""

    attachment_url: str
    filename: str
