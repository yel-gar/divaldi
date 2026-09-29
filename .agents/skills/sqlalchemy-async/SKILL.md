---
name: sqlalchemy-async
description: Conventions for SQLAlchemy 2.0 async ORM models, sessions, queries and Alembic migrations in the divaldi backend. Use when touching backend/app/models/, backend/app/database.py, or adding or changing an Alembic migration.
---

# SQLAlchemy 2.0 async and Alembic — divaldi conventions

PostgreSQL 18, asyncpg, SQLAlchemy >= 2.0.52, Alembic >= 1.19.

## Model file template

```python
from __future__ import annotations  # required so sqlalchemy doesn't go insane

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.chat import ChatSession

MAX_USERNAME_LENGTH = 32  # constants live next to the model that uses them


class User(Base):
    __tablename__ = "users"

    uuid: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(MAX_USERNAME_LENGTH), nullable=False)
    is_superuser: Mapped[bool] = mapped_column(nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sessions: Mapped[list["Session"]] = relationship(back_populates="user", cascade="all, delete-orphan")
```

Rules:

- `from __future__ import annotations` at the top is **required** for `Mapped[]` to resolve
  string annotations.
- Circular references go through `if TYPE_CHECKING:` plus quoted forward references.
- `nullable` is set **explicitly** on every column, even where the annotation implies it.
- Length limits are named constants, never bare numbers inside `String(...)`.
- Enums are `StrEnum` (`UserRole`, `GenerationResultType`).
- Timestamps are timezone-aware `DateTime(timezone=True)` with `server_default=func.now()`.

## Never edit models/__init__.py

```python
for _, module_name, _ in pkgutil.iter_modules(__path__):
    importlib.import_module(f"{__name__}.{module_name}")
```

This auto-registers every model so Alembic sees complete metadata. Adding a new model file
to `app/models/` is enough; manual imports are a bug.

## Sessions

```python
engine = get_engine()                      # lru_cache'd, created once
session_maker = get_session_maker()

async with session_maker() as session: ...  # app/routes
async with tsq_db() as session: ...         # inside workers and createsuperuser
```

- `get_db` is the FastAPI dependency behind `DbSession`.
- `app/tasks/conf/broker.py::tsq_db` is the worker-side context manager.
- `await db.commit()` is explicit; there is no unit-of-work wrapper.
- Relationships need `selectinload` in async code, for example
  `select(User).options(selectinload(User.sessions))`.

## Queries

```python
res = await db.execute(select(ChatSession).where(ChatSession.uuid == session_uuid))
session = res.scalar_one_or_none()
```

- `db.execute(...).scalar()` returns an untyped value, so narrow it with `# type: ignore` or
  a cast, as the existing code does.
- Lists need `.scalars().all()` or `.scalars().unique()` when eager-loading a collection.

## Migrations are mandatory

Any model change requires a migration. `tests/test_migrations.py` runs `upgrade head`,
`downgrade base` and `alembic check`, and fails on drift.

```bash
cp docker-compose.override.yml{.dev,}        # publishes PostgreSQL on 5431
./backend/makemigrations.sh "add expires_at to users"
```

- `alembic/env.py` gets its URL from `get_database_url()`, built from `POSTGRES_*`, not from
  `alembic.ini`, and escapes `%` as `%%` for `ConfigParser` interpolation.
- `alembic/versions/` is **excluded from black and ruff**. Do not reformat generated files.
- `alembic.ini` has a `ruff --fix` post-write hook on the revision script.

## Verify

```bash
poetry -C backend run pytest tests/test_migrations.py   # the drift gate
poetry -C backend run pytest                            # full suite
poetry -C backend run black --check .
poetry -C backend run ruff check .
```

The full suite needs a running Docker daemon (testcontainers).
