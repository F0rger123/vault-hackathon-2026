"""HTTP API v1, part 5: passkey sign-in with face, fingerprint or a hardware key (F09.14)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, get_settings, require
from backend.api.routes import FaceLive, _browser_origin_ok, _log_signin
from backend.core.config import Settings
from backend.security import audit, face, invites, liveness, passkeys, signin_log, steps, voice
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
    # F09.20: set when the passkey is a later step, after a password the person also asked for.
    step: str | None = Field(default=None, max_length=64)


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
    apply_requested(conn, p)
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
    srow = signin.step_user(conn, row["id"])
    if body.step:
        try:
            ticket = steps.peek(body.step)
        except steps.StepError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        if ticket["user_id"] != row["id"] or steps.remaining(srow, ticket["done"])[:1] != ["passkey"]:
            steps.wrong(body.step)
            raise HTTPException(status_code=401, detail="that passkey belongs to a different account")
        result = signin.continue_step(conn, body.step, "passkey", settings.session_ttl_hours)
        method = steps.method_label(result.get("done") or [*ticket["done"], "passkey"])
    else:
        result = signin.after_step(conn, srow, ["passkey"], settings.session_ttl_hours)
        method = "passkey"
    if "step" in result:
        audit.record(conn, row["username"], "auth.passkey_login", "allowed", detail={"next": result["step"]})
        return result
    audit.record(conn, row["username"], "auth.passkey_login", "allowed")
    _log_signin(conn, request, row["username"], method, "allowed")
    return result


# ---------- face check (F09.19) ----------


class FaceChallengeFor(BaseModel):
    purpose: Literal["enroll", "test"]


@router.get("/auth/face")
def face_status(conn=Depends(get_conn), p: Principal = Depends(require("system:read"))) -> dict:
    return {
        **face.status(conn, p.user_id),
        "match": face.MATCH,
        "live_min": liveness.LIVE_MIN,
        "real_min": liveness.REAL_MIN,
    }


@router.post("/auth/face/challenge")
def face_challenge_for_me(body: FaceChallengeFor, p: Principal = Depends(require("system:read"))) -> dict:
    """F09.22: a challenge for setting up face unlock, or for testing it while signed in."""
    return liveness.issue(f"user:{p.user_id}", body.purpose)


@router.post("/auth/face", status_code=201)
def face_enroll(body: FaceLive, conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    """Save this person's face fingerprints. Numbers only: the browser never sends a picture.

    F09.22: setting up also answers a liveness challenge, so a photo cannot be enrolled in place of a face.
    """
    try:
        embeddings, summary = body.check(f"user:{p.user_id}", "enroll")
        n = face.enroll(conn, p.user_id, embeddings)
    except face.FaceError as exc:
        audit.record(conn, p.username, "face.enroll", "denied", detail={"reason": str(exc)})
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    audit.record(conn, p.username, "face.enroll", "allowed", detail={"samples": n, "moves": summary["moves"]})
    apply_requested(conn, p)
    return face.status(conn, p.user_id)


@router.post("/auth/face/test")
def face_test(body: FaceLive, conn=Depends(get_conn), p: Principal = Depends(require("system:read"))) -> dict:
    """F09.22: "Test my face now". The same checks as a sign-in, without signing in; the numbers are shown."""
    out: dict = {"match": False, "threshold": face.MATCH, "each_min": face.MATCH_EACH}
    try:
        embeddings, summary = body.check(f"user:{p.user_id}", "test")
        out["moves"] = summary["moves"]
        out |= face.compare(conn, p.user_id, embeddings)
        face.match(conn, p.user_id, embeddings)
    except face.FaceError as exc:
        out["reason"] = str(exc)
    out["best"] = round(out.get("best", 0.0), 3)
    out["worst"] = round(out.get("worst", 0.0), 3)
    audit.record(conn, p.username, "face.test", "allowed" if out["match"] else "denied", detail={"best": out["best"]})
    return out


@router.delete("/auth/face")
def face_remove(conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    face.remove(conn, p.user_id)
    audit.record(conn, p.username, "face.remove", "allowed")
    return face.status(conn, p.user_id)


@router.put("/auth/face/required")
def face_required(body: Required, conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    if body.required and not face.status(conn, p.user_id)["enrolled"]:
        raise HTTPException(status_code=409, detail="set up face unlock first")
    conn.execute("UPDATE users SET require_face = ? WHERE id = ?", (int(body.required), p.user_id))
    audit.record(conn, p.username, "face.require", "allowed", detail={"required": body.required})
    return face.status(conn, p.user_id)


# ---------- spoken key phrase and the steps a person picks (F09.20) ----------


class VoiceEnroll(BaseModel):
    samples: list[list[list[float]]] = Field(min_length=voice.SAMPLES, max_length=voice.SAMPLES)
    snr_db: float = Field(ge=-100, le=200)


class Steps(BaseModel):
    steps: list[str] = Field(max_length=4)


def set_up(conn, user_id: int) -> dict[str, bool]:
    """Which steps this person could require right now: each needs setting up first."""
    row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    return {
        "password": bool(row and row["password_hash"]),
        "passkey": bool(passkeys.list_passkeys(conn, user_id)),
        "face": face.status(conn, user_id)["enrolled"],
        "voice": voice.status(conn, user_id)["enrolled"],
    }


def steps_status(conn, user_id: int) -> dict:
    row = signin.step_user(conn, user_id)
    return {
        "required": steps.required(row) if row else [],
        "set_up": set_up(conn, user_id),
        # F09.21: steps an admin asked for that this person still has to set up.
        "requested": invites.requested(conn, user_id),
    }


def apply_requested(conn, p: Principal) -> list[str]:
    """F09.21: switch on each step an admin asked for as soon as the person has set it up."""
    asked = invites.requested(conn, p.user_id)
    ready = set_up(conn, p.user_id)
    now_on = [s for s in asked if ready[s]]
    if not now_on:
        return []
    row = signin.step_user(conn, p.user_id)
    if row is None:
        return []
    apply_steps(conn, p.user_id, [*steps.required(row), *now_on])
    invites.set_requested(conn, p.user_id, [s for s in asked if s not in now_on])
    audit.record(conn, p.username, "signin.steps", "allowed", detail={"requested_by_admin": now_on})
    return now_on


def apply_steps(conn, user_id: int, wanted: list[str]) -> None:
    """Raises ValueError for an unknown step or one this person has not set up."""
    unknown = [s for s in wanted if s not in steps.FACTORS]
    if unknown:
        raise ValueError(f"unknown sign-in step: {unknown[0]}")
    ready = set_up(conn, user_id)
    missing = [steps.LABELS[s] for s in wanted if not ready[s]]
    if missing:
        raise ValueError(f"set up the {missing[0]} first")
    sets = ", ".join(f"require_{f} = ?" for f in steps.FACTORS)
    conn.execute(
        f"UPDATE users SET {sets} WHERE id = ?",  # noqa: S608 - column names come from steps.FACTORS
        (*[int(f in wanted) for f in steps.FACTORS], user_id),
    )


@router.get("/auth/steps")
def my_steps(conn=Depends(get_conn), p: Principal = Depends(require("system:read"))) -> dict:
    return steps_status(conn, p.user_id)


@router.put("/auth/steps")
def set_my_steps(body: Steps, conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    try:
        apply_steps(conn, p.user_id, body.steps)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    audit.record(conn, p.username, "signin.steps", "allowed", detail={"steps": body.steps})
    return steps_status(conn, p.user_id)


@router.get("/auth/voice")
def voice_status(conn=Depends(get_conn), p: Principal = Depends(require("system:read"))) -> dict:
    return {**voice.status(conn, p.user_id), "min_snr_db": voice.MIN_SNR_DB, "samples": voice.SAMPLES}


@router.post("/auth/voice", status_code=201)
def voice_enroll(body: VoiceEnroll, conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    """Save the key phrase as numbers describing how it sounds. No recording is sent or kept."""
    try:
        saved = voice.enroll(conn, p.user_id, body.samples, body.snr_db)
    except voice.VoiceError as exc:
        audit.record(conn, p.username, "voice.enroll", "denied", detail={"reason": str(exc)})
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    audit.record(conn, p.username, "voice.enroll", "allowed")
    apply_requested(conn, p)
    return saved


@router.delete("/auth/voice")
def voice_remove(conn=Depends(get_conn), p: Principal = Depends(fresh_session)) -> dict:
    voice.remove(conn, p.user_id)
    audit.record(conn, p.username, "voice.remove", "allowed")
    return voice.status(conn, p.user_id)
