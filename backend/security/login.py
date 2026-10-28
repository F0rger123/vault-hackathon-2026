"""Signing in without handling raw API tokens (F10.11).

- Username and password: passwords are stored only as scrypt hashes. A successful sign-in issues an
  ordinary bearer token that expires after `session_ttl_hours`. Repeated failures lock that username
  for a minute.
- Demo sign-in: one click as the demo admin, analyst or viewer. Only when the server runs with
  `VAULT_DEMO_LOGIN=true`, which is meant for a laptop showing fictional data, never a shared server.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import sqlite3
import threading
import time

from backend.security.auth import hash_token, issue_token
from backend.storage.db import now

MIN_PASSWORD = 10
_N, _R, _P = 2**14, 8, 1
MAX_FAILURES = 5
LOCK_SECONDS = 60
DEMO_USERS = ("admin", "analyst", "viewer")

_failures: dict[str, list[float]] = {}
_lock = threading.Lock()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def verify_password(password: str, stored: str | None) -> bool:
    try:
        scheme, n, r, p, salt, digest = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def set_password(conn: sqlite3.Connection, username: str, password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"password must be at least {MIN_PASSWORD} characters")
    cur = conn.execute("UPDATE users SET password_hash = ? WHERE username = ?", (hash_password(password), username))
    if cur.rowcount != 1:
        raise LookupError(f"no user named {username!r}")


def locked_for(username: str) -> float:
    """Seconds left on a lockout for this username, or 0."""
    with _lock:
        recent = [t for t in _failures.get(username, []) if time.monotonic() - t < LOCK_SECONDS]
        _failures[username] = recent
        if len(recent) >= MAX_FAILURES:
            return LOCK_SECONDS - (time.monotonic() - recent[0])
    return 0.0


def _record_failure(username: str) -> None:
    with _lock:
        _failures.setdefault(username, []).append(time.monotonic())


def password_login(conn: sqlite3.Connection, username: str, password: str, ttl_hours: float) -> dict | None:
    """A new session token, or None for a wrong username or password (deliberately the same answer)."""
    row = conn.execute("SELECT id, username, role, password_hash FROM users WHERE username = ?", (username,)).fetchone()
    # Hash even for unknown users, so response time does not reveal which usernames exist.
    ok = verify_password(password, row["password_hash"] if row else None) if row else verify_password(password, None)
    if not row or not ok:
        _record_failure(username)
        return None
    with _lock:
        _failures.pop(username, None)
    return _session(conn, row, "password-login", ttl_hours)


def demo_login(conn: sqlite3.Connection, role: str, ttl_hours: float) -> dict | None:
    if role not in DEMO_USERS:
        return None
    row = conn.execute("SELECT id, username, role FROM users WHERE username = ?", (role,)).fetchone()
    return _session(conn, row, "demo-login", ttl_hours) if row else None


def _session(conn: sqlite3.Connection, row, label: str, ttl_hours: float) -> dict:
    token = issue_token(conn, row["id"], label, ttl_hours / 24)
    expires = conn.execute("SELECT expires_at FROM api_tokens WHERE token_hash = ?", (hash_token(token),)).fetchone()
    return {"token": token, "username": row["username"], "role": row["role"], "expires_at": expires[0]}


def revoke_by_token(conn: sqlite3.Connection, token: str) -> bool:
    cur = conn.execute(
        "UPDATE api_tokens SET revoked = 1, revoked_at = ? WHERE token_hash = ? AND revoked = 0",
        (now(), hash_token(token)),
    )
    return cur.rowcount == 1


def has_password_users(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1").fetchone() is not None
