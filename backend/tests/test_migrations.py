"""
Tests that exercise the real Alembic migration path against a throwaway
Postgres container — separate from the app's own test fixtures in
conftest.py, which use Base.metadata.create_all() for speed rather than
running actual migrations.

These tests matter because create_all() can never catch:
  - a bad/out-of-order migration
  - a migration with a typo or manually-broken op
  - Postgres-specific DDL that only fails when actually executed
  - models that were changed without a corresponding migration being written

Requires Docker to be available (testcontainers spins up a real
postgres:18-alpine container per test run).
"""

import os
import subprocess
from pathlib import Path

import pytest
from testcontainers.postgres import PostgresContainer

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _run_alembic(*args: str, database_url: str) -> subprocess.CompletedProcess:
    """Run an alembic CLI command against the given database, from the
    backend project root (where alembic.ini lives)."""
    env = {
        **os.environ,
        "POSTGRES_USER": "unused",
        "POSTGRES_PASSWORD": "unused",
        "POSTGRES_HOST": "unused",
        "POSTGRES_DB": "unused",
    }
    # env.py builds the URL via get_database_url(), but for these tests we
    # want to point at the exact testcontainers URL directly. Easiest robust
    # way without touching env.py's env-var-based logic: override via the
    # standard Alembic -x / config override mechanism is more plumbing than
    # it's worth here, so we instead set the individual POSTGRES_* pieces
    # parsed out of the testcontainers URL.
    from urllib.parse import urlparse

    parsed = urlparse(database_url)
    env["POSTGRES_USER"] = parsed.username or "unused"
    env["POSTGRES_PASSWORD"] = parsed.password or "unused"
    env["POSTGRES_HOST"] = parsed.hostname or "localhost"
    env["POSTGRES_PORT"] = str(parsed.port or 5432)
    env["POSTGRES_DB"] = parsed.path.lstrip("/")

    return subprocess.run(
        ["alembic", *args],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )


@pytest.fixture(scope="module")
def migration_postgres_url():
    with PostgresContainer("postgres:18-alpine", driver="asyncpg") as postgres:
        yield postgres.get_connection_url()


def test_alembic_upgrade_head_succeeds(migration_postgres_url):
    """The full migration chain must apply cleanly to a brand-new database."""
    result = _run_alembic("upgrade", "head", database_url=migration_postgres_url)

    assert result.returncode == 0, (
        f"alembic upgrade head failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )


def test_alembic_downgrade_to_base_succeeds(migration_postgres_url):
    """Every migration's downgrade() must also work, not just upgrade()."""
    upgrade_result = _run_alembic("upgrade", "head", database_url=migration_postgres_url)
    assert upgrade_result.returncode == 0, upgrade_result.stderr

    downgrade_result = _run_alembic("downgrade", "base", database_url=migration_postgres_url)
    assert downgrade_result.returncode == 0, (
        f"alembic downgrade base failed:\nSTDOUT:\n{downgrade_result.stdout}\n"
        f"STDERR:\n{downgrade_result.stderr}"
    )


def test_no_pending_model_changes(migration_postgres_url):
    """
    Guards against forgetting to generate a migration after changing a model.

    `alembic check` compares the current models (target_metadata) against
    the schema produced by running all migrations, and exits non-zero if
    autogenerate would still detect a difference.
    """
    upgrade_result = _run_alembic("upgrade", "head", database_url=migration_postgres_url)
    assert upgrade_result.returncode == 0, upgrade_result.stderr

    check_result = _run_alembic("check", database_url=migration_postgres_url)
    assert check_result.returncode == 0, (
        "Models have changes that are not reflected in a migration. "
        f"Run `alembic revision --autogenerate -m '...'`.\n"
        f"STDOUT:\n{check_result.stdout}\nSTDERR:\n{check_result.stderr}"
    )
