#!/usr/bin/env bash
#
# Bring up the stack for end-to-end tests and make it ready to drive.
#
#   ./e2e/scripts/run.sh          # setup, seed and run the suite
#   ./e2e/scripts/setup.sh        # setup and seed only
#
# The stack runs with SBER_API_KEY=mock, so no GigaChat call is made and no
# credentials are needed. Only the LLM is faked: PostgreSQL, Redis, RabbitMQ,
# MinIO, the FastAPI app and the TaskIQ workers are all the real thing.
set -euo pipefail

E2E_USER="${E2E_USERNAME:-e2e}"
E2E_PASSWORD="${E2E_PASSWORD:-e2epassword}"
E2E_FRONTEND_PORT="${E2E_FRONTEND_PORT:-18080}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$REPO_ROOT"

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example and fill in the required values first." >&2
  exit 1
fi

# The e2e override repoints the frontend to its own port and forces the offline
# provider on every backend-like service.
if [ -f docker-compose.override.yml ] && ! cmp -s docker-compose.override.yml docker-compose.override.yml.e2e; then
  cp docker-compose.override.yml docker-compose.override.yml.bak
fi
cp docker-compose.override.yml.e2e docker-compose.override.yml

echo "==> Starting the stack"
E2E_FRONTEND_PORT="$E2E_FRONTEND_PORT" docker compose up -d --build

echo "==> Waiting for the frontend"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:${E2E_FRONTEND_PORT}/" 2>/dev/null; then
    break
  fi
  sleep 2
done

# nginx answering `/` only proves the bundle was served. The first spec still
# needs the API: it logs in, and a login against a backend that is still starting
# fails in a way that surfaces as "the app stayed on the login page". An
# unauthenticated 401 is the correct answer here and means the routes are loaded.
echo "==> Waiting for the backend API"
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    "http://localhost:${E2E_FRONTEND_PORT}/api/v1/users/me" 2>/dev/null)
  if [ "$code" = "401" ]; then
    break
  fi
  sleep 2
done

echo "==> Seeding the e2e superuser (${E2E_USER})"
# `exec -e` is required: compose does not forward host variables into the
# container on its own.
docker compose exec -T \
  -e "E2E_USERNAME=${E2E_USER}" \
  -e "E2E_PASSWORD=${E2E_PASSWORD}" \
  backend poetry run python - <<'PY'
import asyncio
import os

from app.auth import hash_password
from app.database import get_session_maker
from app.models.auth import AccountRole, User
from sqlalchemy import select

USERNAME = os.environ["E2E_USERNAME"]
PASSWORD = os.environ["E2E_PASSWORD"]


async def main():
    async with get_session_maker()() as db:
        existing = (
            await db.execute(select(User).where(User.username == USERNAME))
        ).scalar_one_or_none()
        if existing is not None:
            existing.password_hash = hash_password(PASSWORD)
            existing.role = AccountRole.SUPERUSER
            print(f"reset superuser {USERNAME}")
        else:
            db.add(
                User(
                    username=USERNAME,
                    password_hash=hash_password(PASSWORD),
                    role=AccountRole.SUPERUSER,
                )
            )
            print(f"created superuser {USERNAME}")
        await db.commit()


asyncio.run(main())
PY

echo "==> Clearing rate-limit keys"
# Both chat creation and message sending are limited to 5 per minute per user
# (`chats:post` in app/routes/chat.py). A single e2e run creates several chats
# and sends several messages, and consecutive runs land inside the same window,
# so the counters are reset here. Only `ratelimit:*` is touched.
docker compose exec -T redis sh -c '
  redis-cli --scan --pattern "ratelimit:*" | xargs -r redis-cli DEL
' >/dev/null

echo "==> Stack is ready on http://localhost:${E2E_FRONTEND_PORT}"
