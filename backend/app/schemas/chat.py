import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.chat import GenerationResultType, UserRole


class ChatAttachment(BaseModel):
    id: int
    filename: str = Field(alias="name")

    model_config = {"from_attributes": True}


class ChatMessageSchema(BaseModel):
    id: int
    role: UserRole
    content: str
    attachments: list[ChatAttachment]
    timestamp: datetime

    model_config = {"from_attributes": True}


class UserChatSchema(BaseModel):
    session_id: uuid.UUID
    last_message: ChatMessageSchema
    name: str


class ResultSchemaContent(BaseModel):
    type: GenerationResultType
    content: str
    timestamp: datetime
    attachment_id: int | None = None
    update_name: str | None = Field(None, description="If chat updated the name, this will be the new chat name")

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
