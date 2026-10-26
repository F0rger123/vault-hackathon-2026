"""FastAPI application factory. Run with: uvicorn backend.main:create_app --factory"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.routes import VERSION, router
from backend.api.routes_agents import router as agents_router
from backend.core.config import Settings, get_settings
from backend.storage.db import migrate
from backend.workers.jobs import JobRunner

log = logging.getLogger("vault")


def create_app(settings: Settings | None = None, resume_jobs: bool = True) -> FastAPI:
    settings = settings or get_settings()
    migrate(settings.db_path)
    app = FastAPI(title="VAULT API", version=VERSION)
    app.state.settings = settings
    app.state.runner = JobRunner(settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        # Never echo exception text: it can contain file paths or document content.
        log.exception("unhandled error on %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "internal error"})

    app.include_router(router)
    app.include_router(agents_router)
    if resume_jobs:
        app.state.runner.resume_unfinished()
    return app
