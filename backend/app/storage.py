import os
import uuid
from pathlib import PurePath

import aioboto3
from types_aiobotocore_s3.client import S3Client

MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024  # 5mb


class ObjectStorage:
    def __init__(self):
        self._region = os.getenv("S3_REGION", "garage")
        self._session = aioboto3.Session(
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name=self._region,
        )

    def internal_client(self) -> S3Client:
        """Client for calls the backend makes itself, over the Compose network."""
        return self._session.client(
            "s3",
            endpoint_url=os.getenv("S3_INTERNAL_URL", "http://garage:3900"),
            region_name=self._region,
        )

    def public_client(self) -> S3Client:
        """Client for presigning URLs the browser will fetch directly.

        The endpoint is baked into every presigned URL, so it has to be
        reachable from the user's machine and not only from inside Compose.
        """
        return self._session.client(
            "s3",
            endpoint_url=os.getenv("S3_PUBLIC_URL", "http://localhost:3900"),
            region_name=self._region,
        )


def get_s3_avatar_unprocessed_key(id: uuid.UUID) -> str:
    return f"avatars-unprocessed/{id}"


def get_s3_avatar_processed_key(id: uuid.UUID) -> str:
    return f"avatars/{id}"


def get_s3_attachment_key(session_id: uuid.UUID, filename: str) -> str:
    """
    Warning: this generates additional random UUID, so this function is not deterministic.
    The key should be stored in the database upon creation.
    """
    ext = PurePath(filename).suffix.lower()
    return f"attachments/{session_id}/{uuid.uuid4()}{ext}"


def get_s3_pdf_image_key(id: int) -> str:
    """
    Warning: non deterministic
    """
    return f"artifacts/pdf/{id}/{uuid.uuid4()}.png"


storage = ObjectStorage()
