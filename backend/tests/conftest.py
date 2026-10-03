import os
import time
from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager

# These must be set before anything under `app` is imported. `app.storage` builds
# an `ObjectStorage` at import time and `app.providers.containers` builds the
# provider at import time, both reading `os.environ` directly. An autouse fixture
# is too late: fixtures run after collection, and these modules import during it.
# Garage has no way to pre-declare an S3 key in its config, so tests import a
# key the same way conf/garage-init.sh does: by pinning the id and secret here
# and calling `garage key import` against the container.
_S3_ACCESS_KEY = "GKd1a1b2c3d4e5f60718293a4b5c6d"
_S3_SECRET_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
_GARAGE_RPC_SECRET = _S3_SECRET_KEY
_GARAGE_ADMIN_TOKEN = _S3_SECRET_KEY

os.environ.setdefault("SBER_API_KEY", "mock")
os.environ.setdefault("SBER_API_SCOPE", "PERS")
os.environ.setdefault("RABBITMQ_USER", "jut")
os.environ.setdefault("RABBITMQ_PASS", "jut")
os.environ.setdefault("TASKIQ_API_TOKEN", "jut")
os.environ.setdefault("S3_ACCESS_KEY", _S3_ACCESS_KEY)
os.environ.setdefault("S3_SECRET_KEY", _S3_SECRET_KEY)
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
from app.models.auth import AccountRole, User  # noqa: E402

GARAGE_IMAGE = "dxflrs/garage:v2.4.1"
S3_ACCESS_KEY = _S3_ACCESS_KEY
S3_SECRET_KEY = _S3_SECRET_KEY
S3_REGION = "garage"
GARAGE_S3_PORT = 3900

#: Mirrors the buckets created by conf/garage-init.sh in the Compose stack.
S3_BUCKETS = ("avatars", "uploads")

#: Minimal Garage config for the test container. The test container is a single
#: node, so `--single-node` assigns the cluster layout at startup and no separate
#: layout bootstrap is needed. `rpc_public_addr` is deliberately absent: the CLI
#: runs inside the container, where the default loopback works.
GARAGE_CONFIG = """
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "lmdb"
replication_factor = 1
rpc_bind_addr = "0.0.0.0:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "{rpc_secret}"
[s3_api]
s3_region = "{region}"
api_bind_addr = "0.0.0.0:3900"
root_domain = ".s3.garage.localhost"
[admin]
admin_bind_addr = "0.0.0.0:3903"
"""


@pytest.fixture(autouse=True)
def env(monkeypatch):
    """Re-apply the defaults per test, since some tests reload the provider module."""
    monkeypatch.setenv("SBER_API_KEY", "mock")
    monkeypatch.setenv("SBER_API_SCOPE", "PERS")
    monkeypatch.setenv("RABBITMQ_USER", "jut")
    monkeypatch.setenv("RABBITMQ_PASS", "jut")
    monkeypatch.setenv("TASKIQ_API_TOKEN", "jut")
    monkeypatch.setenv("S3_ACCESS_KEY", S3_ACCESS_KEY)
    monkeypatch.setenv("S3_SECRET_KEY", S3_SECRET_KEY)
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
def garage_container(tmp_path_factory) -> Generator[DockerContainer]:
    """A real Garage, matching the object storage the Compose stack provides.

    Garage differs from MinIO in two ways that shape this fixture. It needs a
    config file rather than environment-only settings, because ``rpc_secret`` and
    the metadata paths have no useful default. And it has no root credentials:
    access keys are created explicitly, so the key is imported before the S3 API
    is usable and buckets have to be created through the CLI, since an S3
    ``CreateBucket`` needs permissions the key does not have yet.
    """
    config_dir = tmp_path_factory.mktemp("garage")
    config = config_dir / "garage.toml"
    config.write_text(
        GARAGE_CONFIG.format(rpc_secret=_GARAGE_RPC_SECRET, region=S3_REGION),
        encoding="utf-8",
    )
    # Metadata holds the cluster layout and the key database, so it must survive
    # independently of the data directory.
    meta_dir = tmp_path_factory.mktemp("garage-meta")
    data_dir = tmp_path_factory.mktemp("garage-data")

    container = DockerContainer(
        GARAGE_IMAGE,
        # The image has no entrypoint, only a CMD of `/garage server`, so the
        # binary has to be named here.
        command="/garage server --single-node",
        env={"GARAGE_ADMIN_TOKEN": _GARAGE_ADMIN_TOKEN},
        ports=[GARAGE_S3_PORT, 3903],
    )
    container.with_volume_mapping(str(config), "/etc/garage.toml", "ro")
    # Both directories need "rw". testcontainers defaults a volume mapping to
    # read-only, and Garage creates its own LMDB directory inside the mount point
    # rather than being handed a pre-made one, so a read-only bind makes it exit
    # with "Unable to create LMDB data directory: Read-only file system".
    container.with_volume_mapping(str(meta_dir), "/var/lib/garage/meta", "rw")
    container.with_volume_mapping(str(data_dir), "/var/lib/garage/data", "rw")
    container.start()
    try:
        _wait_for_garage(container)
        _bootstrap_garage(container)
        yield container
    finally:
        container.stop()


