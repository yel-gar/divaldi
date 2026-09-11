from __future__ import annotations  # required so sqlalchemy doesn't go insane

import typing
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import UUID, DateTime, Enum, ForeignKey, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

MAX_FILENAME_LENGTH = 128

if typing.TYPE_CHECKING:
    from app.models.auth import User


class UserRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class GenerationResultType(StrEnum):
    ERROR = "error"
    SUCCESS = "success"


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message_session: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    content: Mapped[str] = mapped_column(Text(None), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user: Mapped[User] = relationship("User", back_populates="chat_messages")
    attachments: Mapped[list[Attachment]] = relationship(
        "Attachment", back_populates="message", cascade="all, delete-orphan"
    )


class GenerationResult(Base):
    __tablename__ = "generation_results"

    message_session: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    type: Mapped[GenerationResultType] = mapped_column(Enum(GenerationResultType), nullable=False)
    content: Mapped[str] = mapped_column(Text(None), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(Text(length=MAX_FILENAME_LENGTH), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    chat_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True
    )
    s3_key: Mapped[str] = mapped_column(nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    uploaded: Mapped[bool] = mapped_column(nullable=False, default=False, server_default=false())

    message: Mapped[ChatMessage | None] = relationship("ChatMessage", back_populates="attachments")
    processing_result: Mapped[ProcessingResult | None] = relationship(
        "ProcessingResult", back_populates="attachment", cascade="all, delete-orphan", uselist=False
    )
    processing_result_uploadables: Mapped[list[ProcessingResultUploadable]] = relationship(
        "ProcessingResultUploadable", back_populates="attachment", cascade="all, delete-orphan"
    )


class ProcessingResult(Base):
    __tablename__ = "processing_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    attachment_id: Mapped[int] = mapped_column(
        ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    output: Mapped[str] = mapped_column(Text(), nullable=False)

    attachment: Mapped[Attachment] = relationship("Attachment", back_populates="processing_result")


class ProcessingResultUploadable(Base):
    __tablename__ = "processing_result_uploadables"

    id: Mapped[int] = mapped_column(primary_key=True)
    attachment_id: Mapped[int] = mapped_column(ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False)
    s3_key: Mapped[str] = mapped_column(nullable=False)
    sber_id: Mapped[str | None] = mapped_column(Text(), nullable=True)

    attachment: Mapped[Attachment] = relationship(
        "Attachment", back_populates="processing_result_uploadables", uselist=False
    )
