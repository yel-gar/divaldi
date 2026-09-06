#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR"
COMPOSE_DIR="$SCRIPT_DIR/.."

MESSAGE="${1:?Usage: $0 \"migration message\"}"

cd "$COMPOSE_DIR"

# --- Determine if db was already running BEFORE we touch anything ---
DB_WAS_RUNNING=false
if docker compose ps --status running --services | grep -qx "db"; then
    DB_WAS_RUNNING=true
    echo "db is already running — will leave it running afterward."
else
    echo "db is not running — starting it."
    docker compose up -d db
fi

# --- Register cleanup to run on ANY exit (success, failure, or interrupt) ---
cleanup() {
    if [ "$DB_WAS_RUNNING" = false ]; then
        echo "Cleaning up: stopping db (it was not running before this script)."
        (cd "$COMPOSE_DIR" && docker compose stop db)
    else
        echo "Leaving db running (it was already running before this script)."
    fi
}
trap cleanup EXIT

# --- Wait for readiness using the container's own healthcheck ---
echo "Waiting for db to become healthy..."
ATTEMPTS=0
MAX_ATTEMPTS=30
until [ "$(docker compose ps --format '{{.Health}}' db)" = "healthy" ]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
        echo "db did not become healthy in time." >&2
        exit 1
    fi
    sleep 1
done
echo "db is healthy."

# --- Load env vars for host-side tooling ---
set -a
source "$COMPOSE_DIR/.env"
set +a
export POSTGRES_HOST="localhost"

# --- Run Alembic ---
cd "$BACKEND_DIR"

echo "Generating migration: $MESSAGE"
poetry run alembic revision --autogenerate -m "$MESSAGE"

echo "Applying migrations"
poetry run alembic upgrade head

echo "Done."
# cleanup() runs automatically here via the EXIT trap — no need to call it manually
