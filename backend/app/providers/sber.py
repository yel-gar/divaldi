import os
import ssl
import uuid
from pathlib import Path

from httpx import AsyncClient, Timeout

from app.providers.client import AIClient, AuthorizationError
from app.providers.models import (
    AuthResponse,
    GenerationRequest,
    GenerationResponse,
    Message,
    ModelOptions,
    ResponseFormat,
)


class SberProvider(AIClient):
    def __init__(self, api_key: str, scope: str):
        if scope not in ("PERS", "B2B", "CORP"):
            raise ValueError("Scope must be PERS, B2B or CORP")
        super().__init__(api_key, scope)

        self._client = AsyncClient(
            base_url="https://api.giga.chat/v2",
            verify=ssl.create_default_context(cafile=Path("res/gigachat-ca.cer")),
            timeout=Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0),
        )

    async def auth(self):
        rq_uid = str(uuid.uuid4())
        scope = "GIGACHAT_API_" + self.scope.upper()

        self._log.info("auth", rq_uid=rq_uid, scope=scope)
        response = await self._client.post(
            "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
            headers={
                "RqUID": rq_uid,
                "Authorization": f"Basic {self.api_key}",
            },
            data={"scope": scope},
        )
        if response.status_code != 200:
            self._log.error("auth_failed", rq_uid=rq_uid, status_code=response.status_code, resp=response.json())
            raise AuthorizationError()

        data = AuthResponse.model_validate(response.json())
        self.token = data.access_token
        self.token_expires_at = data.expires_at
        self._client.headers["Authorization"] = f"Bearer {self.token}"
        self._log.info("auth_ok", rq_uid=rq_uid, scope=scope, until=self.token_expires_at)

    async def generate(
        self,
        message_history: list[Message],
        response_format: ResponseFormat,
        x_client_id: uuid.UUID,
        x_session_id: uuid.UUID,
    ) -> GenerationResponse | None:
        x_request_id = str(uuid.uuid4())
        log = self._log.bind(x_request_id=x_request_id, x_client_id=x_client_id, x_session_id=x_session_id)
        headers = {
            "X-Client-Id": str(x_client_id),
            "X-Session-Id": str(x_session_id),
            "X-Request-Id": x_request_id,
        }
        data = GenerationRequest(
            model=os.getenv("GIGACHAT_MODEL", "GigaChat-3-Ultra"),
            messages=message_history,
            model_options=ModelOptions(response_format=response_format),
        )

        r = await self._post(
            "/chat/completions", json=data.model_dump(exclude_unset=True, by_alias=True), headers=headers
        )
        if r.status_code != 200:
            log.error(
                "completion_failure", data=data.model_dump(by_alias=True), response=r.json(), status_code=r.status_code
            )
            return None

        json_data = r.json()
        log.debug("completion_response", data=json_data)
        return GenerationResponse.model_validate(json_data)

    async def upload(self, filename: str, data: bytes, x_client_id: uuid.UUID, x_session_id: uuid.UUID) -> str | None:
        x_request_id = str(uuid.uuid4())
        log = self._log.bind(
            x_request_id=x_request_id, x_client_id=x_client_id, x_session_id=x_session_id, filename=filename
        )
        headers = {
            "X-Client-Id": str(x_client_id),
            "X-Session-Id": str(x_session_id),
            "X-Request-Id": x_request_id,
        }

        r = await self._post(
            "https://api.giga.chat/v1/files",
            headers=headers,
            files={"file": (filename, data, "application/octet-stream")},
        )
        if r.status_code != 200:
            log.error("upload_failure", reponse=r.json(), status_code=r.status_code)

        json_data = r.json()
        log.debug("upload_response", data=json_data)
        return json_data["id"]
