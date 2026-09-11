from taskiq import TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource

import app.tasks  # noqa: F401
from app.tasks.conf.broker import broker

scheduler = TaskiqScheduler(broker=broker, sources=[LabelScheduleSource(broker)])
