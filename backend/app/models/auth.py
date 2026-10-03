from __future__ import annotations  # required so sqlalchemy doesn't go insane

import datetime
import typing
import uuid
from enum import StrEnum
from typing import Final

from sqlalchemy import UUID, DateTime, Enum, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if typing.TYPE_CHECKING:
    from app.models.chat import ChatSession

MAX_USERNAME_LENGTH = 32
NAME_SURNAME_MAX_LENGTH = 60


class AccountRole(StrEnum):
    """Privilege tier of a user account, ordered from lowest to highest.

    Named `AccountRole` and not `UserRole` because `app.models.chat.UserRole` is
    the role of a *chat message*; two enums with the same name for different
    things is a trap in a codebase this size.
    """

    USER = "user"
    ADMIN = "admin"
    SUPERUSER = "superuser"


#: Privilege order, lowest first. Answering "may A act on B?" is a comparison of
#: these numbers, so it stays correct when a tier is added.
ROLE_RANK: Final[dict[AccountRole, int]] = {
    AccountRole.USER: 0,
    AccountRole.ADMIN: 1,
    AccountRole.SUPERUSER: 2,
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        server_default=text("gen_random_uuid()"),
        unique=True,
    )
    username: Mapped[str] = mapped_column(String(MAX_USERNAME_LENGTH), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    first_name: Mapped[str | None] = mapped_column(String(NAME_SURNAME_MAX_LENGTH))
    last_name: Mapped[str | None] = mapped_column(String(NAME_SURNAME_MAX_LENGTH))
    expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    role: Mapped[AccountRole] = mapped_column(
        Enum(AccountRole),
        default=AccountRole.USER,
        nullable=False,
        server_default=AccountRole.USER.name,
    )

    sessions: Mapped[list[Session]] = relationship(back_populates="user", cascade="all, delete-orphan")
    chat_sessions: Mapped[list[ChatSession]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship("User", back_populates="sessions")
