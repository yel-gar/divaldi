import os

from app.providers.client import AIClient
from app.providers.mock import MOCK_API_KEY, MockProvider
from app.providers.sber import SberProvider

api_key = os.environ["SBER_API_KEY"]
scope = os.environ["SBER_API_SCOPE"]

# `SBER_API_KEY=mock` swaps the real GigaChat client for an offline stand-in that
# performs no network I/O. This is what lets the worker, route and end-to-end
# suites run without credentials and without incurring LLM cost. Everything else
# (Redis, MinIO, PostgreSQL) is still the real thing.
provider: AIClient = (
    MockProvider(api_key=api_key, scope=scope)
    if api_key == MOCK_API_KEY
    else SberProvider(
        api_key=api_key,
        scope=scope,
    )
)
