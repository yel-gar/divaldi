"""Tests for the chat workers in ``app.tasks.api``.

Every test here drives the real task bodies through :func:`tests.helpers.run_task`,
so the database, Redis and MinIO work the workers do is genuinely executed. The
only thing stubbed out is the enqueue itself (``process_response.kiq``), which
would otherwise need a live RabbitMQ.
"""

import json
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.auth import hash_password
from app.cache import get_deletion_key, get_generation_key, get_redis_client
from app.models.auth import User
from app.models.chat import (
    MAX_CHAT_NAME_LENGTH,
    Attachment,
    ChatMessage,
    ChatSession,
    GenerationResult,
    GenerationResultType,
    UserRole,
)
from app.providers.models import Position
from app.storage import storage
from app.tasks import api
from tests.helpers import run_task

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

#: ``MATERIALS[12]`` — a grade the shipped ``res/calc.xlsx`` template is priced
#: for, so ``process_calculation`` can always resolve it.
MATERIAL_INDEX = 12


# --------------------------------------------------------------------------------------
# payload helpers
# --------------------------------------------------------------------------------------


def position_payload(index: int = 0) -> dict:
    return {
        "name": f"Деталь {index + 1}",
        "material": MATERIAL_INDEX,
        "area_m2": 0.5,
        "laser_m": 1.0,
        "bends": 2,
        "welding_m": 0.5,
        "turning_hours": 0.0,
        "painting_m2": 1.0,
    }


def position(index: int = 0) -> Position:
    return Position(**position_payload(index))


def payload(
    *,
    chat_name: str | None = "Расчёт детали",
    message: str = "Готово, расчёт выполнен.",
    gen_kp: bool = True,
    positions: list[dict] | None = None,
) -> str:
    return json.dumps(
        {
            "chat_name": chat_name,
            "message": message,
            "gen_kp": gen_kp,
            "positions": [position_payload()] if positions is None else positions,
        },
        ensure_ascii=False,
    )


class JobRecorder:
    """Stand-in for ``_generate_kp_job`` that records what it was handed."""

    def __init__(self) -> None:
        self.calls: list[list[Position]] = []

    def __call__(self, positions: list[Position]) -> bytes:
        self.calls.append(positions)
        return b"PK fake workbook"


class FalsyResponse:
    """A provider response object that is falsy but not ``None``.

    ``generate_chat_message`` guards its provider output twice: once with
    ``is None`` (which raises and is reported as an internal error) and once with
    a plain truthiness check, which only a response that is falsy without being
    ``None`` can reach.
    """

    def __bool__(self) -> bool:
        return False


# --------------------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------------------


class Rows:
    """Rows committed for real, then removed again.

    ``db_session`` writes inside a transaction that is rolled back, while the task
    bodies open their own connection through ``tsq_db``. A worker therefore cannot
    see anything ``db_session`` left uncommitted, so the data these tests need has
    to be committed on its own connection and cleaned up explicitly.
    """

    def __init__(self, maker: async_sessionmaker):
        self._maker = maker
        self._session_ids: list[uuid.UUID] = []
        self._user_ids: list[int] = []

    @asynccontextmanager
    async def session(self):
        async with self._maker() as db:
            yield db

    async def user(self, username: str = "worker-test") -> User:
        async with self.session() as db:
            row = User(username=username, password_hash=hash_password("password1234"))
            db.add(row)
            await db.commit()
            await db.refresh(row)
        self._user_ids.append(row.id)
        return row

    async def chat_session(self, user: User, name: str = "Новый чат") -> ChatSession:
        async with self.session() as db:
            row = ChatSession(session_id=uuid.uuid4(), user_id=user.id, name=name)
            db.add(row)
            await db.commit()
            await db.refresh(row)
        self._session_ids.append(row.session_id)
        return row

    async def message(self, session_id: uuid.UUID, content: str = "Считай, пожалуйста") -> ChatMessage:
        async with self.session() as db:
            row = ChatMessage(chat_session_id=session_id, role=UserRole.USER, content=content)
            db.add(row)
            await db.commit()
            await db.refresh(row)
        return row

    async def result(
        self,
        session_id: uuid.UUID,
        *,
        type: GenerationResultType = GenerationResultType.SUCCESS,
        content: str = "старое",
        timestamp: datetime | None = None,
    ) -> GenerationResult:
        async with self.session() as db:
            row = GenerationResult(chat_session_id=session_id, type=type, content=content, timestamp=timestamp)
            db.add(row)
            await db.commit()
            await db.refresh(row)
        return row

    async def drop_sessions(self, session_ids: list[uuid.UUID]) -> None:
        async with self.session() as db:
            for session_id in session_ids:
                await db.execute(delete(ChatSession).where(ChatSession.session_id == session_id))
            await db.commit()
        self._session_ids = [sid for sid in self._session_ids if sid not in session_ids]

    async def purge(self) -> None:
        async with self.session() as db:
            await db.execute(delete(ChatSession).where(ChatSession.session_id.in_(self._session_ids)))
            await db.execute(delete(User).where(User.id.in_(self._user_ids)))
            await db.commit()
        self._session_ids.clear()
        self._user_ids.clear()


