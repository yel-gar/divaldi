"""Tests for the Pydantic schemas in :mod:`app.providers.models`.

These are the wire types exchanged with GigaChat. Several of them carry
validators that silently accept a second input shape, so most tests here feed the
model two different representations of the same value and assert both land in the
same place.
"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.harness import MATERIALS
from app.models.chat import ChatMessage, UserRole
from app.providers.models import (
    AuthResponse,
    Content,
    FileSchema,
    GenerationRequest,
    GenerationResponse,
    HarnessStructuredOutput,
    InputTokenDetails,
    Message,
    ModelOptions,
    Position,
    ResponseFormat,
    Usage,
)

FUTURE_MS = 4_102_444_800_000  # 2100-01-01T00:00:00Z
FUTURE = datetime.fromtimestamp(FUTURE_MS / 1000, tz=UTC)


# ---------------------------------------------------------------------------
# AuthResponse
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("raw", [FUTURE_MS, float(FUTURE_MS)])
def test_auth_response_parses_int_and_float_ms_epoch(raw):
    response = AuthResponse.model_validate({"access_token": "tok", "expires_at": raw})

    assert response.access_token == "tok"
    assert response.expires_at == FUTURE
    assert response.expires_at.tzinfo is not None


def test_auth_response_passes_through_a_datetime():
    moment = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

    response = AuthResponse.model_validate({"access_token": "tok", "expires_at": moment})

    assert response.expires_at == moment


def test_auth_response_rejects_an_unparseable_expiry():
    with pytest.raises(ValidationError):
        AuthResponse.model_validate({"access_token": "tok", "expires_at": "tomorrow"})


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------


def test_content_none_files_becomes_an_empty_list():
    content = Content(text="hello", files=None)

    assert content.files == []
    assert content.inline_data is None


def test_content_files_default_to_empty_without_the_key():
    content = Content(text="hello")

    assert content.files == []


def test_content_files_accepts_a_list_of_dicts():
    content = Content(text="hello", files=[{"id": "a"}, {"id": "b"}])

    assert content.files == [FileSchema(id="a"), FileSchema(id="b")]


def test_content_files_rejects_a_malformed_entry():
    with pytest.raises(ValidationError):
        Content(text="hello", files=[{"id": 1}])


def test_content_carries_inline_data():
    content = Content(text="", inline_data={"image/png": "base64"})

    assert content.inline_data == {"image/png": "base64"}


# ---------------------------------------------------------------------------
# Message.from_chat_message
# ---------------------------------------------------------------------------


def test_message_from_chat_message_without_files():
    row = ChatMessage(role=UserRole.USER, content="привет")

    message = Message.from_chat_message(row)

    assert message.role == "user"
    assert message.content == [Content(text="привет", files=[])]


def test_message_from_chat_message_splits_and_strips_files_str():
    row = ChatMessage(role=UserRole.ASSISTANT, content="ok", files_str=" a1 , a2 ,a3")

    message = Message.from_chat_message(row)

    assert message.role == "assistant"
    assert message.content[0].files == [FileSchema(id="a1"), FileSchema(id="a2"), FileSchema(id="a3")]


def test_message_from_chat_message_preserves_the_system_role():
    row = ChatMessage(role=UserRole.SYSTEM, content="system prompt")

    assert Message.from_chat_message(row).role == "system"


# ---------------------------------------------------------------------------
# Position.material_id_to_material_str
# ---------------------------------------------------------------------------


def position_kwargs(**overrides) -> dict:
    data = {
        "name": "Деталь",
        "area_m2": 0.5,
        "laser_m": 1.2,
        "bends": 3,
        "welding_m": 0.4,
        "turning_hours": 0.0,
        "painting_m2": 0.5,
    }
    data.update(overrides)
    return data


@pytest.mark.parametrize("index", [0, 5, len(MATERIALS) - 1])
def test_position_resolves_a_material_index(index):
    position = Position(**position_kwargs(material=index))

    assert position.material == MATERIALS[index]


def test_position_passes_a_material_string_through():
    position = Position(**position_kwargs(material="1,5 мм Ст3 (2500х1250)"))

    assert position.material == "1,5 мм Ст3 (2500х1250)"


def test_position_out_of_range_index_raises_index_error():
    # ``MATERIALS`` is a list, so an out-of-range lookup raises IndexError — not
    # the KeyError the validator catches, and not the ValueError it means to
    # raise. IndexError is not a pydantic-handled exception, so it propagates
    # out of model_validate instead of becoming a ValidationError. Asserted as
    # it is today rather than as intended; see .context/LESSONS.md.
    with pytest.raises(IndexError):
        Position(**position_kwargs(material=len(MATERIALS) + 5))


def test_position_negative_index_wraps_around():
    # A negative index is not out of range for a list, so -1 silently resolves
    # to the last material rather than being rejected.
    assert Position(**position_kwargs(material=-1)).material == MATERIALS[-1]


# ---------------------------------------------------------------------------
# ResponseFormat
# ---------------------------------------------------------------------------


def test_response_format_class_vars():
    assert ResponseFormat.TYPE_TEXT == "text"
    assert ResponseFormat.TYPE_JSON_SCHEMA == "json_schema"


def test_response_format_json_schema_requires_a_schema():
    with pytest.raises(ValidationError, match="schema is required"):
        ResponseFormat(type="json_schema", strict=True)


def test_response_format_json_schema_requires_strict():
    with pytest.raises(ValidationError, match="schema is required"):
        ResponseFormat(type="json_schema", schema={"type": "object"})


def test_response_format_json_schema_with_both_is_valid():
    fmt = ResponseFormat(type="json_schema", schema={"type": "object"}, strict=True)

    assert fmt.json_schema == {"type": "object"}
    assert fmt.strict is True


def test_response_format_json_schema_validates_through_the_schema_alias():
    fmt = ResponseFormat.model_validate({"type": "json_schema", "schema": {"type": "object"}, "strict": True})

    assert fmt.json_schema == {"type": "object"}


def test_response_format_text_rejects_a_schema():
    with pytest.raises(ValidationError, match="schema must not be provided"):
        ResponseFormat(type="text", schema={"type": "object"})


def test_response_format_text_rejects_strict():
    with pytest.raises(ValidationError, match="schema must not be provided"):
        ResponseFormat(type="text", strict=True)


def test_response_format_text_with_neither_is_valid():
    assert ResponseFormat(type="text") == ResponseFormat(type="text", json_schema=None, strict=None)


def test_response_format_rejects_an_unknown_type():
    with pytest.raises(ValidationError):
        ResponseFormat(type="xml")


# ---------------------------------------------------------------------------
# ModelOptions / GenerationRequest
# ---------------------------------------------------------------------------


def test_model_options_wraps_a_response_format():
    options = ModelOptions(response_format=ResponseFormat(type="text"))

    assert options.response_format.type == "text"


def test_model_options_propagates_a_bad_response_format():
    with pytest.raises(ValidationError):
        ModelOptions(response_format={"type": "json_schema", "strict": True})


def test_generation_request_holds_model_messages_and_options():
    request = GenerationRequest(
        model="GigaChat-3-Ultra",
        messages=[Message(role="user", content=[{"text": "hi"}])],
        model_options=ModelOptions(response_format=ResponseFormat(type="text")),
    )

    dumped = request.model_dump(exclude_unset=True, by_alias=True)

    assert dumped["model"] == "GigaChat-3-Ultra"
    assert dumped["messages"][0]["content"][0]["text"] == "hi"
    assert dumped["model_options"]["response_format"] == {"type": "text"}


def test_generation_request_requires_a_model():
    with pytest.raises(ValidationError):
        GenerationRequest(
            messages=[Message(role="user", content=[{"text": "hi"}])],
            model_options=ModelOptions(response_format=ResponseFormat(type="text")),
        )


# ---------------------------------------------------------------------------
# GenerationResponse
# ---------------------------------------------------------------------------


def response_body(**overrides) -> dict:
    body = {
        "messages": [{"role": "assistant", "content": [{"text": "ответ"}]}],
        "model": "GigaChat-3-Ultra",
        "created_at": FUTURE_MS,
        "finish_reason": "stop",
        "usage": {
            "input_tokens": 10,
            "input_tokens_details": {"prompt_tokens": 8, "cached_tokens": 2},
            "output_tokens": 5,
            "total_tokens": 15,
        },
    }
    body.update(overrides)
    return body


def test_generation_response_parses_an_int_ms_created_at():
    response = GenerationResponse.model_validate(response_body())

    assert response.created_at == FUTURE
    assert response.thread_id is None


def test_generation_response_parses_a_float_ms_created_at():
    response = GenerationResponse.model_validate(response_body(created_at=float(FUTURE_MS)))

    assert response.created_at == FUTURE


def test_generation_response_passes_through_a_datetime_created_at():
    moment = datetime(2026, 5, 6, 7, 8, 9, tzinfo=UTC)

    response = GenerationResponse.model_validate(response_body(created_at=moment))

    assert response.created_at == moment


def test_generation_response_keeps_the_thread_id():
    response = GenerationResponse.model_validate(response_body(thread_id="thread-1"))

    assert response.thread_id == "thread-1"


def test_generation_response_rejects_an_unknown_finish_reason():
    with pytest.raises(ValidationError):
        GenerationResponse.model_validate(response_body(finish_reason="exploded"))


def test_generation_response_requires_usage():
    body = response_body()
    del body["usage"]

    with pytest.raises(ValidationError):
        GenerationResponse.model_validate(body)


# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------


def test_usage_requires_the_prompt_token_details():
    with pytest.raises(ValidationError):
        Usage(input_tokens=1, output_tokens=2, total_tokens=3)


def test_input_token_details_is_a_plain_model():
    assert InputTokenDetails(prompt_tokens=8, cached_tokens=2).cached_tokens == 2


# ---------------------------------------------------------------------------
# HarnessStructuredOutput
# ---------------------------------------------------------------------------


def test_harness_structured_output_defaults_positions_to_empty():
    output = HarnessStructuredOutput(message="ок", gen_kp=False)

    assert output.positions == []
    assert output.chat_name is None


def test_harness_structured_output_resolves_material_indices():
    output = HarnessStructuredOutput.model_validate(
        {
            "chat_name": "Кронштейн",
            "message": "ок",
            "gen_kp": True,
            "positions": [position_kwargs(material=0)],
        }
    )

    assert output.chat_name == "Кронштейн"
    assert output.gen_kp is True
    assert output.positions[0].material == MATERIALS[0]
