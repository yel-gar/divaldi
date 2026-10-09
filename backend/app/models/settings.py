from __future__ import annotations  # required so sqlalchemy doesn't go insane

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

#: Primary key of the one row this table ever holds. Reads and writes both
#: address it explicitly rather than "the first row", so an accidental second
#: row cannot silently become the active configuration.
SETTINGS_ROW_ID = 1

#: Upper bound on the admin-authored prompt extension. Generous, because the
#: intended content is site-specific tolerances and a list of unavailable
#: materials; still bounded so a pasted document cannot be appended to every
#: system prompt this instance sends.
MAX_PROMPT_EXTENSION_LENGTH = 8000


class Settings(Base):
    """Instance-wide settings editable by admins.

    A singleton row rather than a key/value table: every option is a typed column
    with its own validation, so reading it is an ORM attribute access rather than
    a parse, and the next option arrives as a migration instead of as code that
    has to guess a type at runtime. `SETTINGS_ROW_ID` is enforced by a check
    constraint, so "singleton" is a database invariant and not a convention.
    """

    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=SETTINGS_ROW_ID, autoincrement=False)
    prompt_extension: Mapped[str] = mapped_column(Text(), nullable=False, default="")
    #: Null rather than non-null: an admin who saved this may later be deleted,
    #: and the prompt they wrote must survive that. SET NULL keeps the row and
    #: drops only the attribution.
    last_update_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None
    )
    #: Null until the first write, because "never set" and "set to the empty
    #: extension" are different states and only one of them has a timestamp.
    last_update_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    __table_args__ = (CheckConstraint("id = 1", name="ck_settings_singleton"),)
