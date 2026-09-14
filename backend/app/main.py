from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import admin, auth, chat, users
from app.util import get_debug, get_origins

log = structlog.stdlib.get_logger()

log.info("Starting server")
debug = get_debug()
if debug:
    log.warning("DEBUG mode is enabled")
else:
    log.warning("PRODUCTION mode is enabled")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from app.tasks.conf.broker import broker

    log.info("Starting RabbitMQ broker")
    await broker.startup()
    yield
    log.info("Shutting down RabbitMQ broker")
    await broker.shutdown()


app = FastAPI(
    openapi_url="/api/v1/openapi.json" if debug else None,
    docs_url="/api/v1/docs" if debug else None,
    redoc_url="/api/v1/redoc" if debug else None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

base_router = APIRouter(prefix="/api/v1")
base_router.include_router(auth.router)
base_router.include_router(users.router)
base_router.include_router(admin.router)
base_router.include_router(chat.router)

app.include_router(base_router)
