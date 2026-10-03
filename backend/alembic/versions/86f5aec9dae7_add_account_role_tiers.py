"""add account role tiers

Replaces the `users.is_superuser` boolean with a three-value `role` enum. The
backfill runs before the old column is dropped, so every existing superuser
keeps its tier instead of silently demoting itself to `USER`.

Revision ID: 86f5aec9dae7
Revises: 58cdf8dfcbba
Create Date: 2026-10-03 14:22:50.497384

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "86f5aec9dae7"
down_revision: str | Sequence[str] | None = "58cdf8dfcbba"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

accountrole = sa.Enum("USER", "ADMIN", "SUPERUSER", name="accountrole")


def upgrade() -> None:
    """Upgrade schema."""
    accountrole.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column("role", accountrole, server_default="USER", nullable=False),
    )
    op.execute("UPDATE users SET role = 'SUPERUSER' WHERE is_superuser")
    op.drop_column("users", "is_superuser")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "users",
        sa.Column(
            "is_superuser",
            sa.BOOLEAN(),
            server_default=sa.text("false"),
            autoincrement=False,
            nullable=False,
        ),
    )
    op.execute("UPDATE users SET is_superuser = true WHERE role = 'SUPERUSER'")
    op.drop_column("users", "role")
    accountrole.drop(op.get_bind(), checkfirst=True)
