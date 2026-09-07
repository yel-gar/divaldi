import os
from functools import cache

from sqlalchemy import URL


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
