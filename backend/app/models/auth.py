from __future__ import annotations  # required so sqlalchemy doesn't go insane

import datetime
import typing
import uuid

import sqlalchemy
from sqlalchemy import UUID, DateTime, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if typing.TYPE_CHECKING:
    from app.models.chat import ChatMessage

MAX_USERNAME_LENGTH = 32
NAME_SURNAME_MAX_LENGTH = 60


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, server_default=text("gen_random_uuid()"), unique=True
    )
    username: Mapped[str] = mapped_column(String(MAX_USERNAME_LENGTH), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    first_name: Mapped[str | None] = mapped_column(String(NAME_SURNAME_MAX_LENGTH))
    last_name: Mapped[str | None] = mapped_column(String(NAME_SURNAME_MAX_LENGTH))
    expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    is_superuser: Mapped[bool] = mapped_column(default=False, nullable=False, server_default=sqlalchemy.false())

    sessions: Mapped[list[Session]] = relationship(back_populates="user", cascade="all, delete-orphan")
    chat_messages: Mapped[list[ChatMessage]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship("User", back_populates="sessions")
