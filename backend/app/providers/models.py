from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


class AuthResponse(BaseModel):
    access_token: str
    expires_at: datetime

    @field_validator("expires_at", mode="before")
    @classmethod
    def parse_expires_at(cls, v):
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000)
        return v


class Content(BaseModel):
    text: str
    inline_data: dict[str, str] | None = None


class Message(BaseModel):
    role: Literal["user", "system", "assistant", "tool"]
    content: Content


class ResponseFormat(BaseModel):
    type: Literal["json_schema", "text"]
    schema: dict | None = None
    strict: bool = True

    @model_validator(mode="after")
    def validate_schema(self):
        if self.type == "json_schema" and self.schema is None:
            raise ValueError("schema is required for json_schema messages")

        if self.type == "text" and self.schema is not None:
            raise ValueError("schema must not be provided for text messages")

        return self


class ModelOptions(BaseModel):
    response_format: ResponseFormat


class GenerationRequest(BaseModel):
    model: str
    messages: list[Message]
    model_options: ModelOptions


class InputTokenDetails(BaseModel):
    cached_tokens: int


class Usage(BaseModel):
    input_tokens: int
    input_token_details: InputTokenDetails
    output_tokens: int
    total_tokens: int


class GenerationResponse(BaseModel):
    messages: list[Message]
    model: str
    thread_id: str
    created_at: datetime
    finish_reason: Literal[
        "stop",
        "length",
        "function_call",
        "function_call_error",
        "blacklist",
        "request_blacklist",
        "request_whitelist",
        "request_filter",
        "response_blacklist",
    ]
    usage: Usage

    @field_validator("created_at", mode="before")
    @classmethod
    def parse_created_at(cls, v):
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000, tz=UTC)
        return v
