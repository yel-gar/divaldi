import structlog
from fastapi import APIRouter, FastAPI

from app.routes import auth, users
from app.util import get_debug

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
base_router = APIRouter(prefix="/api/v1")
base_router.include_router(auth.router, tags=["auth"])
base_router.include_router(users.router, tags=["users"])

app.include_router(base_router)
