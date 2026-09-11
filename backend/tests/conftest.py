from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import AsyncRedisContainer

from app.auth import hash_password
from app.database import Base, get_db
from app.models.auth import User


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("SBER_API_KEY", "mock")
    monkeypatch.setenv("SBER_API_SCOPE", "PERS")
    monkeypatch.setenv("RABBITMQ_USER", "jut")
    monkeypatch.setenv("RABBITMQ_PASS", "jut")
    monkeypatch.setenv("TASKIQ_API_TOKEN", "jut")


@pytest.fixture(scope="session")
def postgres_container():
    with PostgresContainer("postgres:18-alpine", driver="asyncpg") as postgres:
        yield postgres


@pytest.fixture(scope="session")
def redis_container():
    with AsyncRedisContainer("redis:8") as redis_container:
        yield redis_container


@pytest.fixture(scope="function")
def redis_session(monkeypatch, redis_container: AsyncRedisContainer):
    @asynccontextmanager
    async def get_fake_redis_client() -> AsyncGenerator[Redis]:
        client = await redis_container.get_async_client()
        yield client

    monkeypatch.setattr("app.cache.get_redis_client", get_fake_redis_client)


@pytest_asyncio.fixture(scope="session")
async def engine(postgres_container: PostgresContainer):
    url = postgres_container.get_connection_url()
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # type: ignore
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture()
async def db_session(engine: AsyncEngine):
    async with engine.connect() as conn, conn.begin() as transaction:
        session_maker = async_sessionmaker(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        session = session_maker()
        yield session
        await session.close()
        await transaction.rollback()


@pytest_asyncio.fixture()
async def client(db_session: AsyncSession):
    from app.main import app as main_app

    async def override_get_db():
        yield db_session

    main_app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=main_app)
    async with AsyncClient(transport=transport, base_url="http://test/api/v1") as ac:
        yield ac
    main_app.dependency_overrides.clear()


@pytest_asyncio.fixture()
async def test_user(db_session: AsyncSession):
    user = User(username="test", password_hash=hash_password("password1234"))
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def test_100_users(db_session: AsyncSession):
    password_hash = hash_password("amongus")
    users = [User(username=f"test-{i}", password_hash=password_hash) for i in range(100)]
    db_session.add_all(users)
    await db_session.commit()
    return (await db_session.execute(select(User).order_by(User.id))).scalars().all()


@pytest_asyncio.fixture()
async def test_admin_user(db_session: AsyncSession):
    user = User(
        username="admin",
        password_hash=hash_password("admin-password"),
        is_superuser=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def admin_client(
    client: AsyncClient,
    test_admin_user: User,
):
    response = await client.post(
        "/auth/login",
        json={
            "username": "admin",
            "password": "admin-password",
        },
    )
    assert response.status_code == 200

    return client
