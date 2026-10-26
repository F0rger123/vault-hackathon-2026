"""Bearer-token authentication and role-based authorization, enforced on the server.

Tokens are random 32-byte values; only their SHA-256 hash is stored.
"""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass

from backend.storage.db import now

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "viewer": {"documents:read", "search", "findings:read", "jobs:read", "system:read"},
    "analyst": {
        "documents:read",
        "search",
        "findings:read",
        "jobs:read",
        "system:read",
        "documents:upload",
        "collections:create",
        "jobs:create",
        "jobs:cancel",
        "proposals:create",
        "proposals:read",
        "corrections:create",
    },
    "admin": {
        "documents:read",
        "search",
        "findings:read",
        "jobs:read",
        "system:read",
        "documents:upload",
        "collections:create",
        "jobs:create",
        "jobs:cancel",
        "proposals:create",
        "proposals:read",
        "corrections:create",
        "proposals:approve",
        "settings:write",
        "audit:read",
        "users:manage",
    },
}


@dataclass(frozen=True)
class Principal:
    user_id: int
    username: str
    role: str

    def can(self, permission: str) -> bool:
        return permission in ROLE_PERMISSIONS.get(self.role, set())


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_user(conn: sqlite3.Connection, username: str, role: str) -> int:
    if role not in ROLE_PERMISSIONS:
        raise ValueError(f"unknown role: {role}")
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO users (username, role, created_at) VALUES (?, ?, ?)", (username, role, now()))
    return cur.lastrowid


def issue_token(conn: sqlite3.Connection, user_id: int, label: str = "") -> str:
    token = "vlt_" + secrets.token_urlsafe(32)
    conn.execute(
        "INSERT INTO api_tokens (user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
        (user_id, hash_token(token), label, now()),
    )
    return token


def authenticate(conn: sqlite3.Connection, token: str) -> Principal | None:
    if not token or len(token) > 200:
        return None
    row = conn.execute(
        """SELECT u.id, u.username, u.role FROM api_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ? AND t.revoked = 0""",
        (hash_token(token),),
    ).fetchone()
    if not row:
        return None
    return Principal(user_id=row["id"], username=row["username"], role=row["role"])
