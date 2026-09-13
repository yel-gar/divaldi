import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.chat import GenerationResultType, UserRole


class ChatAttachment(BaseModel):
    """
    Attachment reference as it appears embedded in a chat message.
    Use the id with the attachment endpoints to fetch its download URL or status.
    """

    id: int
    filename: str = Field(alias="name")

    model_config = {"from_attributes": True}


class ChatMessageSchema(BaseModel):
    id: int
    role: UserRole
    content: str = Field(
        description="Text of the message. For user messages, does not include file descriptions added on the backend"
    )
    attachments: list[ChatAttachment] = Field(description="Only attachments that finished processing are included")
    timestamp: datetime

    model_config = {"from_attributes": True}


class UserChatSchema(BaseModel):
    """Summary of a chat session, for use in a chat list view."""

    session_id: uuid.UUID
    last_message: ChatMessageSchema
    name: str = Field(description="Chat title, may be auto-generated and updated as the conversation progresses")


class ResultSchemaContent(BaseModel):
    """The latest generation outcome for a chat session: a completed assistant message or an error."""

    type: GenerationResultType
    content: str = Field(description="Assistant's reply text, or error message when type is ERROR")
    timestamp: datetime
    attachment_id: int | None = Field(None, description="Set if the assistant generated a file as part of this result")
    update_name: str | None = Field(None, description="If chat updated the name, this will be the new chat name")

    model_config = {"from_attributes": True}


class ResultSchema(BaseModel):
    """
    Response for polling generation status.
    If running is true, result reflects the previous turn, if any, and should be ignored.
    """

    running: bool = Field(description="True if a generation is currently in progress for this user")
    result: ResultSchemaContent | None = Field(None, description="Null if no message has been sent in this chat yet")


class ChatCreatedSchema(BaseModel):
    session_id: uuid.UUID


class SendMessageSchema(BaseModel):
    content: str = Field(max_length=5000)


class ChatDeletedResponse(BaseModel):
    deleted: bool = Field(description="False if the chat session did not exist")
