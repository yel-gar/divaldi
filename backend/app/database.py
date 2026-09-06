from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.util import get_database_url


@lru_cache
def get_engine():
    return create_async_engine(get_database_url())


@lru_cache
def get_session_maker():
    return async_sessionmaker(get_engine(), expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession]:
    session_maker = get_session_maker()
    async with session_maker() as session:
        yield session
