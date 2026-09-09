#!/bin/sh

set -e

echo "Applying database migrations"
poetry run alembic upgrade head
echo "Migrations OK"

echo "Starting app"

debug_value=$(echo "${DEBUG:-true}" | tr '[:upper:]' '[:lower:]')

case "$debug_value" in
  0|no|false)
    poetry run uvicorn app.main:app --host 0.0.0.0 --port 3000
    ;;
  *)
    echo "DEBUG enabled: starting with autoreload"
    poetry run uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload --reload-include '*.py'
    ;;
esac
