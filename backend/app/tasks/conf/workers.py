import app.tasks  # noqa: F401
from app.tasks.conf.broker import broker, default_queue, network_queue


def default_worker():
    return broker.with_queue(default_queue)


def network_worker():
    return broker.with_queue(network_queue)
