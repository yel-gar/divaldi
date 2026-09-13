from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.chat import MAX_FILENAME_LENGTH


class S3UploadParams(BaseModel):
    url: str
    fields: dict

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
    filename: str = Field(max_length=MAX_FILENAME_LENGTH)


class S3ChatUploadParams(BaseModel):
    attachment_id: int
    params: S3UploadParams


class S3AttachmentStatusResponse(BaseModel):
    status: Literal["uploading", "processing", "completed", "error"]


class S3AvatarUrlSchema(BaseModel):
    avatar_url: str | None
