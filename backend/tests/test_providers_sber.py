"""Unit tests for the real GigaChat client in :mod:`app.providers.sber`.

Nothing in this module touches the network. Every test swaps ``provider._client``
for an ``httpx.AsyncClient`` backed by :class:`httpx.MockTransport`, which
intercepts the absolute ``https://ngw.devices.sberbank.ru:9443/api/v2/oauth``
URL exactly like a relative one. That is why there is not a single ``live``
marker below: the marker exists in ``pyproject.toml`` for the day someone needs
a real credential, and this module deliberately never takes that path.

The base-class behaviour in :mod:`app.providers.client` is exercised through
:class:`SberProvider` because it is the only concrete implementation.
"""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import pytest_asyncio

from app.providers.client import AIClient, AuthorizationError
from app.providers.models import GenerationResponse, Message, ResponseFormat
from app.providers.sber import SberProvider

#: The client is built with a ``/v2`` base path, and httpx merges that prefix
#: into every *relative* request URL. So the code's ``_post("/chat/completions")``
#: actually lands on ``/v2/chat/completions``, while the absolute auth and upload
#: URLs are used verbatim.
BASE_URL = "https://api.giga.chat/v2"
AUTH_PATH = "/api/v2/oauth"
COMPLETIONS_PATH = "/v2/chat/completions"
FILES_PATH = "/v1/files"
MODELS_PATH = "/v2/models"

# 2100-01-01T00:00:00Z. Far enough out that a freshly minted token is always
# "fresh", and a real wall-clock comparison in ensure_fresh_token can't flake.
FUTURE_MS = 4_102_444_800_000


def auth_body(token: str = "tok-123", expires_at_ms: int = FUTURE_MS) -> dict:
    return {"access_token": token, "expires_at": expires_at_ms}


def generation_body(text: str = "answer") -> dict:
    return {
        "messages": [{"role": "assistant", "content": [{"text": text}]}],
        "model": "GigaChat-3-Ultra",
        "created_at": 1_700_000_000_000,
        "finish_reason": "stop",
        "usage": {
            "input_tokens": 10,
            "input_tokens_details": {"prompt_tokens": 8, "cached_tokens": 2},
            "output_tokens": 5,
            "total_tokens": 15,
        },
    }


def ok_handler(captured: list[httpx.Request] | None = None) -> httpx.MockTransport:
    """A transport that answers every endpoint the provider talks to."""

    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(request)
        if request.url.path == AUTH_PATH:
            return httpx.Response(200, json=auth_body())
        if request.url.path == COMPLETIONS_PATH:
            return httpx.Response(200, json=generation_body())
        if request.url.path == FILES_PATH:
            return httpx.Response(200, json={"id": "abc"})
        return httpx.Response(404, json={"detail": f"unexpected {request.url.path}"})

    return httpx.MockTransport(handler)


@pytest_asyncio.fixture
async def provider_factory():
    """Build a ``SberProvider`` whose transport is a mock, and close both clients after.

    The original client is built against a real TLS context for
    ``res/gigachat-ca.cer`` and is never used, but it is still an open
    ``AsyncClient``, so it gets closed rather than left for the GC.
    """
    originals: list[httpx.AsyncClient] = []
    mocks: list[httpx.AsyncClient] = []

    def _make(transport: httpx.MockTransport, scope: str = "B2B") -> SberProvider:
        provider = SberProvider(api_key="key", scope=scope)
        originals.append(provider._client)
        provider._client = httpx.AsyncClient(transport=transport, base_url=BASE_URL)
        mocks.append(provider._client)
        return provider

    yield _make

    for client in [*originals, *mocks]:
        await client.aclose()


@pytest_asyncio.fixture
async def provider(provider_factory):
    """A default provider: every call succeeds, and the token is never stale."""
    return provider_factory(ok_handler())


def fresh_token(provider: SberProvider) -> None:
    provider.token = "already-fresh"
    provider.token_expires_at = datetime.now(UTC) + timedelta(hours=1)


# ---------------------------------------------------------------------------
# __init__
# ---------------------------------------------------------------------------


def test_init_rejects_unknown_scope():
    with pytest.raises(ValueError, match="Scope must be PERS, B2B or CORP"):
        SberProvider(api_key="key", scope="UNKNOWN")


@pytest.mark.parametrize("scope", ["PERS", "B2B", "CORP"])
def test_init_accepts_documented_scopes(scope):
    provider = SberProvider(api_key="key", scope=scope)

    assert provider.scope == scope
    assert provider.api_key == "key"
    assert provider.token is None
    assert provider.token_expires_at is None


def test_sber_provider_implements_the_abstract_interface():
    assert issubclass(SberProvider, AIClient)
    assert AIClient.__abstractmethods__ == frozenset({"auth", "upload", "generate"})


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_stores_token_and_sets_header(provider_factory):
    captured: list[httpx.Request] = []
    provider = provider_factory(ok_handler(captured))

    await provider.auth()

    assert provider.token == "tok-123"
    assert provider.token_expires_at == datetime.fromtimestamp(FUTURE_MS / 1000, tz=UTC)
    assert provider._client.headers["Authorization"] == "Bearer tok-123"
    assert len(captured) == 1
    assert captured[0].url.path == AUTH_PATH