@pytest_asyncio.fixture()
async def rows(engine: AsyncEngine):
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    helper = Rows(maker)
    try:
        yield helper
    finally:
        await helper.purge()


class RedisKeys:
    """Redis helper that removes every key it touched during teardown."""

    def __init__(self) -> None:
        self._tracked: list[str] = []

    def track(self, key: str) -> str:
        self._tracked.append(key)
        return key

    async def put(self, key: str, value: str = "1", ex: int = 300) -> str:
        self.track(key)
        async with get_redis_client() as redis:
            await redis.set(key, value, ex=ex)
        return key

    async def get(self, key: str):
        async with get_redis_client() as redis:
            return await redis.get(key)

    async def purge(self) -> None:
        if not self._tracked:
            return
        async with get_redis_client() as redis:
            await redis.delete(*self._tracked)
        self._tracked.clear()


@pytest_asyncio.fixture()
async def redis_keys(redis_session) -> RedisKeys:
    helper = RedisKeys()
    try:
        yield helper
    finally:
        await helper.purge()


@pytest.fixture()
def kiq_spy(monkeypatch) -> AsyncMock:
    """Capture ``process_response.kiq`` instead of publishing to RabbitMQ."""
    spy = AsyncMock(name="process_response.kiq")
    monkeypatch.setattr(api.process_response, "kiq", spy)
    return spy


# --------------------------------------------------------------------------------------
# _generate_kp_job / _generate_kp
# --------------------------------------------------------------------------------------


def test_generate_kp_job_returns_a_workbook():
    data = api._generate_kp_job([position()])

    assert isinstance(data, bytes)
    assert data[:2] == b"PK", "an xlsx file is a zip archive"


async def test_generate_kp_uploads_the_workbook(rows, s3):
    user = await rows.user()
    session = await rows.chat_session(user)

    attachment = await api._generate_kp(session.session_id, [position()])

    assert attachment.name == "kp.xlsx"
    assert attachment.ready is True
    assert attachment.session_id == session.session_id
    assert attachment.s3_key.startswith(f"attachments/{session.session_id}/")
    assert attachment.s3_key.endswith(".xlsx")

    async with storage.internal_client() as client:
        head = await client.head_object(Bucket="uploads", Key=attachment.s3_key)
        response = await client.get_object(Bucket="uploads", Key=attachment.s3_key)
        async with response["Body"] as body:
            stored = await body.read()
    assert head["ContentType"] == XLSX_CONTENT_TYPE
    assert stored[:2] == b"PK"
    # The attachment is handed back, not persisted — the caller owns the session.
    async with rows.session() as db:
        assert await db.scalar(select(func.count()).select_from(Attachment)) == 0


async def test_generate_kp_truncates_more_than_ten_positions(rows, s3, monkeypatch):
    recorder = JobRecorder()
    monkeypatch.setattr(api, "_generate_kp_job", recorder)
    user = await rows.user()
    session = await rows.chat_session(user)

    attachment = await api._generate_kp(session.session_id, [position(i) for i in range(12)])

    assert len(recorder.calls) == 1
    assert [p.name for p in recorder.calls[0]] == [f"Деталь {i + 1}" for i in range(10)]
    assert attachment.ready is True


# --------------------------------------------------------------------------------------
# _add_error_result
# --------------------------------------------------------------------------------------


