import os
from functools import cache


def get_database_url() -> str:
    postgres_user = os.environ["POSTGRES_USER"]
    postgres_password = os.environ["POSTGRES_PASSWORD"]
    postgres_host = os.environ["POSTGRES_HOST"]
    postgres_port = os.getenv("POSTGRES_PORT", "5432")
    postgres_database = os.environ["POSTGRES_DB"]
    return (
        f"postgresql+asyncpg://{postgres_user}:{postgres_password}@{postgres_host}:{postgres_port}/{postgres_database}"
    )


@cache
def get_debug() -> bool:
    return os.getenv("DEBUG", "true").lower() not in ["0", "no", "false"]
