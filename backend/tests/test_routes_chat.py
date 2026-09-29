"""Tests for the chat routes in :mod:`app.routes.chat`.

Every ``.kiq`` in the module is shadowed by an :class:`AsyncMock` through the
autouse ``_block_queues`` fixture, so nothing reaches RabbitMQ. The Redis-backed
dependencies (rate limiters, the creation lock, ownership and upload status)
run against the real container, so these tests need ``redis_session`` — directly
or through ``client``.

Rate limits are keyed by user id, and user ids come from a PostgreSQL sequence
that never rolls back, so every test starts with a fresh budget. Within a test
the budget is 5 requests a minute for ``chats:post``, which is what the 429
tests spend deliberately.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import (
    get_attachment_ownership_key,
    get_attachment_status_key,
    get_attachment_url_key,
    get_creation_key,
    get_deletion_key,
    get_generation_key,
)
from app.harness import FILE_ADDED_DESCRIPTION
from app.models.auth import User
from app.models.chat import (
    Attachment,
    ChatMessage,
    ChatSession,
    GenerationResult,
    GenerationResultType,
    ProcessingResult,
    ProcessingResultUploadable,
    UserRole,
)
from app.routes.chat import delete_chat

#: Fixed base so message ordering in the list endpoint is deterministic.
BASE_TIME = datetime(2024, 1, 1, tzinfo=UTC)


@pytest.fixture()
def kiq(monkeypatch):
    """Replace both taskiq ``.kiq`` attributes the routes call with mocks."""
    generate = AsyncMock()
    process = AsyncMock()
    monkeypatch.setattr("app.routes.chat.generate_chat_message.kiq", generate)
    monkeypatch.setattr("app.routes.chat.process_attachment.kiq", process)
    return SimpleNamespace(generate=generate, process=process)


@pytest.fixture(autouse=True)
def _block_queues(kiq):
    return kiq


@pytest_asyncio.fixture()
async def auth_client(client: AsyncClient, test_user: User) -> AsyncClient:
    """``client`` with the ``test`` user's session cookie already set."""
    response = await client.post("/auth/login", json={"username": "test", "password": "password1234"})
    assert response.status_code == 200
    return client


async def make_chat(db_session: AsyncSession, user_id: int, name: str = "Новый чат") -> ChatSession:
    """A chat session row. ``session_id`` is the primary key and has no default."""
    row = ChatSession(session_id=uuid.uuid4(), user_id=user_id, name=name)
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


@pytest_asyncio.fixture()
async def chat(db_session: AsyncSession, test_user: User) -> ChatSession:
    return await make_chat(db_session, test_user.id)


@pytest_asyncio.fixture()
async def other_chat(db_session: AsyncSession) -> ChatSession:
    """A chat session owned by somebody else entirely."""
    other = User(username="other", password_hash="not-a-real-hash")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)
    return await make_chat(db_session, other.id, name="Чужой чат")


async def set_timestamp(db_session: AsyncSession, row, when: datetime):
    row.timestamp = when
    await db_session.commit()


async def count(db_session: AsyncSession, model) -> int:
    return (await db_session.execute(select(func.count()).select_from(model))).scalar_one()


# ---------------------------------------------------------------------------
# GET /chats/
# ---------------------------------------------------------------------------


async def test_get_chats_requires_login(client: AsyncClient, redis_session: None):
    response = await client.get("/chats/")

    assert response.status_code == 401


async def test_get_chats_empty(auth_client: AsyncClient, redis_session: None):
    response = await auth_client.get("/chats/")

    assert response.status_code == 200
    assert response.json() == []


async def test_get_chats_skips_system_only_sessions(auth_client: AsyncClient, chat, factories, redis_session: None):
    await factories.message(chat.session_id, content="You are a helpful assistant", role=UserRole.SYSTEM)

    response = await auth_client.get("/chats/")

    assert response.status_code == 200
    assert response.json() == []