async def test_add_error_result_writes_the_error_and_releases_the_lock(rows, redis_keys):
    user = await rows.user()
    session = await rows.chat_session(user)
    key = await redis_keys.put(get_generation_key(user.uuid))

    async with rows.session() as db:
        await api._add_error_result(db, session.session_id, "что-то сломалось", user.uuid)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "что-то сломалось"
    assert await redis_keys.get(key) is None


# --------------------------------------------------------------------------------------
# cleanup_old_results
# --------------------------------------------------------------------------------------


async def test_cleanup_old_results_deletes_only_stale_rows(task_db, rows):
    user = await rows.user()
    old_session = await rows.chat_session(user)
    fresh_session = await rows.chat_session(user)
    stale = await rows.result(old_session.session_id, timestamp=datetime.now(tz=UTC) - timedelta(hours=2))
    fresh = await rows.result(fresh_session.session_id, timestamp=datetime.now(tz=UTC) - timedelta(minutes=5))

    await run_task(api.cleanup_old_results)

    async with rows.session() as db:
        assert await db.get(GenerationResult, stale.chat_session_id) is None
        kept = await db.get(GenerationResult, fresh.chat_session_id)
    assert kept is not None
    assert kept.content == fresh.content


async def test_cleanup_old_results_is_idempotent(task_db, rows):
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.result(session.session_id, timestamp=datetime.now(tz=UTC) - timedelta(hours=2))

    await run_task(api.cleanup_old_results)
    await run_task(api.cleanup_old_results)

    async with rows.session() as db:
        assert await db.scalar(select(func.count()).select_from(GenerationResult)) == 0


# --------------------------------------------------------------------------------------
# generate_chat_message
# --------------------------------------------------------------------------------------


async def test_generate_chat_message_enqueues_process_response(task_db, rows, redis_keys, kiq_spy, mock_mode):
    mock_mode("kp")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id, "Посчитай кронштейн")

    await run_task(api.generate_chat_message, session.session_id)

    kiq_spy.assert_awaited_once()
    args = kiq_spy.await_args.args
    assert args[0] == user.uuid
    assert args[1] == session.session_id
    assert json.loads(args[2])["gen_kp"] is True
    # No result is written by this task: that is process_response's job.
    async with rows.session() as db:
        assert await db.scalar(select(func.count()).select_from(GenerationResult)) == 0


async def test_generate_chat_message_clears_a_stale_result_and_takes_the_lock(
    task_db, rows, redis_keys, kiq_spy, mock_mode
):
    mock_mode("kp")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    await rows.result(
        session.session_id,
        type=GenerationResultType.ERROR,
        content="прошлый провал",
        timestamp=datetime.now(tz=UTC),
    )

    await run_task(api.generate_chat_message, session.session_id)

    async with rows.session() as db:
        assert await db.get(GenerationResult, session.session_id) is None
    assert await redis_keys.get(get_generation_key(user.uuid)) == "1"
    kiq_spy.assert_awaited_once()


async def test_generate_chat_message_without_messages_writes_an_error(task_db, rows, redis_keys, kiq_spy, mock_mode):
    mock_mode("kp")
    user = await rows.user()
    session = await rows.chat_session(user)
    key = redis_keys.track(get_generation_key(user.uuid))

    await run_task(api.generate_chat_message, session.session_id)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "Invalid message session: no messages to send"
    assert await redis_keys.get(key) is None
    kiq_spy.assert_not_awaited()


async def test_generate_chat_message_with_null_provider_response_writes_an_error(
    task_db, rows, redis_keys, kiq_spy, mock_mode
):
    mock_mode("error")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    key = redis_keys.track(get_generation_key(user.uuid))

    await run_task(api.generate_chat_message, session.session_id)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "Internal server error occurred"
    assert await redis_keys.get(key) is None
    kiq_spy.assert_not_awaited()


async def test_generate_chat_message_with_contentless_response_writes_an_error(
    task_db, rows, redis_keys, kiq_spy, mock_mode
):
    mock_mode("empty")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    key = redis_keys.track(get_generation_key(user.uuid))

    await run_task(api.generate_chat_message, session.session_id)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "Provider did not respond properly"
    assert await redis_keys.get(key) is None
    kiq_spy.assert_not_awaited()


