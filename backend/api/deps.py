"""Request dependencies: database connection, authentication and permission checks."""

import sqlite3
from collections.abc import Iterator

from fastapi import Depends, HTTPException, Request

from backend.core.config import Settings
from backend.core.runtime import effective_settings  # noqa: F401 - re-exported for routes
from backend.security import audit
from backend.security.auth import Principal, authenticate
from backend.storage.db import connect


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_conn(settings: Settings = Depends(get_settings)) -> Iterator[sqlite3.Connection]:
    with connect(settings.db_path) as conn:
        yield conn


def current_principal(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> Principal:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    principal = authenticate(conn, token.strip()) if scheme.lower() == "bearer" else None
    if principal is None:
        audit.record(
            conn,
            "anonymous",
            f"{request.method} {request.url.path}",
            "denied",
            detail={"reason": "missing or invalid token"},
        )
        raise HTTPException(status_code=401, detail="authentication required", headers={"WWW-Authenticate": "Bearer"})
    return principal


def require(permission: str):
    def check(
        request: Request,
        principal: Principal = Depends(current_principal),
        conn: sqlite3.Connection = Depends(get_conn),
    ) -> Principal:
        if not principal.can(permission):
            audit.record(
                conn,
                principal.username,
                f"{request.method} {request.url.path}",
                "denied",
                detail={"reason": f"missing permission {permission}", "role": principal.role},
            )
            raise HTTPException(status_code=403, detail=f"permission '{permission}' required")
        return principal

    return check
