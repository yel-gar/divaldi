from __future__ import annotations  # required so sqlalchemy doesn't go insane

import typing
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import UUID, DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

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


class GenerationResult(Base):
    __tablename__ = "generation_results"

    message_session: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    type: Mapped[GenerationResultType] = mapped_column(Enum(GenerationResultType), nullable=False)
    content: Mapped[str] = mapped_column(Text(None), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
