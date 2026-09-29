import os
from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager, suppress

# These must be set before anything under `app` is imported. `app.storage` builds
# an `ObjectStorage` at import time and `app.providers.containers` builds the
# provider at import time, both reading `os.environ` directly. An autouse fixture
# is too late: fixtures run after collection, and these modules import during it.
_MINIO_ROOT_USER = "minioadmin"
_MINIO_ROOT_PASSWORD = "minioadmin"

os.environ.setdefault("SBER_API_KEY", "mock")
os.environ.setdefault("SBER_API_SCOPE", "PERS")
os.environ.setdefault("RABBITMQ_USER", "jut")
os.environ.setdefault("RABBITMQ_PASS", "jut")
os.environ.setdefault("TASKIQ_API_TOKEN", "jut")
os.environ.setdefault("MINIO_ROOT_USER", _MINIO_ROOT_USER)
os.environ.setdefault("MINIO_ROOT_PASSWORD", _MINIO_ROOT_PASSWORD)
# `app.main` reads these at import time to configure CORS, and raises when they
# are missing outside debug mode. Individual tests may still override them.
os.environ.setdefault("DEBUG", "1")
os.environ.setdefault("FRONTEND_URL", "http://frontend.test")
os.environ.setdefault("BACKEND_URL", "http://backend.test")

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from redis.asyncio import ConnectionPool, Redis  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.community.postgres import PostgresContainer  # noqa: E402
from testcontainers.community.redis import AsyncRedisContainer  # noqa: E402
from testcontainers.core.container import DockerContainer  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.cache import get_redis_pool  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.models.auth import User  # noqa: E402

MINIO_IMAGE = "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z.hotfix.7aa24e772"
MINIO_ROOT_USER = _MINIO_ROOT_USER
MINIO_ROOT_PASSWORD = _MINIO_ROOT_PASSWORD

#: Mirrors the buckets created by conf/minio-init.sh in the Compose stack.
S3_BUCKETS = ("avatars", "uploads")


@pytest.fixture(autouse=True)
def env(monkeypatch):
    """Re-apply the defaults per test, since some tests reload the provider module."""
    monkeypatch.setenv("SBER_API_KEY", "mock")
    monkeypatch.setenv("SBER_API_SCOPE", "PERS")
    monkeypatch.setenv("RABBITMQ_USER", "jut")
    monkeypatch.setenv("RABBITMQ_PASS", "jut")
    monkeypatch.setenv("TASKIQ_API_TOKEN", "jut")
    monkeypatch.setenv("MINIO_ROOT_USER", MINIO_ROOT_USER)
    monkeypatch.setenv("MINIO_ROOT_PASSWORD", MINIO_ROOT_PASSWORD)
    # Restored per test because a few tests deliberately change DEBUG/URLs.
    monkeypatch.setenv("DEBUG", "1")
    monkeypatch.setenv("FRONTEND_URL", "http://frontend.test")
    monkeypatch.setenv("BACKEND_URL", "http://backend.test")
    monkeypatch.delenv("MOCK_PROVIDER_MODE", raising=False)


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer]:
    with PostgresContainer("postgres:18-alpine", driver="asyncpg") as postgres:
        yield postgres


@pytest.fixture(scope="session")
def redis_container() -> Generator[AsyncRedisContainer]:
    with AsyncRedisContainer("redis:8") as redis:
        yield redis


@pytest.fixture(scope="session")
def minio_container() -> Generator[DockerContainer]:
    """A real MinIO, matching the object storage the Compose stack provides."""
    container = DockerContainer(
        MINIO_IMAGE,
        command="server /data",
        env={
            "MINIO_ROOT_USER": MINIO_ROOT_USER,
            "MINIO_ROOT_PASSWORD": MINIO_ROOT_PASSWORD,
        },
        ports=[9000, 9001],
    )
    container.start()
    try:
        yield container
    finally:
        container.stop()


@pytest_asyncio.fixture(scope="function")
async def redis_session(monkeypatch, redis_container: AsyncRedisContainer):
    """Point the real ``get_redis_client()`` at the test container.

    Patching the pool factory rather than ``get_redis_client`` matters: task
    modules do ``from app.cache import get_redis_client``, binding the name into
    their own module namespace. Patching ``app.cache.get_redis_client`` would
    leave those bindings untouched, so every worker test would still try to reach
    the ``redis`` hostname. Patching the pool means all call sites work unchanged.
    """
    host = redis_container.get_container_host_ip()
    port = redis_container.get_exposed_port(6379)
    pool = ConnectionPool.from_url(f"redis://{host}:{port}/0", decode_responses=True)
    monkeypatch.setattr("app.cache.get_redis_pool", lambda: pool)
    get_redis_pool.cache_clear()
    try:
        yield
    finally:
        await pool.disconnect()
        get_redis_pool.cache_clear()


@pytest_asyncio.fixture(scope="session")
async def engine(postgres_container: PostgresContainer):
    url = postgres_container.get_connection_url()
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # type: ignore
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture()
async def redis_client(redis_session: None) -> AsyncGenerator[Redis]:
    """A ready-to-use Redis connection.

    Built from ``get_redis_client()`` rather than the raw pool, so it inherits the
    patched test-container URL. ``get_connection()`` is a coroutine on redis-py 8
    and must be awaited.
    """
    from app.cache import get_redis_client

    async with get_redis_client() as conn:
        yield conn