@pytest.mark.asyncio
async def test_auth_sends_rq_uid_basic_auth_and_scope(provider_factory):
    captured: list[httpx.Request] = []
    provider = provider_factory(ok_handler(captured), scope="B2B")

    await provider.auth()

    request = captured[0]
    uuid.UUID(request.headers["RqUID"])
    assert request.headers["Authorization"] == "Basic key"
    assert request.content == b"scope=GIGACHAT_API_B2B"


@pytest.mark.asyncio
async def test_auth_uppercases_the_scope(provider_factory):
    captured: list[httpx.Request] = []
    provider = provider_factory(ok_handler(captured), scope="PERS")

    await provider.auth()

    assert b"scope=GIGACHAT_API_PERS" in captured[0].content


@pytest.mark.asyncio
async def test_auth_failure_raises_authorization_error(provider_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "nope"})

    provider = provider_factory(httpx.MockTransport(handler))

    with pytest.raises(AuthorizationError):
        await provider.auth()

    assert provider.token is None
    assert "Authorization" not in provider._client.headers


# ---------------------------------------------------------------------------
# generate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generate_returns_parsed_response(provider_factory):
    provider = provider_factory(ok_handler())

    result = await provider.generate(
        message_history=[Message(role="user", content=[{"text": "hi"}])],
        response_format=ResponseFormat(type="text"),
        x_client_id=uuid.uuid4(),
        x_session_id=uuid.uuid4(),
    )

    assert isinstance(result, GenerationResponse)
    assert result.model == "GigaChat-3-Ultra"
    assert result.finish_reason == "stop"
    assert result.messages[0].content[0].text == "answer"
    assert result.usage.total_tokens == 15
    assert result.created_at == datetime.fromtimestamp(1_700_000_000_000 / 1000, tz=UTC)


@pytest.mark.asyncio
async def test_generate_sends_history_model_and_correlation_headers(provider_factory):
    captured: list[httpx.Request] = []
    provider = provider_factory(ok_handler(captured))
    client_id, session_id = uuid.uuid4(), uuid.uuid4()

    await provider.generate(
        message_history=[Message(role="user", content=[{"text": "hi"}])],
        response_format=ResponseFormat(type="text"),
        x_client_id=client_id,
        x_session_id=session_id,
    )

    request = captured[-1]
    assert request.url.path == COMPLETIONS_PATH
    assert request.headers["X-Client-Id"] == str(client_id)
    assert request.headers["X-Session-Id"] == str(session_id)
    uuid.UUID(request.headers["X-Request-Id"])

    body = request.read().decode()
    assert "GigaChat" in body
    assert "response_format" in body


