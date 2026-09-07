#!/bin/sh

set -e

echo "Applying database migrations"
poetry run alembic upgrade head
echo "Migrations OK"

echo "Starting app"
poetry run uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
