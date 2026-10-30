"""HTTP API v1, part 6: people with their own logins, and the sign-in log (F09.17).

There is deliberately no route that deletes a user or a log row. A person who leaves is disabled, so the log and the
audit trail keep a name to refer to.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, require
from backend.api.routes import _log_signin
from backend.security import audit, signin_log
from backend.security import login as signin
from backend.security.auth import ROLE_PERMISSIONS, Principal, create_user

router = APIRouter(prefix="/api/v1")

USERNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$")


class NewUser(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    role: str
    password: str = Field(min_length=signin.MIN_PASSWORD, max_length=200)


class UserChange(BaseModel):
    role: str | None = None
    disabled: bool | None = None


class NewPassword(BaseModel):
    password: str = Field(min_length=signin.MIN_PASSWORD, max_length=200)


class OwnPassword(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=signin.MIN_PASSWORD, max_length=200)


def _user(conn, user_id: int):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="no such user")
    return row


def _public(conn, row) -> dict:
    last = conn.execute(
        "SELECT ts, method FROM signin_log WHERE username = ? AND outcome = 'allowed' "
        "AND method NOT IN ('sign-out', 'password-change') ORDER BY id DESC LIMIT 1",
        (row["username"],),
    ).fetchone()
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "disabled": bool(row["disabled"]),
        "has_password": bool(row["password_hash"]),
        "created_at": row["created_at"],
        "last_sign_in": dict(last) if last else None,
    }


def _other_active_admins(conn, user_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?", (user_id,)
    ).fetchone()[0]


@router.get("/users")
def list_users(conn=Depends(get_conn), _: Principal = Depends(require("users:manage"))) -> list[dict]:
    return [_public(conn, r) for r in conn.execute("SELECT * FROM users ORDER BY username").fetchall()]


@router.post("/users", status_code=201)
def add_user(body: NewUser, conn=Depends(get_conn), p: Principal = Depends(require("users:manage"))) -> dict:
    name = body.username.strip()
    if not USERNAME.match(name):
        raise HTTPException(status_code=422, detail="use letters, numbers, dots, dashes, underscores or @ in the name")
    if body.role not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=422, detail="unknown role")
    if signin.known_user(conn, name):
        raise HTTPException(status_code=409, detail="that name is already taken")
    uid = create_user(conn, name, body.role)
    signin.set_password(conn, name, body.password)
    audit.record(conn, p.username, "user.create", "allowed", target=f"user:{name}", detail={"role": body.role})
    return _public(conn, _user(conn, uid))


@router.patch("/users/{user_id}")
def change_user(
    user_id: int, body: UserChange, conn=Depends(get_conn), p: Principal = Depends(require("users:manage"))
) -> dict:
    row = _user(conn, user_id)
    if body.role is not None and body.role not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=422, detail="unknown role")
    if body.disabled is True and user_id == p.user_id:
        raise HTTPException(status_code=409, detail="you cannot disable your own account")
    losing_admin = row["role"] == "admin" and ((body.role not in (None, "admin")) or body.disabled is True)
    if losing_admin and not _other_active_admins(conn, user_id):
        raise HTTPException(status_code=409, detail="VAULT needs at least one active admin")
    if body.role is not None:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (body.role, user_id))
    if body.disabled is not None:
        conn.execute("UPDATE users SET disabled = ? WHERE id = ?", (int(body.disabled), user_id))
        if body.disabled:
            signin.end_sessions(conn, user_id)
    audit.record(
        conn,
        p.username,
        "user.change",
        "allowed",
        target=f"user:{row['username']}",
        detail={"role": body.role, "disabled": body.disabled},
    )
    return _public(conn, _user(conn, user_id))


@router.put("/users/{user_id}/password")
def reset_password(
    user_id: int, body: NewPassword, conn=Depends(get_conn), p: Principal = Depends(require("users:manage"))
) -> dict:
    row = _user(conn, user_id)
    ended = signin.set_password(conn, row["username"], body.password)
    audit.record(conn, p.username, "user.set_password", "allowed", target=f"user:{row['username']}")
    return {"sessions_ended": ended}


@router.post("/auth/password")
def change_own_password(
    body: OwnPassword, request: Request, conn=Depends(get_conn), p: Principal = Depends(require("system:read"))
) -> dict:
    """Asks for the current password, so a session left open cannot be turned into a takeover."""
    try:
        signin._start_attempt(p.username)
    except signin.LoginLocked as exc:
        raise HTTPException(status_code=429, detail=f"too many attempts; try again in {int(exc.wait) + 1} s") from exc
    row = _user(conn, p.user_id)
    if not signin.verify_password(body.current, row["password_hash"]):
        audit.record(conn, p.username, "auth.change_password", "denied")
        raise HTTPException(status_code=403, detail="the current password is wrong")
    signin.clear_attempts(p.username)
    ended = signin.set_password(conn, p.username, body.password)
    audit.record(conn, p.username, "auth.change_password", "allowed")
    _log_signin(conn, request, p.username, "password-change", "allowed")
    return {"sessions_ended": ended}


@router.get("/signin-log")
def signin_entries(
    limit: int = Query(200, ge=1, le=1000),
    username: str | None = Query(None, max_length=64),
    conn=Depends(get_conn),
    _: Principal = Depends(require("audit:read")),
) -> list[dict]:
    return signin_log.entries(conn, limit, username)


@router.get("/signin-log/verify")
def signin_verify(conn=Depends(get_conn), _: Principal = Depends(require("audit:read"))) -> dict:
    return signin_log.verify(conn)
