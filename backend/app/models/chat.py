from __future__ import annotations  # required so sqlalchemy doesn't go insane

import typing
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import UUID, VARCHAR, DateTime, Enum, ForeignKey, Text, false, func
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
    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    content: Mapped[str] = mapped_column(Text(None), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # list of file ids, if any present, separated by , and no spaces
    files_str: Mapped[str] = mapped_column(Text(None), nullable=True, default=None)

    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="messages")
    attachments: Mapped[list[Attachment]] = relationship(
        "Attachment", back_populates="message", cascade="all, delete-orphan"
    )


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    user: Mapped[User] = relationship("User", back_populates="chat_sessions")
    messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )
    generation_result: Mapped[GenerationResult | None] = relationship(
        "GenerationResult", back_populates="session", uselist=False
    )
    attachments: Mapped[list[Attachment]] = relationship(
        "Attachment", back_populates="session", cascade="all, delete-orphan"
    )


class GenerationResult(Base):
    __tablename__ = "generation_results"

    chat_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"), primary_key=True
    )
    type: Mapped[GenerationResultType] = mapped_column(Enum(GenerationResultType), nullable=False)
    content: Mapped[str] = mapped_column(Text(None), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="generation_result")


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(VARCHAR(length=MAX_FILENAME_LENGTH), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True
    )
    s3_key: Mapped[str] = mapped_column(nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    ready: Mapped[bool] = mapped_column(nullable=False, default=False, server_default=false())

    message: Mapped[ChatMessage | None] = relationship("ChatMessage", back_populates="attachments", uselist=False)
    processing_result: Mapped[ProcessingResult | None] = relationship(
        "ProcessingResult", back_populates="attachment", cascade="all, delete-orphan", uselist=False
    )
    processing_result_uploadables: Mapped[list[ProcessingResultUploadable]] = relationship(
        "ProcessingResultUploadable", back_populates="attachment", cascade="all, delete-orphan"
    )
    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="attachments")


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

    attachment: Mapped[Attachment] = relationship("Attachment", back_populates="processing_result_uploadables")
