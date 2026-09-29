"""Helpers shared by the backend test modules."""

from typing import Any

from taskiq import AsyncTaskiqTask


async def run_task(task: AsyncTaskiqTask, *args: Any, **kwargs: Any) -> Any:
    """Await a TaskIQ task's coroutine body without going through the broker.

    ``@broker.task`` returns an :class:`AsyncTaskiqDecoratedTask`, which is not
    itself awaitable — calling it enqueues onto RabbitMQ. ``original_func`` is
    the undecorated coroutine, which is what actually runs inside a worker and
    what a test wants to exercise. This keeps the queue out of the picture while
    still executing the real task body, including its Redis and MinIO work.
    """
    return await task.original_func(*args, **kwargs)


def get_task(task: AsyncTaskiqTask):
    """Return the coroutine function behind a decorated task."""
    return task.original_func