@pytest_asyncio.fixture()
async def task_db(monkeypatch, engine: AsyncEngine):
    """Bind ``tsq_db()`` inside the workers to the test database.

    Task bodies open their own session via ``app.tasks.conf.broker.tsq_db``, which
    resolves ``app.database.get_session_maker()`` — a separate, ``lru_cache``d
    engine built from the ``POSTGRES_*`` environment. Without this a worker test
    would quietly write to whatever PostgreSQL the environment points at instead
    of the throwaway container.
    """
    from app import database
    from app.tasks.conf import broker as broker_module

    # Grab the lru_cache'd function before replacing the module attribute, so the
    # cache can still be cleared in teardown.
    cached_session_maker = database.get_session_maker
    cached_session_maker.cache_clear()

    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(database, "get_session_maker", lambda: maker)

    @asynccontextmanager
    async def _tsq_db():
        async with maker() as session:
            yield session

    # The task modules do `from app.tasks.conf.broker import tsq_db`, which binds
    # the name into their own namespace. Patching only the defining module leaves
    # those bindings pointing at the real database, so every consumer is patched.
    monkeypatch.setattr(broker_module, "tsq_db", _tsq_db)
    for module_name in ("app.tasks.api", "app.tasks.files", "app.tasks.users"):
        monkeypatch.setattr(f"{module_name}.tsq_db", _tsq_db)
    yield
    cached_session_maker.cache_clear()


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
async def s3(minio_container: DockerContainer, monkeypatch):
    """A real MinIO wired into ``app.storage.storage``, buckets pre-created.

    Readiness is handled by retrying bucket creation rather than a log wait:
    MinIO is not listening the instant the container reports started, and a
    retry loop fails with the actual S3 error if it never comes up.
    """
    import asyncio

    import aioboto3

    from app.storage import storage

    endpoint = f"http://{minio_container.get_container_host_ip()}:{minio_container.get_exposed_port(9000)}"

    session = aioboto3.Session(
        aws_access_key_id=MINIO_ROOT_USER,
        aws_secret_access_key=MINIO_ROOT_PASSWORD,
    )
    last_error: Exception | None = None
    for _ in range(30):
        try:
            async with session.client("s3", endpoint_url=endpoint) as raw:
                for bucket in S3_BUCKETS:
                    # Already-exists is fine: buckets are shared across tests.
                    with suppress(Exception):
                        await raw.create_bucket(Bucket=bucket)
            last_error = None
            break
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(0.5)
    if last_error is not None:
        raise RuntimeError(f"MinIO never became ready at {endpoint}") from last_error

    monkeypatch.setattr(storage, "internal_client", lambda: _client(endpoint))
    monkeypatch.setattr(storage, "public_client", lambda: _client(endpoint))
    yield


def _client(endpoint: str):
    import aioboto3

    return aioboto3.Session(
        aws_access_key_id=MINIO_ROOT_USER,
        aws_secret_access_key=MINIO_ROOT_PASSWORD,
    ).client("s3", endpoint_url=endpoint)


@pytest_asyncio.fixture()
async def chat_session(db_session: AsyncSession, test_user: User):
    """A chat session owned by ``test_user``."""
    from app.models.chat import ChatSession

    session = ChatSession(user_id=test_user.id, name="Новый чат")
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(session)
    return session


@pytest_asyncio.fixture()
async def factories(db_session: AsyncSession):
    """Small helpers for building chat rows without repeating boilerplate."""

    from app.models.chat import Attachment, ChatMessage, ChatSession, UserRole

    async def make_session(user_id: int, name: str = "Новый чат") -> ChatSession:
        row = ChatSession(user_id=user_id, name=name)
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        return row

    async def make_message(
        session_id,
        content: str = "hello",
        role: UserRole = UserRole.USER,
        files_str: str | None = None,
        display_text: str | None = None,
    ) -> ChatMessage:
        row = ChatMessage(
            chat_session_id=session_id,
            role=role,
            content=content,
            files_str=files_str,
            display_text=display_text,
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        return row

    async def make_attachment(
        session_id,
        name: str = "drawing.pdf",
        s3_key: str | None = None,
        ready: bool = False,
        chat_message_id: int | None = None,
    ) -> Attachment:
        row = Attachment(
            session_id=session_id,
            name=name,
            s3_key=s3_key or f"attachments/{session_id}/{name}",
            ready=ready,
            chat_message_id=chat_message_id,
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        return row

    return type(
        "Factories",
        (),
        {
            "session": staticmethod(make_session),
            "message": staticmethod(make_message),
            "attachment": staticmethod(make_attachment),
        },
    )()


@pytest_asyncio.fixture()
async def s3_put(s3: None):
    """Store bytes in MinIO and return the key."""

    from app.storage import storage

    async def _put(data: bytes, key: str, bucket: str = "uploads", content_type: str = "application/pdf"):
        async with storage.internal_client() as client:
            await client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
        return key

    return _put


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


@pytest.fixture()
def mock_mode(monkeypatch):
    """Switch the mock provider's behaviour within a test."""

    def _set(mode: str) -> None:
        monkeypatch.setenv("MOCK_PROVIDER_MODE", mode)

    return _set


@pytest.fixture()
def anyio_backend():
    return "asyncio"
