from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from math import isfinite
from typing import Any

import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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


def _sanitize_for_json(value: Any) -> Any:
    """Replace values JSON cannot encode with their text form.

    Python's `json` accepts `NaN` and `Infinity` when reading a body, so a client can
    send one; Starlette's `JSONResponse` writes with `allow_nan=False`, so echoing the
    offending input back inside a validation error turns a clean 422 into a crash. The
    client gets a broken response instead of the message that would have told it what
    was wrong. Non-finite floats therefore travel as strings.
    """
    if isinstance(value, float):
        return value if isfinite(value) else repr(value)
    if isinstance(value, dict):
        return {key: _sanitize_for_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_for_json(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return a 422 that can always be encoded.

    Same shape FastAPI produces by default — a list of error objects under `detail` —
    with the non-finite numbers replaced first and `jsonable_encoder` applied after,
    because the details carry Pydantic models and exception instances that are not
    JSON types either.
    """
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder({"detail": _sanitize_for_json(exc.errors())}),
    )