async def test_get_chats_returns_latest_message_with_attachments(
    auth_client: AsyncClient, db_session: AsyncSession, chat, factories, redis_session: None
):
    first = await factories.message(chat.session_id, content="первое")
    latest = await factories.message(chat.session_id, content="второе")
    await factories.attachment(chat.session_id, name="drawing.pdf", chat_message_id=latest.id, ready=True)
    await factories.attachment(chat.session_id, name="photo.png", chat_message_id=latest.id, ready=False)
    await set_timestamp(db_session, first, BASE_TIME)
    await set_timestamp(db_session, latest, BASE_TIME + timedelta(minutes=1))

    response = await auth_client.get("/chats/")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["session_id"] == str(chat.session_id)
    assert data[0]["name"] == "Новый чат"
    assert data[0]["last_message"]["content"] == "второе"
    # The list endpoint does not filter on readiness, unlike GET /chats/{id}.
    assert {a["name"] for a in data[0]["last_message"]["attachments"]} == {"drawing.pdf", "photo.png"}


async def test_get_chats_orders_most_recent_first_and_hides_other_users(
    auth_client: AsyncClient, db_session: AsyncSession, test_user: User, factories, other_chat, redis_session: None
):
    older = await make_chat(db_session, test_user.id, name="Старый чат")
    newer = await make_chat(db_session, test_user.id, name="Новый чат")
    silent = await make_chat(db_session, test_user.id, name="Пустой чат")

    older_last = await factories.message(older.session_id, content="старое")
    older_first = await factories.message(older.session_id, content="ещё старее")
    newer_last = await factories.message(newer.session_id, content="свежее")
    await factories.message(silent.session_id, content="системное", role=UserRole.SYSTEM)
    await factories.message(other_chat.session_id, content="чужое")

    await set_timestamp(db_session, older_first, BASE_TIME)
    await set_timestamp(db_session, older_last, BASE_TIME + timedelta(minutes=1))
    await set_timestamp(db_session, newer_last, BASE_TIME + timedelta(minutes=2))

    response = await auth_client.get("/chats/")

    assert response.status_code == 200
    data = response.json()
    assert [entry["session_id"] for entry in data] == [str(newer.session_id), str(older.session_id)]
    assert [entry["last_message"]["content"] for entry in data] == ["свежее", "старое"]


# ---------------------------------------------------------------------------
# POST /chats/
# ---------------------------------------------------------------------------


async def test_create_chat(auth_client: AsyncClient, db_session: AsyncSession, test_user: User, redis_session: None):
    response = await auth_client.post("/chats/")

    assert response.status_code == 202
    session_id = uuid.UUID(response.json()["session_id"])

    session = await db_session.get(ChatSession, session_id)
    assert session is not None
    assert session.user_id == test_user.id

    messages = (await db_session.scalars(select(ChatMessage).where(ChatMessage.chat_session_id == session_id))).all()
    assert len(messages) == 1
    assert messages[0].role == UserRole.SYSTEM


async def test_create_chat_rate_limited(auth_client: AsyncClient, redis_session: None):
    for _ in range(5):
        response = await auth_client.post("/chats/")
        assert response.status_code == 202

    response = await auth_client.post("/chats/")

    assert response.status_code == 429
    assert response.json()["detail"] == "Too many requests"
    assert "Retry-After" in response.headers


async def test_create_chat_conflicts_with_running_generation(
    auth_client: AsyncClient, redis_client, test_user: User, redis_session: None
):
    await redis_client.set(get_generation_key(test_user.uuid), "1", ex=300)

    response = await auth_client.post("/chats/")

    assert response.status_code == 409
    assert response.json()["detail"] == "A generation job is already running"


async def test_create_chat_rejects_concurrent_creation(
    auth_client: AsyncClient, redis_client, test_user: User, redis_session: None
):
    """The creation lock is a Redis ``SET NX``, not a database constraint."""
    await redis_client.set(get_creation_key(test_user.uuid), "1", ex=5)

    response = await auth_client.post("/chats/")

    assert response.status_code == 429
    assert response.json()["detail"] == "Stop spamming"


# ---------------------------------------------------------------------------
# GET /chats/{session_id}
# ---------------------------------------------------------------------------