async def test_generate_chat_message_with_falsy_provider_response_writes_an_error(
    task_db, rows, redis_keys, kiq_spy, monkeypatch
):
    monkeypatch.setattr(api.provider, "generate", AsyncMock(return_value=FalsyResponse()))
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    key = redis_keys.track(get_generation_key(user.uuid))

    await run_task(api.generate_chat_message, session.session_id)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "Internal server error occurred, please try again later or contact support."
    # This branch writes the result inline instead of going through
    # ``_add_error_result``, so nothing releases the generation lock here. It only
    # expires on its own TTL, which is what the assertion below pins down.
    assert await redis_keys.get(key) == "1"
    kiq_spy.assert_not_awaited()


async def test_generate_chat_message_stops_on_a_deletion_tombstone(task_db, rows, redis_keys, kiq_spy, mock_mode):
    mock_mode("kp")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    await redis_keys.put(get_deletion_key(session.session_id))

    await run_task(api.generate_chat_message, session.session_id)

    kiq_spy.assert_not_awaited()
    # The response is dropped, but process_response never runs, so nothing is stored.
    async with rows.session() as db:
        assert await db.scalar(select(func.count()).select_from(GenerationResult)) == 0


async def test_generate_chat_message_skips_when_the_generation_lock_is_held(
    task_db, rows, redis_keys, kiq_spy, mock_mode
):
    mock_mode("kp")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    key = await redis_keys.put(get_generation_key(user.uuid))

    await run_task(api.generate_chat_message, session.session_id)

    assert await redis_keys.get(key) == "1", "the running task keeps the lock, not this one"
    kiq_spy.assert_not_awaited()
    async with rows.session() as db:
        assert await db.scalar(select(func.count()).select_from(GenerationResult)) == 0


async def test_generate_chat_message_without_an_owning_user_reports_an_error(task_db, redis_keys, monkeypatch):
    add_error = AsyncMock()
    monkeypatch.setattr(api, "_add_error_result", add_error)
    session = uuid.uuid4()

    await run_task(api.generate_chat_message, session)

    add_error.assert_awaited_once()
    assert add_error.await_args.args[1] == session
    assert add_error.await_args.args[2] == "Invalid message session"


async def test_generate_chat_message_for_a_missing_session_hits_the_foreign_key(task_db, redis_keys):
    """The ``no_user_for_session`` guard cannot persist anything for a phantom session.

    ``_add_error_result`` inserts a ``GenerationResult`` keyed by the session id,
    and that column references ``chat_sessions``. When the session really is gone
    the insert fails, so the task raises instead of returning quietly.
    """
    with pytest.raises(IntegrityError):
        await run_task(api.generate_chat_message, uuid.uuid4())


async def test_generate_chat_message_reports_an_unexpected_failure(task_db, rows, redis_keys, mock_mode):
    """A failure outside the provider call still produces an error result and unlocks."""
    mock_mode("kp")
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.message(session.session_id)
    key = redis_keys.track(get_generation_key(user.uuid))
    boom = AsyncMock(side_effect=RuntimeError("broker is down"))
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(api.process_response, "kiq", boom)
        await run_task(api.generate_chat_message, session.session_id)

    boom.assert_awaited_once()
    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "Internal server error occurred"
    assert await redis_keys.get(key) is None


# --------------------------------------------------------------------------------------
# process_response
# --------------------------------------------------------------------------------------


async def test_process_response_stores_the_offer_and_renames_the_session(task_db, rows, redis_keys, s3):
    user = await rows.user()
    session = await rows.chat_session(user)
    body = payload(chat_name="Расчёт кронштейна", message="Расчёт готов.")
    await redis_keys.put(get_generation_key(user.uuid))

    await run_task(api.process_response, user.uuid, session.session_id, body)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
        stored = await db.scalar(select(ChatSession).where(ChatSession.session_id == session.session_id))
        attachment = await db.scalar(select(Attachment).where(Attachment.session_id == session.session_id))
        assistant = await db.scalar(
            select(ChatMessage).where(
                ChatMessage.chat_session_id == session.session_id,
                ChatMessage.role == UserRole.ASSISTANT,
            )
        )
        # ``ChatMessage.attachments`` is lazy and cannot be loaded from a plain sync
        # expression, so the link is verified with an explicit query instead.
        linked = await db.scalars(select(Attachment.id).where(Attachment.chat_message_id == assistant.id))
        message_attachment_ids = list(linked)
    assert result is not None
    assert result.type == GenerationResultType.SUCCESS
    assert result.content == "Расчёт готов."
    assert result.update_name == "Расчёт кронштейна"
    assert attachment is not None
    assert result.attachment_id == attachment.id
    assert attachment.name == "kp.xlsx"
    assert attachment.ready is True
    assert stored is not None and stored.name == "Расчёт кронштейна"
    assert assistant is not None
    assert assistant.content == body
    assert assistant.display_text == "Расчёт готов."
    assert message_attachment_ids == [attachment.id]
    assert await redis_keys.get(get_generation_key(user.uuid)) is None


