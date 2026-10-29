"""Signing in without handling raw API tokens (F10.11, hardened in F09.11).

- Username and password: passwords are stored only as scrypt hashes. A successful sign-in issues an
  ordinary bearer token that expires after `session_ttl_hours`. Each username gets at most
  `MAX_ATTEMPTS` tries a minute. A try counts the moment it starts, so parallel requests cannot squeeze
  past the limit. Unknown usernames share one bucket, so random names cannot fill memory.
- Every attempt costs one scrypt run, including unknown users and users without a password, so response
  time does not reveal which accounts exist. At most `MAX_CONCURRENT` attempts run at once.
- Demo sign-in: one click as the demo admin, analyst or viewer, only when the server runs with
  `VAULT_DEMO_LOGIN=true`. That is meant for a laptop showing fictional data, never a shared server.
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
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 60
MAX_CONCURRENT = 4
DEMO_USERS = ("admin", "analyst", "viewer")
UNKNOWN = "\x00unknown"  # one shared bucket for usernames that do not exist

_attempts: dict[str, list[float]] = {}
_lock = threading.Lock()
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)


class LoginLocked(Exception):
    def __init__(self, wait: float):
        self.wait = wait


class LoginBusy(Exception):
    pass


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


# Verified against when there is no real hash, so every attempt costs the same.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


def verify_password(password: str, stored: str | None) -> bool:
    try:
        scheme, n, r, p, salt, digest = (stored or "").split("$")
        if scheme != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def set_password(conn: sqlite3.Connection, username: str, password: str) -> int:
    """Set a password and end that user's existing sign-in sessions. Returns how many sessions were ended."""
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"password must be at least {MIN_PASSWORD} characters")
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise LookupError(f"no user named {username!r}")
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"]))
    cur = conn.execute(
        "UPDATE api_tokens SET revoked = 1, revoked_at = ? "
        "WHERE user_id = ? AND revoked = 0 AND label IN ('password-login', 'demo-login')",
        (now(), row["id"]),
    )
    return cur.rowcount


def _start_attempt(key: str) -> None:
    """Count an attempt before checking it, atomically, or raise LoginLocked."""
    with _lock:
        t = time.monotonic()
        recent = [x for x in _attempts.get(key, []) if t - x < WINDOW_SECONDS]
        if len(recent) >= MAX_ATTEMPTS:
            _attempts[key] = recent
            raise LoginLocked(WINDOW_SECONDS - (t - recent[0]))
        recent.append(t)
        _attempts[key] = recent
        # Keys are only existing usernames plus one shared bucket, so this stays small; prune anyway.
        if len(_attempts) > 1000:
            for k in [k for k, v in _attempts.items() if not v or t - v[-1] >= WINDOW_SECONDS]:
                _attempts.pop(k, None)


def clear_attempts(username: str | None = None) -> None:
    with _lock:
        if username is None:
            _attempts.clear()
        else:
            _attempts.pop(username, None)


def password_login(conn: sqlite3.Connection, username: str, password: str, ttl_hours: float) -> dict | None:
    """A new session token, or None for a wrong username or password (deliberately the same answer).

    Raises LoginLocked when the username used up its attempts, LoginBusy when too many run at once.
    """
    row = conn.execute("SELECT id, username, role, password_hash FROM users WHERE username = ?", (username,)).fetchone()
    _start_attempt(row["username"] if row else UNKNOWN)
    if not _slots.acquire(timeout=5):
        raise LoginBusy()
    try:
        stored = row["password_hash"] if row and row["password_hash"] else _DUMMY_HASH
        ok = verify_password(password, stored) and bool(row and row["password_hash"])
    finally:
        _slots.release()
    if not ok:
        return None
    clear_attempts(row["username"])
    return _session(conn, row, "password-login", ttl_hours)


def known_user(conn: sqlite3.Connection, username: str) -> bool:
    return conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone() is not None


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
