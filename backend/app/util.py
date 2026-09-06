import os
from functools import cache


def get_database_url() -> str:
    postgres_user = os.getenv("POSTGRES_USER", "postgres")
    postgres_password = os.getenv("POSTGRES_PASSWORD", "")
    postgres_host = os.getenv("POSTGRES_HOST", "localhost")
    postgres_port = os.getenv("POSTGRES_PORT", 5432)
    postgres_database = os.getenv("POSTGRES_DATABASE", "postgres")
    return f"postgresql+asyncpg://{postgres_user}:{postgres_password}@{postgres_host}:{postgres_port}/{postgres_database}"

@cache
def get_debug() -> bool:
    return os.getenv("DEBUG", "true").lower() not in ["0", "no", "false"]
