import structlog
from fastapi import FastAPI, APIRouter

from routes import auth
from util import get_debug

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
    ]
)

log = structlog.stdlib.get_logger()

log.info("Starting server")
if get_debug():
    log.warning("DEBUG mode is enabled")
else:
    log.warning("PRODUCTION mode is enabled")

app = FastAPI(
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
)
base_router = APIRouter(
    prefix="/api/v1"
)
base_router.include_router(auth.router, tags=["auth"])

app.include_router(base_router)