def _bootstrap_garage(container: DockerContainer) -> None:
    """Import the application key and create both buckets.

    Done once per session rather than per test, because Garage keys and buckets
    live in the metadata volume and outlive any single test.
    """
    _garage_cli(
        container,
        "key",
        "import",
        S3_ACCESS_KEY,
        S3_SECRET_KEY,
        "--yes",
        "-n",
        "divaldi-app",
        tolerate=True,
    )
    for bucket in S3_BUCKETS:
        # Tolerated: on a re-run against the same volume the bucket exists.
        _garage_cli(container, "bucket", "create", bucket, tolerate=True)
        _garage_cli(
            container,
            "bucket",
            "allow",
            "--read",
            "--write",
            "--owner",
            bucket,
            "--key",
            S3_ACCESS_KEY,
            tolerate=True,
        )


def _wait_for_garage(container: DockerContainer, attempts: int = 60) -> None:
    """Block until the CLI reports a healthy cluster.

    Garage binds its RPC port before the cluster layout is usable, so a container
    that has merely started will refuse bucket operations. Polling the CLI is
    what the Compose bootstrap does too.
    """
    last_error = ""
    for _ in range(attempts):
        exit_code, output = container.exec("/garage status")
        if exit_code == 0:
            return
        last_error = output.decode(errors="replace")
        time.sleep(1)
    raise RuntimeError(f"Garage never became ready: {last_error}")


def _garage_cli(container: DockerContainer, *args: str, tolerate: bool = False) -> str:
    """Run the ``garage`` CLI inside the container and return its output.

    ``tolerate`` swallows the failure, for steps that legitimately fail on a
    re-run because the resource already exists.
    """
    exit_code, output = container.exec(f"/garage {' '.join(args)}")
    text = output.decode(errors="replace")
    if exit_code != 0 and not tolerate:
        raise RuntimeError(f"garage {' '.join(args)} failed ({exit_code}): {text}")
    return text


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


@pytest_asyncio.fixture(scope="function")
async def s3(garage_container: DockerContainer, monkeypatch):
    """A real Garage wired into ``app.storage.storage``, buckets pre-created.

    The key import and bucket creation happen once, in the session-scoped
    ``garage_container`` fixture, because they are cluster-level operations that
    need the CLI: an S3 ``CreateBucket`` requires permissions a freshly imported
    key does not have yet.
    """
    from app.storage import storage

    endpoint = (
        f"http://{garage_container.get_container_host_ip()}" f":{garage_container.get_exposed_port(GARAGE_S3_PORT)}"
    )

    monkeypatch.setattr(storage, "internal_client", lambda: _client(endpoint))
    monkeypatch.setattr(storage, "public_client", lambda: _client(endpoint))
    monkeypatch.setenv("S3_INTERNAL_URL", endpoint)
    monkeypatch.setenv("S3_PUBLIC_URL", endpoint)
    monkeypatch.setenv("S3_REGION", S3_REGION)
    yield


def _client(endpoint: str):
    import aioboto3

    return aioboto3.Session(
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
    ).client("s3", endpoint_url=endpoint, region_name=S3_REGION)


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
        role=AccountRole.SUPERUSER,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
async def test_tier_admin_user(db_session: AsyncSession):
    """A user on the admin tier: manages plain users, but not other admins."""
    user = User(
        username="tier-admin",
        password_hash=hash_password("tier-admin-password"),
        role=AccountRole.ADMIN,
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


@pytest_asyncio.fixture()
async def tier_admin_client(
    client: AsyncClient,
    test_tier_admin_user: User,
):
    response = await client.post(
        "/auth/login",
        json={
            "username": "tier-admin",
            "password": "tier-admin-password",
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
