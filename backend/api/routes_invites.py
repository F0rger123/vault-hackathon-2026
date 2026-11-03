"""HTTP API v1, part 7: inviting people with a one-time link (F09.21).

An admin creates an invite; the person opens it and picks their own password, so no password is ever handed over.
The two public routes behave like the sign-in routes: VAULT's own interface only, a few tries a minute per address,
and one answer for every code that does not work (unknown, used, withdrawn or expired look the same).
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, get_settings, require
from backend.api.routes import _browser_origin_ok, _log_signin
from backend.api.routes_users import USERNAME
from backend.core.config import Settings
from backend.security import audit, invites
from backend.security import login as signin
from backend.security.auth import ROLE_PERMISSIONS, Principal, create_user, role_catalog
from backend.storage.db import transaction

router = APIRouter(prefix="/api/v1")

NOT_VALID = "this invite does not work any more; it may have expired, been used or been withdrawn"


class NewInvite(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    role: str
    note: str = Field(default="", max_length=200)
    steps: list[str] = Field(default_factory=list, max_length=3)


class InviteCode(BaseModel):
    # In the body, never the URL, so the code cannot end up in an access log or a proxy log.
    code: str = Field(min_length=1, max_length=64)


class AcceptInvite(InviteCode):
    password: str = Field(min_length=signin.MIN_PASSWORD, max_length=200)


@router.get("/users/roles")
def roles(_: Principal = Depends(require("users:manage"))) -> list[dict]:
    """Every role and what it can and cannot do, in plain words, read from the same table the server enforces."""
    return role_catalog()


@router.get("/users/invites")
def list_invites(conn=Depends(get_conn), _: Principal = Depends(require("users:manage"))) -> list[dict]:
    return invites.pending(conn)


@router.post("/users/invites", status_code=201)
def create_invite(body: NewInvite, conn=Depends(get_conn), p: Principal = Depends(require("users:manage"))) -> dict:
    name = body.username.strip()
    if not USERNAME.match(name):
        raise HTTPException(status_code=422, detail="use letters, numbers, dots, dashes, underscores or @ in the name")
    if body.role not in ROLE_PERMISSIONS:
        raise HTTPException(status_code=422, detail="unknown role")
    try:
        extras = invites.requested_extras(body.steps)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if signin.known_user(conn, name):
        raise HTTPException(status_code=409, detail="that name is already taken")
    if invites.open_for_name(conn, name):
        raise HTTPException(status_code=409, detail="that person already has an invite waiting; withdraw it first")
    made = invites.create(conn, name, body.role, body.note.strip(), extras, p.username)
    audit.record(
        conn,
        p.username,
        "user.invite",
        "allowed",
        target=f"user:{name}",
        detail={"role": body.role, "steps": extras, "invite_id": made["id"], "expires_at": made["expires_at"]},
    )
    return made


@router.delete("/users/invites/{invite_id}")
def revoke_invite(invite_id: int, conn=Depends(get_conn), p: Principal = Depends(require("users:manage"))) -> dict:
    row = invites.revoke(conn, invite_id)
    if row is None:
        raise HTTPException(status_code=404, detail="no invite waiting with that number")
    audit.record(
        conn,
        p.username,
        "user.invite_revoke",
        "allowed",
        target=f"user:{row['username']}",
        detail={"invite_id": row["id"]},
    )
    return {"revoked": True}


def _guard(conn, request: Request, settings: Settings, action: str) -> None:
    """The public-route protections: VAULT's own pages only, and a few tries a minute from each address."""
    if not _browser_origin_ok(request, settings):
        audit.record(conn, "unknown-user", action, "denied", detail={"reason": "other origin"})
        raise HTTPException(status_code=403, detail="invites are only accepted from VAULT's own interface")
    try:
        signin._start_attempt(_bucket(request))
    except signin.LoginLocked as exc:
        audit.record(conn, "unknown-user", action, "denied", detail={"reason": "locked"})
        raise HTTPException(status_code=429, detail=f"too many attempts; try again in {int(exc.wait) + 1} s") from exc


def _bucket(request: Request) -> str:
    return "\x00invite:" + (request.client.host if request.client else "")


@router.post("/auth/invite/preview")
def open_invite(
    body: InviteCode, request: Request, conn=Depends(get_conn), settings: Settings = Depends(get_settings)
) -> dict:
    """Public: who the invite is for and as what. Nothing else about the account or the server."""
    _guard(conn, request, settings, "auth.invite_open")
    row = invites.find_open(conn, body.code)
    if row is None:
        audit.record(conn, "unknown-user", "auth.invite_open", "denied", detail={"reason": "not valid"})
        raise HTTPException(status_code=404, detail=NOT_VALID)
    audit.record(conn, row["username"], "auth.invite_open", "allowed", detail={"invite_id": row["id"]})
    return {
        "username": row["username"],
        "role": row["role"],
        "invited_by": row["created_by"],
        "expires_at": row["expires_at"],
        "min_password": signin.MIN_PASSWORD,
    }


@router.post("/auth/invite/accept")
def accept_invite(
    body: AcceptInvite, request: Request, conn=Depends(get_conn), settings: Settings = Depends(get_settings)
) -> dict:
    """Public: set the password, use up the invite and sign in, all at once or not at all."""
    _guard(conn, request, settings, "auth.invite_accept")
    digest = signin.hash_password(body.password)  # slow on purpose, so done before taking the write lock
    with transaction(conn):
        row = invites.find_open(conn, body.code)
        reason = "not valid" if row is None else ("name taken" if signin.known_user(conn, row["username"]) else None)
        if reason is None:
            uid = create_user(conn, row["username"], row["role"])
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (digest, uid))
            invites.request_steps(conn, uid, invites.public(row)["steps"])
            invites.mark_used(conn, row["id"])
    if reason is not None:
        audit.record(conn, "unknown-user", "auth.invite_accept", "denied", detail={"reason": reason})
        if reason == "name taken":
            raise HTTPException(status_code=409, detail="someone already has that name; ask for a new invite")
        raise HTTPException(status_code=404, detail=NOT_VALID)
    signin.clear_attempts(_bucket(request))
    session = signin.after_step(conn, signin.step_user(conn, uid), ["password"], settings.session_ttl_hours)
    audit.record(
        conn,
        row["username"],
        "auth.invite_accept",
        "allowed",
        target=f"user:{row['username']}",
        detail={"invite_id": row["id"], "role": row["role"], "invited_by": row["created_by"]},
    )
    _log_signin(conn, request, row["username"], "invite", "allowed")
    return session
