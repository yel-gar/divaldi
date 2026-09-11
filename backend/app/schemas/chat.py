import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.chat import GenerationResultType, UserRole


class ChatMessageSchema(BaseModel):
    id: int
    role: UserRole
    content: str
    timestamp: datetime

    model_config = {"from_attributes": True}


class UserChatSchema(BaseModel):
    session_id: uuid.UUID
    last_message: ChatMessageSchema


class ResultSchemaContent(BaseModel):
    type: GenerationResultType
    content: str
    timestamp: datetime

    model_config = {"from_attributes": True}


class ResultSchema(BaseModel):
    running: bool
    result: ResultSchemaContent | None = None


class ChatCreatedSchema(BaseModel):
    session_id: uuid.UUID


class SendMessageSchema(BaseModel):
    content: str = Field(max_length=5000)


class ChatDeletedResponse(BaseModel):
    deleted: bool
