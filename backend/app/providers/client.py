import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import Literal

import structlog.stdlib
from httpx import AsyncClient, Response

from app.providers.models import GenerationResponse, Message, ResponseFormat

Scope = Literal["PERS", "B2B", "CORP"]


class AuthorizationError(Exception):
    pass


class AIClient(ABC):
    _client: AsyncClient
    _log: structlog.stdlib.BoundLogger
    token: str | None = None
    token_expires_at: datetime | None = None
    api_key: str
    scope: Scope

    def __init__(self, api_key: str, scope: Scope):
        self.api_key = api_key
        self.scope = scope
        self._log = structlog.stdlib.get_logger(__name__)
        self.token = None
        self.token_expires_at = None

    @abstractmethod
    async def auth(self): ...

    @abstractmethod
    async def generate(
        self,
        message_history: list[Message],
        response_format: ResponseFormat,
        x_client_id: uuid.UUID,
        x_session_id: uuid.UUID,
    ) -> GenerationResponse | None: ...

    async def _authed_request(self, method: Literal["GET", "POST"], endpoint: str, **kwargs) -> Response:
        if (
            self.token_expires_at is None
            or self.token is None
            or datetime.now(UTC) > self.token_expires_at - timedelta(seconds=30)
        ):
            self._log.warning("auth_token_refresh_started")
            await self.auth()
        r = await self._client.request(method=method, url=endpoint, **kwargs)
        if r.status_code == 401:
            self._log.error("auth_token_refresh_failed", status_code=r.status_code)
            raise AuthorizationError()
        self._log.info("auth_token_refresh_ok")
        return r

    async def _get(self, endpoint: str, **kwargs) -> Response:
        return await self._authed_request(method="GET", endpoint=endpoint, **kwargs)

    async def _post(self, endpoint: str, **kwargs) -> Response:
        return await self._authed_request(method="POST", endpoint=endpoint, **kwargs)
