"""HTTP API v1, part 5: passkey sign-in with face, fingerprint or a hardware key (F09.14)."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, get_settings, require
from backend.api.routes import _browser_origin_ok, _log_signin
from backend.core.config import Settings
from backend.security import audit, passkeys, signin_log
from backend.security import login as signin
from backend.security.auth import Principal, hash_token
from backend.storage.db import now

router = APIRouter(prefix="/api/v1")

FRESH_SECONDS = 15 * 60


def fresh_session(
    request: Request, conn=Depends(get_conn), p: Principal = Depends(require("system:read"))
) -> Principal:
    """Passkeys outlive a session, so a stolen or forgotten session must not be able to add or weaken them."""
    token = request.headers.get("authorization", "").partition(" ")[2].strip()
    row = conn.execute("SELECT created_at FROM api_tokens WHERE token_hash = ?", (hash_token(token),)).fetchone()
    if not row or now() - row["created_at"] > FRESH_SECONDS:
        audit.record(conn, p.username, "passkey.change", "denied", detail={"reason": "stale session"})
        raise HTTPException(status_code=403, detail="sign in again to change your passkeys")
    return p


def _origins(settings: Settings) -> list[str]:
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]


class RegisterVerify(BaseModel):
    handle: str = Field(max_length=64)
    credential: dict
    name: str = Field(default="Passkey", max_length=60)


class LoginOptions(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class LoginVerify(BaseModel):
    handle: str = Field(max_length=64)
    credential: dict


class Required(BaseModel):
    required: bool


@router.post("/auth/passkeys/register/options")
def register_options(
    conn=Depends(get_conn), settings: Settings = Depends(get_settings), p: Principal = Depends(fresh_session)
) -> dict:
    return passkeys.registration_options(conn, p.user_id, p.username, _origins(settings))


@router.post("/auth/passkeys/register", status_code=201)
def register(
    body: RegisterVerify,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(fresh_session),
) -> dict:
    try:
        saved = passkeys.register(conn, p.user_id, body.handle, body.credential, body.name, _origins(settings))
    except passkeys.PasskeyError as exc:
        audit.record(conn, p.username, "passkey.register", "denied", detail={"reason": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit.record(conn, p.username, "passkey.register", "allowed", detail={"name": saved["name"]})
    return saved


@router.get("/auth/passkeys")
def mine(conn=Depends(get_conn), p: Principal = Depends(require("system:read"))) -> dict:
    row = conn.execute("SELECT require_passkey FROM users WHERE id = ?", (p.user_id,)).fetchone()
    return {"passkeys": passkeys.list_passkeys(conn, p.user_id), "required": bool(row and row["require_passkey"])}


@router.delete("/auth/passkeys/{passkey_id}")
def remove(passkey_id: int, conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    if not passkeys.remove(conn, p.user_id, passkey_id):
        raise HTTPException(status_code=404, detail="not found")
    audit.record(conn, p.username, "passkey.remove", "allowed")
    return {"removed": passkey_id}


@router.put("/auth/passkeys/required")
def set_required(body: Required, conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    try:
        passkeys.set_required(conn, p.user_id, body.required)
    except passkeys.PasskeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    audit.record(conn, p.username, "passkey.require", "allowed", detail={"required": body.required})
    return {"required": body.required}


@router.post("/auth/passkey-login/options")
def login_options(
    body: LoginOptions, request: Request, conn=Depends(get_conn), settings: Settings = Depends(get_settings)
) -> dict:
    """Public, like password sign-in: only from VAULT's own interface, and rate-limited per account."""
    if not _browser_origin_ok(request, settings):
        raise HTTPException(status_code=403, detail="sign-in is only accepted from VAULT's own interface")
    known = signin.known_user(conn, body.username)
    try:
        signin._start_attempt(body.username if known else signin.UNKNOWN)
    except signin.LoginLocked as exc:
        ip = request.client.host if request.client else None
        who = body.username if known else "unknown-user"
        signin_log.record_locked(conn, who, "passkey", ip, request.headers.get("user-agent"))
        raise HTTPException(status_code=429, detail=f"too many attempts; try again in {int(exc.wait) + 1} s") from exc
    return passkeys.login_options(conn, body.username, _origins(settings))


@router.post("/auth/passkey-login")
def login(
    body: LoginVerify, request: Request, conn=Depends(get_conn), settings: Settings = Depends(get_settings)
) -> dict:
    if not _browser_origin_ok(request, settings):
        raise HTTPException(status_code=403, detail="sign-in is only accepted from VAULT's own interface")
    try:
        row = passkeys.login(conn, body.handle, body.credential, _origins(settings))
    except passkeys.PasskeyError as exc:
        audit.record(conn, "unknown-user", "auth.passkey_login", "denied", detail={"reason": str(exc)})
        _log_signin(conn, request, "unknown-user", "passkey", "denied", str(exc))
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    signin.clear_attempts(row["username"])
    audit.record(conn, row["username"], "auth.passkey_login", "allowed")
    _log_signin(conn, request, row["username"], "passkey", "allowed")
    return signin.passkey_session(conn, row, settings.session_ttl_hours)