@pytest.mark.asyncio
async def test_generate_failure_returns_none(provider_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == AUTH_PATH:
            return httpx.Response(200, json=auth_body())
        return httpx.Response(500, json={"error": "boom"})

    provider = provider_factory(httpx.MockTransport(handler))

    result = await provider.generate(
        message_history=[Message(role="user", content=[{"text": "hi"}])],
        response_format=ResponseFormat(type="text"),
        x_client_id=uuid.uuid4(),
        x_session_id=uuid.uuid4(),
    )

    assert result is None


@pytest.mark.asyncio
async def test_generate_401_becomes_authorization_error(provider_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == AUTH_PATH:
            return httpx.Response(200, json=auth_body())
        return httpx.Response(401, json={"error": "expired"})

    provider = provider_factory(httpx.MockTransport(handler))

    with pytest.raises(AuthorizationError):
        await provider.generate(
            message_history=[Message(role="user", content=[{"text": "hi"}])],
            response_format=ResponseFormat(type="text"),
            x_client_id=uuid.uuid4(),
            x_session_id=uuid.uuid4(),
        )


# ---------------------------------------------------------------------------
# upload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_returns_file_id(provider_factory):
    captured: list[httpx.Request] = []
    provider = provider_factory(ok_handler(captured))
    client_id = uuid.uuid4()

    file_id = await provider.upload(
        filename="drawing.png",
        data=b"\x89PNG\r\n\x1a\n",
        x_client_id=client_id,
        x_session_id=uuid.uuid4(),
        content_type="image/png",
    )

    assert file_id == "abc"
    request = captured[-1]
    assert request.url.path == FILES_PATH
    assert request.headers["X-Client-Id"] == str(client_id)
    assert b'filename="drawing.png"' in request.content
    assert b"image/png" in request.content


@pytest.mark.asyncio
async def test_upload_failure_raises_runtime_error(provider_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == AUTH_PATH:
            return httpx.Response(200, json=auth_body())
        return httpx.Response(413, json={"error": "too big"})

    provider = provider_factory(httpx.MockTransport(handler))

    with pytest.raises(RuntimeError, match="upload_failure"):
        await provider.upload(
            filename="drawing.png",
            data=b"x",
            x_client_id=uuid.uuid4(),
            x_session_id=uuid.uuid4(),
            content_type="image/png",
        )


# ---------------------------------------------------------------------------
# AIClient: ensure_fresh_token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_fresh_token_authenticates_when_token_is_none(provider):
    with pytest.MonkeyPatch.context() as patch:
        calls = []

        async def fake_auth():
            calls.append(1)
            fresh_token(provider)

        patch.setattr(provider, "auth", fake_auth)
        await provider.ensure_fresh_token()

    assert calls == [1]


@pytest.mark.asyncio
async def test_ensure_fresh_token_authenticates_when_expiry_is_none(provider):
    provider.token = "something"
    provider.token_expires_at = None

    with pytest.MonkeyPatch.context() as patch:
        calls = []

        async def fake_auth():
            calls.append(1)
            provider.token_expires_at = datetime.now(UTC) + timedelta(hours=1)

        patch.setattr(provider, "auth", fake_auth)
        await provider.ensure_fresh_token()

    assert calls == [1]


@pytest.mark.asyncio
async def test_ensure_fresh_token_refreshes_inside_the_thirty_second_window(provider):
    provider.token = "about-to-expire"
    provider.token_expires_at = datetime.now(UTC) + timedelta(seconds=29)

    with pytest.MonkeyPatch.context() as patch:
        calls = []

        async def fake_auth():
            calls.append(1)
            fresh_token(provider)

        patch.setattr(provider, "auth", fake_auth)
        await provider.ensure_fresh_token()

    assert calls == [1]


@pytest.mark.asyncio
async def test_ensure_fresh_token_does_nothing_while_the_token_is_fresh(provider):
    fresh_token(provider)

    with pytest.MonkeyPatch.context() as patch:
        calls = []

        async def fake_auth():
            calls.append(1)

        patch.setattr(provider, "auth", fake_auth)
        await provider.ensure_fresh_token()

    assert calls == []
    assert provider.token == "already-fresh"


@pytest.mark.asyncio
async def test_expired_token_triggers_reauth_on_the_next_request(provider_factory):
    captured: list[httpx.Request] = []
    provider = provider_factory(ok_handler(captured))
    provider.token = "stale"
    provider.token_expires_at = datetime.now(UTC) - timedelta(hours=1)

    r = await provider._get("/models")

    assert r.status_code == 404
    assert [r.url.path for r in captured] == [AUTH_PATH, MODELS_PATH]


# ---------------------------------------------------------------------------
# AIClient: _get / _post / close
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_returns_the_response(provider):
    fresh_token(provider)

    r = await provider._get("/models")

    assert r.status_code == 404
    assert r.request.method == "GET"


@pytest.mark.asyncio
async def test_post_returns_the_response(provider):
    fresh_token(provider)

    r = await provider._post("/models", json={"a": 1})

    assert r.status_code == 404
    assert r.request.method == "POST"
    assert r.request.content == b'{"a":1}'


@pytest.mark.asyncio
async def test_get_401_raises_authorization_error(provider_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "expired"})

    provider = provider_factory(httpx.MockTransport(handler))
    fresh_token(provider)

    with pytest.raises(AuthorizationError):
        await provider._get("/models")


@pytest.mark.asyncio
async def test_post_401_raises_authorization_error(provider_factory):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "expired"})

    provider = provider_factory(httpx.MockTransport(handler))
    fresh_token(provider)

    with pytest.raises(AuthorizationError):
        await provider._post("/models")


@pytest.mark.asyncio
async def test_close_shuts_the_client_down(provider):
    await provider.close()
    assert provider._client.is_closed


# ---------------------------------------------------------------------------
# AIClient: _pers_api_lock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pers_api_lock_is_a_noop_for_non_pers_scopes(provider, monkeypatch):
    def explode():
        raise AssertionError("Redis must not be touched for a non-PERS scope")

    monkeypatch.setattr("app.providers.client.get_redis_client", explode)

    async with provider._pers_api_lock():
        pass


@pytest.mark.asyncio
async def test_pers_api_lock_takes_the_redis_lock_for_pers(provider_factory, redis_session):
    from app.cache import get_redis_client

    provider = provider_factory(ok_handler(), scope="PERS")
    observed = []

    async with provider._pers_api_lock(), get_redis_client() as redis:
        observed.append(await redis.exists("api:global:lock"))

    # Held inside the block...
    assert observed == [1]
    # ...and released on the way out.
    async with get_redis_client() as redis:
        assert await redis.exists("api:global:lock") == 0


@pytest.mark.asyncio
async def test_pers_api_lock_releases_when_the_body_raises(provider_factory, redis_session):
    from app.cache import get_redis_client

    provider = provider_factory(ok_handler(), scope="PERS")

    with pytest.raises(RuntimeError):
        async with provider._pers_api_lock():
            raise RuntimeError("boom")

    async with get_redis_client() as redis:
        assert await redis.exists("api:global:lock") == 0
