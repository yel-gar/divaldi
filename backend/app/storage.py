import os
import uuid

import aioboto3
from types_aiobotocore_s3.client import S3Client

MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024  # 5mb


class ObjectStorage:
    def __init__(self):
        self._session = aioboto3.Session(
            aws_access_key_id=os.getenv("MINIO_ROOT_USER", "minio"),
            aws_secret_access_key=os.environ["MINIO_ROOT_PASSWORD"],
        )

    def internal_client(self) -> S3Client:
        return self._session.client("s3", endpoint_url="http://minio:9000")

    def public_client(self) -> S3Client:
        return self._session.client("s3", endpoint_url=os.getenv("MINIO_URL", "http://localhost:9000"))


def get_s3_avatar_unprocessed_key(id: uuid.UUID) -> str:
    return f"avatars-unprocessed/{id}"


def get_s3_avatar_processed_key(id: uuid.UUID) -> str:
    return f"avatars/{id}"


storage = ObjectStorage()
