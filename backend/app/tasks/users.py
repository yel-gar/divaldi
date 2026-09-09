from datetime import timedelta

import structlog
from sqlalchemy import delete, func

from app.models.auth import Session
from app.tasks.conf.broker import broker, tsq_db

log = structlog.stdlib.get_logger(__name__)


@broker.task(queue_name="default", schedule=[{"interval": timedelta(minutes=10)}])
async def cleanup_expired_sessions():
    log.info("expired_sessions_cleanup_start")
    async with tsq_db() as db:
        res = await db.execute(delete(Session).where(Session.expires_at < func.now()))
        await db.commit()

        log.info("expired_sessions_cleanup_finished", count=res.rowcount)