async def test_process_response_without_positions_creates_no_attachment(task_db, rows, redis_keys):
    user = await rows.user()
    session = await rows.chat_session(user)
    body = payload(gen_kp=True, positions=[], message="Нужны уточнения.")

    await run_task(api.process_response, user.uuid, session.session_id, body)

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
        attachment_count = await db.scalar(select(func.count()).select_from(Attachment))
    assert result is not None
    assert result.attachment_id is None
    assert result.update_name == "Расчёт детали"
    assert attachment_count == 0


async def test_process_response_keeps_an_existing_session_name(task_db, rows, redis_keys, s3):
    user = await rows.user()
    session = await rows.chat_session(user, name="Мой расчёт")

    await run_task(api.process_response, user.uuid, session.session_id, payload(chat_name="Другое имя"))

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
        stored = await db.scalar(select(ChatSession).where(ChatSession.session_id == session.session_id))
    assert result is not None and result.update_name is None
    assert stored is not None and stored.name == "Мой расчёт"


async def test_process_response_without_a_chat_name_leaves_the_session_alone(task_db, rows, redis_keys):
    user = await rows.user()
    session = await rows.chat_session(user)

    await run_task(api.process_response, user.uuid, session.session_id, payload(chat_name=None, gen_kp=False))

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
        stored = await db.scalar(select(ChatSession).where(ChatSession.session_id == session.session_id))
    assert result is not None and result.update_name is None
    assert stored is not None and stored.name == "Новый чат"


async def test_process_response_truncates_an_overlong_chat_name(task_db, rows, redis_keys, s3):
    user = await rows.user()
    session = await rows.chat_session(user)

    await run_task(api.process_response, user.uuid, session.session_id, payload(chat_name="Д" * 200))

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
        stored = await db.scalar(select(ChatSession).where(ChatSession.session_id == session.session_id))
    assert result is not None
    assert result.update_name == "Д" * (MAX_CHAT_NAME_LENGTH - 3) + "..."
    assert len(result.update_name) == MAX_CHAT_NAME_LENGTH
    assert stored is not None and stored.name == result.update_name


async def test_process_response_reports_invalid_json(task_db, rows, redis_keys):
    user = await rows.user()
    session = await rows.chat_session(user)
    key = await redis_keys.put(get_generation_key(user.uuid))

    await run_task(api.process_response, user.uuid, session.session_id, "{не json")

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR
    assert result.content == "Internal server error occurred"
    assert await redis_keys.get(key) is None


async def test_process_response_reports_a_schema_mismatch(task_db, rows, redis_keys):
    """Valid JSON that does not satisfy ``HarnessStructuredOutput``."""
    user = await rows.user()
    session = await rows.chat_session(user)

    await run_task(api.process_response, user.uuid, session.session_id, json.dumps({"message": "без флагов"}))

    async with rows.session() as db:
        result = await db.get(GenerationResult, session.session_id)
    assert result is not None
    assert result.type == GenerationResultType.ERROR


async def test_process_response_for_a_deleted_session_still_releases_the_lock(task_db, rows, redis_keys, s3):
    """The session lookup returning ``None`` is handled, but the result insert is not.

    ``GenerationResult.chat_session_id`` references ``chat_sessions``, so once the
    row is gone the insert fails no matter what the rename guard decided. The
    ``finally`` block still releases the generation lock.
    """
    user = await rows.user()
    session = await rows.chat_session(user)
    await rows.drop_sessions([session.session_id])
    key = await redis_keys.put(get_generation_key(user.uuid))

    with pytest.raises(IntegrityError):
        await run_task(api.process_response, user.uuid, session.session_id, payload())

    assert await redis_keys.get(key) is None
