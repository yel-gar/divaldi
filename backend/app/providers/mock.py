import hashlib
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from app.harness import MATERIALS
from app.providers.client import AIClient
from app.providers.models import (
    Content,
    GenerationResponse,
    InputTokenDetails,
    Message,
    ResponseFormat,
    Usage,
)

MOCK_API_KEY = "mock"

Mode = Literal["kp", "clarify", "empty", "error"]

#: Modes the mock understands. ``kp`` is the happy path: a complete commercial
#: offer. ``clarify`` returns an empty ``positions`` list, which the harness
#: contract defines as "ask the user for more information". ``empty`` returns a
#: response with no content at all, and ``error`` returns ``None``, both of
#: which drive the backend's error paths.
MODES: tuple[Mode, ...] = ("kp", "clarify", "empty", "error")

DEFAULT_MODE: Mode = "kp"

#: A material index guaranteed to have a price on the template's metal-price
#: sheet, so the calculator can always build a spreadsheet. See MATERIALS[12],
#: a 1.0 mm carbon-steel grade that is present in the shipped template.
DEFAULT_MATERIAL_INDEX = 12


def get_mock_mode() -> Mode:
    """Read the mode from the environment, falling back to the happy path.

    Kept as a function (not a module constant) so tests can change
    ``MOCK_PROVIDER_MODE`` with ``monkeypatch.setenv``.
    """
    raw = os.getenv("MOCK_PROVIDER_MODE", DEFAULT_MODE).strip().lower()
    return raw if raw in MODES else DEFAULT_MODE  # type: ignore[return-value]


def _seed(*parts: str) -> int:
    """A stable integer derived from the inputs.

    Deterministic on purpose: the same conversation must always produce the same
    numbers, otherwise end-to-end assertions and spreadsheets drift between runs.
    """
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _rounded(value: float, digits: int = 2) -> float:
    return round(value, digits)


class MockProvider(AIClient):
    """Offline stand-in for :class:`~app.providers.sber.SberProvider`.

    Selected automatically when ``SBER_API_KEY`` is the literal string ``"mock"``
    (see ``app.providers.containers``). It performs no network I/O at all, which
    is what makes the worker, route and end-to-end suites possible without
    credentials and without incurring GigaChat cost.
    """

    def __init__(self, api_key: str, scope: str):
        if scope not in ("PERS", "B2B", "CORP"):
            raise ValueError("Scope must be PERS, B2B or CORP")
        super().__init__(api_key, scope)

    async def auth(self):
        self._log.info("mock_auth", scope=self.scope)
        self.token = f"mock-token-{_seed(self.api_key, self.scope):08x}"
        # Far enough out that ensure_fresh_token() never re-authenticates mid-test.
        self.token_expires_at = datetime.now(UTC) + timedelta(days=1)

    async def upload(
        self,
        filename: str,
        data: bytes,
        x_client_id: uuid.UUID,
        x_session_id: uuid.UUID,
        content_type: str,
    ) -> str:
        self._log.debug(
            "mock_upload",
            filename=filename,
            size=len(data),
            content_type=content_type,
            x_client_id=str(x_client_id),
            x_session_id=str(x_session_id),
        )
        return f"mock-file-{_seed(str(x_session_id), filename):08x}"

    def _positions(self, fingerprint: str) -> list[dict]:
        seed = _seed(fingerprint)
        count = 1 + seed % 2  # one or two positions, never more
        positions = []
        for i in range(count):
            sub = _seed(fingerprint, str(i))
            area = _rounded(0.1 + (sub % 900) / 1000, 3)
            positions.append(
                {
                    "name": f"Деталь {i + 1}",
                    "material": DEFAULT_MATERIAL_INDEX,
                    "area_m2": area,
                    "laser_m": _rounded(1.0 + (sub % 500) / 100, 2),
                    "bends": sub % 8,
                    "welding_m": _rounded((sub % 250) / 100, 2),
                    "turning_hours": 0.0,
                    "painting_m2": _rounded(area * 2, 3),
                }
            )
        return positions

    def _payload(self, fingerprint: str) -> dict:
        mode = get_mock_mode()
        if mode == "clarify":
            return {
                "chat_name": "Расчёт КП (mock)",
                "message": (
                    "Уточните, пожалуйста, материал и габариты детали — " "без них расчёт стоимости невозможен."
                ),
                "gen_kp": False,
                "positions": [],
            }
        if mode == "empty":
            return {"chat_name": "Расчёт КП (mock)", "message": "", "gen_kp": False, "positions": []}
        positions = self._positions(fingerprint)
        return {
            "chat_name": "Расчёт КП (mock)",
            "message": (
                f"Готово: рассчитано {len(positions)} позиц. " f"Материал: {MATERIALS[DEFAULT_MATERIAL_INDEX]}."
            ),
            "gen_kp": True,
            "positions": positions,
        }

    async def generate(
        self,
        message_history: list[Message],
        response_format: ResponseFormat,
        x_client_id: uuid.UUID,
        x_session_id: uuid.UUID,
    ) -> GenerationResponse | None:
        fingerprint = "|".join(m.content[0].text for m in message_history if m.content)
        mode = get_mock_mode()
        self._log.debug(
            "mock_generate",
            mode=mode,
            messages=len(message_history),
            format=response_format.type,
            x_client_id=str(x_client_id),
            x_session_id=str(x_session_id),
        )

        if mode == "error":
            return None

        if mode == "empty":
            # A well-formed response carrying no content, which the backend must
            # treat as "Provider did not respond properly".
            return self._wrap([Message(role="assistant", content=[])], fingerprint)

        payload = json.dumps(self._payload(fingerprint), ensure_ascii=False)
        return self._wrap([Message(role="assistant", content=[Content(text=payload)])], fingerprint)

    def _wrap(self, messages: list[Message], fingerprint: str) -> GenerationResponse:
        seed = _seed(fingerprint, "usage")
        return GenerationResponse(
            messages=messages,
            model="mock-model",
            thread_id=f"mock-thread-{seed:08x}",
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
            finish_reason="stop",
            usage=Usage(
                input_tokens=100 + seed % 400,
                input_tokens_details=InputTokenDetails(prompt_tokens=100 + seed % 400, cached_tokens=0),
                output_tokens=50 + seed % 200,
                total_tokens=150 + seed % 600,
            ),
        )