async def test_get_chat_returns_messages_in_order(auth_client: AsyncClient, chat, factories, redis_session: None):
    await factories.message(chat.session_id, content="вопрос", role=UserRole.USER)
    await factories.message(chat.session_id, content="системное", role=UserRole.SYSTEM)
    await factories.message(chat.session_id, content="ответ", role=UserRole.ASSISTANT)

    response = await auth_client.get(f"/chats/{chat.session_id}")

    assert response.status_code == 200
    data = response.json()
    assert [m["content"] for m in data] == ["вопрос", "ответ"]
    assert [m["role"] for m in data] == ["user", "assistant"]


async def test_get_chat_only_includes_ready_attachments(auth_client: AsyncClient, chat, factories, redis_session: None):
    message = await factories.message(chat.session_id, content="вопрос")
    await factories.attachment(chat.session_id, name="ready.pdf", chat_message_id=message.id, ready=True)
    await factories.attachment(chat.session_id, name="pending.pdf", chat_message_id=message.id, ready=False)

    response = await auth_client.get(f"/chats/{chat.session_id}")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert [a["name"] for a in data[0]["attachments"]] == ["ready.pdf"]


async def test_get_chat_forbidden_for_other_user(auth_client: AsyncClient, other_chat, redis_session: None):
    response = await auth_client.get(f"/chats/{other_chat.session_id}")

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid session"


# ---------------------------------------------------------------------------
# POST /chats/{session_id}
# ---------------------------------------------------------------------------


async def test_send_message(auth_client: AsyncClient, db_session: AsyncSession, chat, kiq, redis_session: None):
    response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": "сколько стоит?"})

    assert response.status_code == 202
    assert response.json() == {"message": "Message sent"}
    kiq.generate.assert_awaited_once_with(chat.session_id)

    message = (
        await db_session.scalars(
            select(ChatMessage).where(
                ChatMessage.chat_session_id == chat.session_id,
                ChatMessage.role == UserRole.USER,
            )
        )
    ).one()
    assert message.content == "сколько стоит?"
    # No attachments were uploaded, so the message carries no file list.
    assert not message.files_str


async def test_send_message_attaches_processed_files(
    auth_client: AsyncClient, db_session: AsyncSession, chat, factories, kiq, redis_session: None
):
    attachment = await factories.attachment(chat.session_id, name="part.dxf", ready=True)
    db_session.add(ProcessingResult(attachment_id=attachment.id, output="100x50"))
    db_session.add(
        ProcessingResultUploadable(attachment_id=attachment.id, s3_key="artifacts/pdf/1.png", sber_id="file-1")
    )
    await db_session.commit()

    response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": "посчитай"})

    assert response.status_code == 202
    message = (
        await db_session.scalars(
            select(ChatMessage).where(
                ChatMessage.chat_session_id == chat.session_id,
                ChatMessage.role == UserRole.USER,
            )
        )
    ).one()
    assert message.display_text == "посчитай"
    assert message.content == "посчитай" + FILE_ADDED_DESCRIPTION.format(filename="part.dxf", description="100x50")
    assert message.files_str == "file-1"

    await db_session.refresh(attachment)
    assert attachment.chat_message_id == message.id
    # Both result tables are consumed by the send.
    assert await count(db_session, ProcessingResult) == 0
    assert await count(db_session, ProcessingResultUploadable) == 0


async def test_send_message_rejects_unready_attachments(
    auth_client: AsyncClient, chat, factories, kiq, redis_session: None
):
    await factories.attachment(chat.session_id, name="pending.pdf", ready=False)

    response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": "посчитай"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Not all attachments are ready"
    kiq.generate.assert_not_awaited()


async def test_send_message_rejects_too_long_content(auth_client: AsyncClient, chat, kiq, redis_session: None):
    response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": "x" * 5001})

    assert response.status_code == 422
    kiq.generate.assert_not_awaited()


