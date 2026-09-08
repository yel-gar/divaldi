import os
from functools import cache

import structlog.stdlib
from sqlalchemy import URL

log = structlog.stdlib.get_logger(__name__)


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
