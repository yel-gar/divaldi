import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.chat import GenerationResultType, UserRole


class ChatMessageSchema(BaseModel):
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
    result: ResultSchemaContent | None = None


class ChatCreatedSchema(BaseModel):
    session_id: uuid.UUID


class CreateChatSchema(BaseModel):
    initial_message: str


class SendMessageSchema(BaseModel):
    content: str
