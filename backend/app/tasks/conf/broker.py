import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession
from taskiq import TaskiqMiddleware
from taskiq_aio_pika import AioPikaBroker, Queue
from taskiq_dashboard import DashboardMiddleware
from taskiq_redis import RedisAsyncResultBackend

from app.database import get_session_maker
from app.providers.containers import provider
from app.util import get_rabbitmq_url

default_queue = Queue(name="default")
network_queue = Queue(name="network")


class ProviderMiddleware(TaskiqMiddleware):
    async def shutdown(self):
        await provider.close()


result_backend = RedisAsyncResultBackend("redis://redis:6379/1", result_ex_time=3600)
broker = (
    AioPikaBroker(get_rabbitmq_url(), task_queues=[default_queue, network_queue])
    .with_result_backend(result_backend)
    .with_middlewares(
        DashboardMiddleware(
            url=f"http://taskiq_dashboard:{os.getenv('TASKIQ_DASHBOARD_PORT', '8000')}",
            api_token=os.environ["TASKIQ_API_TOKEN"],
        )
    )
)


@asynccontextmanager
async def tsq_db() -> AsyncGenerator[AsyncSession]:
    async with get_session_maker()() as session:
        yield session
