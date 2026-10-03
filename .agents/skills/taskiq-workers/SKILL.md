---
name: taskiq-workers
description: Conventions for TaskIQ background jobs in the divaldi backend — queue assignment, cron schedules, thread offloading, Redis status keys and logging. Use when adding or changing anything in backend/app/tasks/.
---

# TaskIQ workers — divaldi conventions

TaskIQ >= 0.12, broker RabbitMQ via `taskiq-aio-pika` (vhost `taskiq`), results in Redis
database `/1`, dashboard at `http://taskiq_dashboard:8000`.

## Queue assignment is a design decision

| Queue | Nature | Use it for |
|---|---|---|
| `default` | local, CPU-bound | DXF parsing, PDF rasterising, avatar normalisation, result processing, cleanup crons |
| `network` | outbound GigaChat calls | `generate_chat_message`, `upload_pdf_image` |

This matters because the `network` queue is bounded by external API latency. Keeping it
separate means a slow or rate-limited GigaChat cannot starve DXF parsing or the cleanup
crons. Pool sizes are independent (`worker_default` x2, `worker_network` x2).

## Defining a task

```python
from datetime import timedelta

import structlog
from app.tasks.conf.broker import broker, tsq_db

log = structlog.stdlib.get_logger(__name__)


@broker.task(queue_name="default")
async def process_dxf(attachment_id: int) -> None:
    log = log.bind(attachment_id=attachment_id)
    async with tsq_db() as session:
        ...
```

- `queue_name` is **mandatory**; there is no default.
- All tasks are `async def`.
- Enqueue with `.kiq(...)`. Await the future only when you need the result inline.
- Bind log context per task with `log.bind(...)`.

## Offload blocking work

Anything CPU-bound or filesystem-heavy goes through the thread pool:

```python
images = await asyncio.to_thread(converter.convert, pdf_path)
result = await asyncio.to_thread(process_calculation, template_bytes, params)
```

This applies to PyMuPDF rasterising, the DXF parser, `openpyxl` workbook writing and Pillow
resizing. Never call these directly inside an async task; a single one blocks the whole
worker's event loop.

## Scheduled jobs

```python
@broker.task(queue_name="default", schedule=[{"interval": timedelta(hours=1)}])
async def cleanup_old_results() -> None:
    ...
```

Schedules are served by the `scheduler` service via `LabelScheduleSource`
(`app/tasks/conf/scheduler.py`). Periods currently in use: 10 minutes for
`cleanup_expired_sessions`, 1 hour for the cleanup family.

## Sessions inside tasks

Use `tsq_db()` from `app/tasks/conf/broker.py`, not the FastAPI `get_db`:

```python
async with tsq_db() as session:
    ...
```

## Status reporting

Long-running work publishes progress to Redis so the frontend can poll it:

- success writes `"completed"` to the status key
- failure writes `"error"`

Status keys come from the named builders in `app/cache.py`; never build a key inline. The
frontend polls every 2 s (`AttachmentUploadService`, up to 150 attempts).

## Current task inventory

| Task | File | Queue | Schedule |
|---|---|---|---|
| `generate_chat_message` | `tasks/api.py` | `network` | none |
| `process_response` | `tasks/api.py` | `default` | none |
| `cleanup_old_results` | `tasks/api.py` | `default` | 1 hour |
| `process_attachment` | `tasks/files.py` | `default` | none |
| `process_pdf` | `tasks/files.py` | `default` | none |
| `process_dxf` | `tasks/files.py` | `default` | none |
| `process_image` | `tasks/files.py` | `default` | none |
| `process_avatar` | `tasks/files.py` | `default` | none |
| `upload_pdf_image` | `tasks/files.py` | `network` | none |
| `pdf_upload_cleanup` | `tasks/files.py` | `default` | none |
| `cleanup_orphan_attachments` | `tasks/files.py` | `default` | 1 hour |
| `cleanup_stale_results` | `tasks/files.py` | `default` | 1 hour |
| `cleanup_expired_sessions` | `tasks/users.py` | `default` | 10 minutes |

## Provider lifecycle

`ProviderMiddleware` closes the AI provider on shutdown. The provider itself is a
module-level singleton in `app/providers/containers.py`, constructed at import time, so
`SBER_API_KEY` and `SBER_API_SCOPE` must exist or importing any task module raises
`KeyError`.

## Gotchas

- Worker services reload task files with `-tp 'app/tasks/*.py'`. A new task file is picked up
  automatically, but a **renamed** task needs a restart.
- The deletion-tombstone key makes a worker discard a result whose session was deleted
  mid-flight. Do not remove that check.
- Per-user generation is guarded by a Redis lock (`chats:global`), not by the database.

## Verify

```bash
poetry -C backend run black --check .
poetry -C backend run ruff check .
docker compose up -d --build
docker compose logs -f worker_default worker_network scheduler
```

Inspect real task runs at http://localhost:8000, which needs `TASKIQ_API_TOKEN`.
