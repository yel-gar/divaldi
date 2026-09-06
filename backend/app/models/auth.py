import datetime

from sqlalchemy import Column, String, DateTime, func, Integer, ForeignKey
from sqlalchemy.orm import relationship, Mapped, mapped_column

from database import Base

MAX_USERNAME_LENGTH = 32
NAME_SURNAME_MAX_LENGTH = 60


class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(MAX_USERNAME_LENGTH), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    first_name: Mapped[str] = mapped_column(String(NAME_SURNAME_MAX_LENGTH))
    last_name: Mapped[str] = mapped_column(String(NAME_SURNAME_MAX_LENGTH))
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = 'sessions'

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="session")
