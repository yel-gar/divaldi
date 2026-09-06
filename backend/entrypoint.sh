#!/bin/bash

set -e

echo "Applying database migrations"
alembic upgrade head
echo "Migrations OK"

echo "Starting app"
uvicorn app.main:app --host 0.0.0.0 --port 3000 --reload