async def test_send_message_rate_limited(auth_client: AsyncClient, chat, kiq, redis_session: None):
    for index in range(5):
        response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": f"вопрос {index}"})
        assert response.status_code == 202

    response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": "ещё"})

    assert response.status_code == 429
    assert response.json()["detail"] == "Too many requests"


async def test_send_message_conflicts_with_running_generation(
    auth_client: AsyncClient, redis_client, test_user: User, chat, kiq, redis_session: None
):
    await redis_client.set(get_generation_key(test_user.uuid), "1", ex=300)

    response = await auth_client.post(f"/chats/{chat.session_id}", json={"content": "вопрос"})

    assert response.status_code == 409
    kiq.generate.assert_not_awaited()


async def test_send_message_forbidden_for_other_user(auth_client: AsyncClient, other_chat, kiq, redis_session: None):
    response = await auth_client.post(f"/chats/{other_chat.session_id}", json={"content": "вопрос"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid session"
    kiq.generate.assert_not_awaited()


# ---------------------------------------------------------------------------
# GET /chats/{session_id}/result
# ---------------------------------------------------------------------------


async def test_get_result_without_any_result(auth_client: AsyncClient, chat, redis_session: None):
    response = await auth_client.get(f"/chats/{chat.session_id}/result")

    assert response.status_code == 200
    assert response.json() == {"running": False, "result": None}


async def test_get_result_while_running(
    auth_client: AsyncClient, redis_client, test_user: User, chat, redis_session: None
):
    await redis_client.set(get_generation_key(test_user.uuid), "1", ex=300)

    response = await auth_client.get(f"/chats/{chat.session_id}/result")

    assert response.status_code == 200
    assert response.json() == {"running": True, "result": None}


async def test_get_result_success(auth_client: AsyncClient, db_session: AsyncSession, chat, redis_session: None):
    db_session.add(
        GenerationResult(
            chat_session_id=chat.session_id,
            type=GenerationResultType.SUCCESS,
            content="готово",
            update_name="Расчёт детали",
        )
    )
    await db_session.commit()

    response = await auth_client.get(f"/chats/{chat.session_id}/result")

    assert response.status_code == 200
    data = response.json()
    assert data["running"] is False
    assert data["result"]["type"] == "success"
    assert data["result"]["content"] == "готово"
    assert data["result"]["update_name"] == "Расчёт детали"
    assert data["result"]["attachment_id"] is None


async def test_get_result_error_with_attachment(
    auth_client: AsyncClient, db_session: AsyncSession, chat, factories, redis_session: None
):
    attachment = await factories.attachment(chat.session_id, name="out.xlsx")
    db_session.add(
        GenerationResult(
            chat_session_id=chat.session_id,
            type=GenerationResultType.ERROR,
            content="Internal server error occurred",
            attachment_id=attachment.id,
        )
    )
    await db_session.commit()

    response = await auth_client.get(f"/chats/{chat.session_id}/result")

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["type"] == "error"
    assert result["content"] == "Internal server error occurred"
    assert result["attachment_id"] == attachment.id
    assert result["update_name"] is None


async def test_get_result_forbidden_for_other_user(auth_client: AsyncClient, other_chat, redis_session: None):
    response = await auth_client.get(f"/chats/{other_chat.session_id}/result")

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# POST /chats/{session_id}/retry
# ---------------------------------------------------------------------------


async def test_retry_send(auth_client: AsyncClient, db_session: AsyncSession, chat, kiq, redis_session: None):
    db_session.add(
        GenerationResult(
            chat_session_id=chat.session_id,
            type=GenerationResultType.ERROR,
            content="boom",
        )
    )
    await db_session.commit()

    response = await auth_client.post(f"/chats/{chat.session_id}/retry")

    assert response.status_code == 200
    assert response.json() == {"message": "Retrying"}
    kiq.generate.assert_awaited_once_with(chat.session_id)


async def test_retry_send_without_result(auth_client: AsyncClient, chat, kiq, redis_session: None):
    response = await auth_client.post(f"/chats/{chat.session_id}/retry")

    assert response.status_code == 400
    assert response.json()["detail"] == "There's nothing to retry"
    kiq.generate.assert_not_awaited()


async def test_retry_send_after_successful_turn(
    auth_client: AsyncClient, db_session: AsyncSession, chat, kiq, redis_session: None
):
    db_session.add(
        GenerationResult(
            chat_session_id=chat.session_id,
            type=GenerationResultType.SUCCESS,
            content="готово",
        )
    )
    await db_session.commit()

    response = await auth_client.post(f"/chats/{chat.session_id}/retry")

    assert response.status_code == 400
    kiq.generate.assert_not_awaited()


async def test_retry_send_forbidden_for_other_user(auth_client: AsyncClient, other_chat, kiq, redis_session: None):
    response = await auth_client.post(f"/chats/{other_chat.session_id}/retry")

    assert response.status_code == 403
    kiq.generate.assert_not_awaited()


# ---------------------------------------------------------------------------
# DELETE /chats/{session_id}
# ---------------------------------------------------------------------------


async def test_delete_chat(
    auth_client: AsyncClient, db_session: AsyncSession, redis_client, chat, factories, redis_session: None
):
    message = await factories.message(chat.session_id, content="вопрос")
    await factories.attachment(chat.session_id, chat_message_id=message.id)
    session_id = chat.session_id

    response = await auth_client.delete(f"/chats/{session_id}")

    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    # The route deletes with a bulk statement, so the session's identity map is
    # not refreshed: count through a fresh query instead of ``get``.
    assert await count(db_session, ChatSession) == 0
    assert await count(db_session, ChatMessage) == 0
    assert await count(db_session, Attachment) == 0
    # The tombstone tells an in-flight worker to discard its result.
    assert await redis_client.get(get_deletion_key(session_id)) == "1"


async def test_delete_chat_forbidden_for_other_user(
    auth_client: AsyncClient, db_session: AsyncSession, other_chat, redis_session: None
):
    response = await auth_client.delete(f"/chats/{other_chat.session_id}")

    assert response.status_code == 403
    assert await db_session.get(ChatSession, other_chat.session_id) is not None


async def test_delete_chat_reports_false_for_unknown_session(
    db_session: AsyncSession, redis_client, redis_session: None
):
    """The ``deleted=False`` branch is unreachable over HTTP: the ownership
    dependency proves the session exists before the delete runs. Calling the
    handler directly is the only way to reach it."""
    missing = uuid.uuid4()

    result = await delete_chat(session_id=missing, redis_client=redis_client, db=db_session)

    assert result.deleted is False
    assert await redis_client.get(get_deletion_key(missing)) == "1"


# ---------------------------------------------------------------------------
# POST /chats/{session_id}/uploads
# ---------------------------------------------------------------------------


async def test_upload_file(
    auth_client: AsyncClient, db_session: AsyncSession, redis_client, chat, redis_session: None, s3: None
):
    response = await auth_client.post(
        f"/chats/{chat.session_id}/uploads",
        json={"filename": "drawing.pdf", "content_type": "application/pdf", "file_size": 1024},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["params"]["url"].endswith("/uploads")
    assert data["params"]["fields"]["key"].startswith(f"attachments/{chat.session_id}/")
    assert data["params"]["fields"]["key"].endswith(".pdf")

    attachment = await db_session.get(Attachment, data["attachment_id"])
    assert attachment is not None
    assert attachment.name == "drawing.pdf"
    assert attachment.s3_key == data["params"]["fields"]["key"]
    assert attachment.chat_message_id is None
    assert await redis_client.get(get_attachment_status_key(attachment.id)) == "uploading"


async def test_upload_file_rejects_content_type(auth_client: AsyncClient, chat, redis_session: None, s3: None):
    response = await auth_client.post(
        f"/chats/{chat.session_id}/uploads",
        json={"filename": "notes.txt", "content_type": "text/plain", "file_size": 10},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Content type not allowed"


async def test_upload_file_rejects_oversize(auth_client: AsyncClient, chat, redis_session: None, s3: None):
    response = await auth_client.post(
        f"/chats/{chat.session_id}/uploads",
        json={"filename": "huge.pdf", "content_type": "application/pdf", "file_size": 30 * 1024 * 1024 + 1},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "File size too large"


async def test_upload_file_forbidden_for_other_user(
    auth_client: AsyncClient, other_chat, redis_session: None, s3: None
):
    response = await auth_client.post(
        f"/chats/{other_chat.session_id}/uploads",
        json={"filename": "drawing.pdf", "content_type": "application/pdf", "file_size": 10},
    )

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET /chats/{session_id}/attachments/{attachment_id}
# ---------------------------------------------------------------------------


async def test_get_attachment(
    auth_client: AsyncClient,
    redis_client,
    chat,
    factories,
    redis_session: None,
    s3: None,
    s3_put,
):
    attachment = await factories.attachment(chat.session_id, name="drawing.pdf", s3_key="chat/get.pdf")
    await s3_put(b"%PDF-1.4", attachment.s3_key)

    response = await auth_client.get(f"/chats/{chat.session_id}/attachments/{attachment.id}")

    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "drawing.pdf"
    assert "get.pdf" in data["attachment_url"]
    assert await redis_client.get(get_attachment_url_key(attachment.id)) is not None


async def test_get_attachment_serves_cached_url(
    auth_client: AsyncClient, redis_client, chat, factories, redis_session: None
):
    attachment = await factories.attachment(chat.session_id, name="drawing.pdf")
    await redis_client.set(
        get_attachment_url_key(attachment.id),
        '{"url": "http://cached/drawing.pdf", "filename": "drawing.pdf"}',
        ex=3600,
    )

    response = await auth_client.get(f"/chats/{chat.session_id}/attachments/{attachment.id}")

    assert response.status_code == 200
    assert response.json() == {"attachment_url": "http://cached/drawing.pdf", "filename": "drawing.pdf"}


async def test_get_attachment_missing_row(auth_client: AsyncClient, redis_client, chat, redis_session: None):
    """The ownership cache short-circuits the dependency, so the handler's own
    ``db.get`` miss is reachable with an id that no row has."""
    await redis_client.set(get_attachment_ownership_key(chat.session_id, 999999), "1", ex=600)

    response = await auth_client.get(f"/chats/{chat.session_id}/attachments/999999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Attachment not found"


async def test_get_attachment_expired_from_storage(
    auth_client: AsyncClient, chat, factories, redis_session: None, s3: None
):
    attachment = await factories.attachment(chat.session_id, s3_key="chat/never-uploaded.pdf")

    response = await auth_client.get(f"/chats/{chat.session_id}/attachments/{attachment.id}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Attachment not found, it might have expired"


async def test_get_attachment_forbidden_for_other_user(
    auth_client: AsyncClient, other_chat, factories, redis_session: None, s3: None
):
    attachment = await factories.attachment(other_chat.session_id)

    response = await auth_client.get(f"/chats/{other_chat.session_id}/attachments/{attachment.id}")

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid session"


# ---------------------------------------------------------------------------
# POST /chats/{session_id}/uploads/{attachment_id}/uploaded
# ---------------------------------------------------------------------------


async def test_attachment_uploaded(
    auth_client: AsyncClient, redis_client, chat, factories, kiq, redis_session: None, s3: None, s3_put
):
    attachment = await factories.attachment(chat.session_id, s3_key="chat/uploaded.pdf")
    await s3_put(b"%PDF-1.4", attachment.s3_key)
    await redis_client.set(get_attachment_status_key(attachment.id), "uploading", ex=600)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/uploaded")

    assert response.status_code == 200
    assert response.json() == {"message": "File uploaded, processing started"}
    kiq.process.assert_awaited_once_with(attachment.id)
    assert await redis_client.get(get_attachment_status_key(attachment.id)) == "processing"
    # The Redis lock is released even on the happy path.
    assert await redis_client.exists(f"attachment:upload:lock:{attachment.id}") == 0


async def test_attachment_uploaded_retries_after_error(
    auth_client: AsyncClient, redis_client, chat, factories, kiq, redis_session: None, s3: None, s3_put
):
    attachment = await factories.attachment(chat.session_id, s3_key="chat/retried.pdf")
    await s3_put(b"%PDF-1.4", attachment.s3_key)
    await redis_client.set(get_attachment_status_key(attachment.id), "error", ex=600)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/uploaded")

    assert response.status_code == 200
    assert await redis_client.get(get_attachment_status_key(attachment.id)) == "processing"


async def test_attachment_uploaded_rejects_already_confirmed(
    auth_client: AsyncClient, redis_client, chat, factories, kiq, redis_session: None, s3: None, s3_put
):
    attachment = await factories.attachment(chat.session_id, s3_key="chat/done.pdf")
    await s3_put(b"%PDF-1.4", attachment.s3_key)
    await redis_client.set(get_attachment_status_key(attachment.id), "processing", ex=600)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/uploaded")

    assert response.status_code == 400
    assert response.json()["detail"] == "File has already been uploaded"
    kiq.process.assert_not_awaited()


async def test_attachment_uploaded_rejects_missing_upload(
    auth_client: AsyncClient, redis_client, chat, factories, kiq, redis_session: None, s3: None
):
    attachment = await factories.attachment(chat.session_id, s3_key="chat/missing.pdf")
    await redis_client.set(get_attachment_status_key(attachment.id), "uploading", ex=600)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/uploaded")

    assert response.status_code == 400
    assert response.json()["detail"] == "You haven't uploaded yet"
    kiq.process.assert_not_awaited()
    assert await redis_client.get(get_attachment_status_key(attachment.id)) == "uploading"
    assert await redis_client.exists(f"attachment:upload:lock:{attachment.id}") == 0


async def test_attachment_uploaded_unknown_attachment(
    auth_client: AsyncClient, redis_client, chat, kiq, redis_session: None, s3: None
):
    await redis_client.set(get_attachment_status_key(999999), "uploading", ex=600)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/999999/uploaded")

    assert response.status_code == 404
    assert response.json()["detail"] == "Attachment not found"
    kiq.process.assert_not_awaited()


async def test_attachment_uploaded_spam_guard(
    auth_client: AsyncClient, redis_client, chat, factories, kiq, redis_session: None, s3: None, s3_put
):
    attachment = await factories.attachment(chat.session_id, s3_key="chat/locked.pdf")
    await s3_put(b"%PDF-1.4", attachment.s3_key)
    await redis_client.set(get_attachment_status_key(attachment.id), "uploading", ex=600)
    lock = redis_client.lock(f"attachment:upload:lock:{attachment.id}", timeout=10)
    assert await lock.acquire(blocking=False) is True
    try:
        response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/uploaded")

        assert response.status_code == 429
        assert response.json()["detail"] == "Stop spamming"
        kiq.process.assert_not_awaited()
    finally:
        await lock.release()


# ---------------------------------------------------------------------------
# POST /chats/{session_id}/uploads/{attachment_id}/status
# ---------------------------------------------------------------------------


async def test_attachment_status(auth_client: AsyncClient, redis_client, chat, factories, redis_session: None):
    attachment = await factories.attachment(chat.session_id)
    await redis_client.set(get_attachment_status_key(attachment.id), "processing", ex=600)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/status")

    assert response.status_code == 200
    assert response.json() == {"status": "processing"}


async def test_attachment_status_expired(auth_client: AsyncClient, chat, factories, redis_session: None):
    """Ownership resolves from the database, but the status key has a TTL, so
    the two expire independently."""
    attachment = await factories.attachment(chat.session_id)

    response = await auth_client.post(f"/chats/{chat.session_id}/uploads/{attachment.id}/status")

    assert response.status_code == 404
    assert response.json()["detail"] == "Attachment not found"


async def test_attachment_status_forbidden_for_other_user(
    auth_client: AsyncClient, other_chat, factories, redis_session: None
):
    attachment = await factories.attachment(other_chat.session_id)

    response = await auth_client.post(f"/chats/{other_chat.session_id}/uploads/{attachment.id}/status")

    assert response.status_code == 403
