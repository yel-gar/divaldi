"""Live tests against the real GigaChat API.

Deselected by default via `addopts = "-m 'not live'"`, because every call costs
money and needs a real key. Run them explicitly:

    SBER_API_KEY=<real-key> SBER_API_SCOPE=PERS poetry run pytest -m live

The GigaChat certificate is read from ``res/gigachat-ca.cer`` by a *relative*
path, so these must run with CWD == ``backend/``.

None of this is needed for the normal suite: `SBER_API_KEY=mock` swaps in
`MockProvider`, which is what every other test uses.
"""

import uuid

import pytest

pytestmark = pytest.mark.live


def _require_real_key():
    import os

    key = os.environ.get("SBER_API_KEY", "")
    if not key or key == "mock":
        pytest.skip("set SBER_API_KEY to a real GigaChat key to run live tests")


@pytest.fixture()
def live_provider():
    _require_real_key()
    from app.providers.containers import provider
    from app.providers.mock import MOCK_API_KEY

    if isinstance(provider, type(None)) or getattr(provider, "api_key", "") == MOCK_API_KEY:
        pytest.skip("SBER_API_KEY is still 'mock'")
    return provider


async def test_live_generate_against_gigachat(live_provider):
    """One real completion, verifying the harness schema round-trips."""
    import json

    from app.harness import HARNESS_STRUCTURED_SCHEMA
    from app.providers.models import Content, Message, ResponseFormat

    messages = [
        Message(role="system", content=[Content(text="Ты — инженер-сметчик.")]),
        Message(
            role="user",
            content=[Content(text="Прямоугольная пластина 200x100 мм, ст3 1 мм, 4 отверстия.")],
        ),
    ]
    response = await live_provider.generate(
        messages,
        ResponseFormat(
            type=ResponseFormat.TYPE_JSON_SCHEMA,
            schema=HARNESS_STRUCTURED_SCHEMA,
            strict=True,
        ),
        x_client_id=uuid.uuid4(),
        x_session_id=uuid.uuid4(),
    )

    assert response is not None, "the live API returned an error"
    payload = json.loads(response.messages[0].content[0].text)
    assert payload["message"]
    assert isinstance(payload["positions"], list)


async def test_live_upload_and_reflect(live_provider):
    """One real file upload, checking the returned id is usable."""
    session_id = uuid.uuid4()
    sber_id = await live_provider.upload(
        "smoke.png",
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,
        x_client_id=uuid.uuid4(),
        x_session_id=session_id,
        content_type="image/png",
    )
    assert sber_id
