import os
from functools import cache
from io import BytesIO
from urllib.parse import quote

import structlog.stdlib
from PIL import Image, UnidentifiedImageError
from sqlalchemy import URL

log = structlog.stdlib.get_logger(__name__)


@cache
def get_database_url() -> str:
    postgres_user = os.environ["POSTGRES_USER"]
    postgres_password = os.environ["POSTGRES_PASSWORD"]
    postgres_host = os.environ["POSTGRES_HOST"]
    postgres_port = int(os.getenv("POSTGRES_PORT", "5432"))
    postgres_database = os.environ["POSTGRES_DB"]

    url = URL.create(
        drivername="postgresql+asyncpg",
        username=postgres_user,
        password=postgres_password,
        host=postgres_host,
        port=postgres_port,
        database=postgres_database,
    )
    return url.render_as_string(hide_password=False)


@cache
def get_rabbitmq_url() -> str:
    rmq_user = os.environ["RABBITMQ_USER"]
    rmq_password = os.environ["RABBITMQ_PASS"]

    return f"amqp://{quote(rmq_user)}:{quote(rmq_password)}@rabbitmq:5672/taskiq"


@cache
def get_debug() -> bool:
    return os.getenv("DEBUG", "true").lower() not in ["0", "no", "false"]


@cache
def get_origins() -> list[str]:
    frontend_url = os.getenv("FRONTEND_URL")
    backend_url = os.getenv("BACKEND_URL")
    if frontend_url is None or backend_url is None:
        if not get_debug():
            log.error("FRONTEND_URL and BACKEND_URL not defined")
            raise RuntimeError("FRONTEND_URL and BACKEND_URL not defined")
        log.warning("FRONTEND_URL and BACKEND_URL are not defined, but debug mode is enabled, ignoring")
        return ["*"]
    return [backend_url, frontend_url]


MAX_DIMENSION = 2048
OUTPUT_SIZE = (200, 200)


def normalize_image(data: bytes) -> bytes:
    try:
        with Image.open(BytesIO(data)) as image:
            # Verify the actual image data, not just the file header.
            image.verify()

        # verify() invalidates the Image object, so reopen it.
        with Image.open(BytesIO(data)) as image:
            width, height = image.size

            if width > MAX_DIMENSION or height > MAX_DIMENSION:
                raise ValueError(
                    f"Image dimensions {width}x{height} exceed " f"the {MAX_DIMENSION}x{MAX_DIMENSION} limit"
                )

            # Convert to RGB so PNG/RGBA/etc. can safely become WebP.
            image = image.convert("RGB")

            # Center crop to a square.
            side = min(width, height)
            left = (width - side) // 2
            top = (height - side) // 2

            image = image.crop(
                (
                    left,
                    top,
                    left + side,
                    top + side,
                )
            )

            image = image.resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)

            output = BytesIO()
            image.save(output, format="WEBP", quality=85, optimize=True)

            return output.getvalue()

    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Uploaded file is not a valid image") from exc
