"""Bearer-token authentication and role-based authorization, enforced on the server.

Tokens are random 32-byte values; only their SHA-256 hash is stored.
"""

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass

from backend.storage.db import now

ROLE_PERMISSIONS: dict[str, set[str]] = {
    # F10.24: viewers may browse suggested changes in view-only mode. Deciding or deleting them stays admin-only.
    "viewer": {"documents:read", "search", "findings:read", "jobs:read", "system:read", "proposals:read"},
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


# F09.21: what each permission means, in the words the invite wizard shows an admin. Every permission needs one.
PERMISSION_LABELS: dict[str, str] = {
    "documents:read": "Open and read documents",
    "search": "Search the archive",
    "findings:read": "See findings and conflicts between documents",
    "jobs:read": "See reading jobs and their progress",
    "system:read": "See which models and settings VAULT uses",
    "documents:upload": "Add files",
    "collections:create": "Create new collections",
    "jobs:create": "Start reading documents",
    "jobs:cancel": "Stop a reading job",
    "proposals:create": "Suggest changes to records",
    "proposals:read": "See suggested changes",
    "corrections:create": "Correct what VAULT read",
    "proposals:approve": "Approve, reject or delete suggested changes and the copies VAULT wrote",
    "settings:write": "Change settings, models and whether anything may leave this computer",
    "audit:read": "Read the audit trail and the sign-in log",
    "users:manage": "Invite people, change roles and sign-in steps",
}

ROLE_SUMMARIES: dict[str, str] = {
    "viewer": "Can look, search and browse suggested changes, but cannot change anything.",
    "analyst": "Can add files, run reading jobs and suggest changes. Cannot approve them or change settings.",
    "admin": "Can do everything, including approving changes and managing people.",
}


def role_catalog() -> list[dict]:
    """Each role with the permissions it has and the ones it lacks, in plain words, least powerful first."""
    every = list(PERMISSION_LABELS)
    out = []
    for role in sorted(ROLE_PERMISSIONS, key=lambda r: len(ROLE_PERMISSIONS[r])):
        perms = ROLE_PERMISSIONS[role]
        out.append(
            {
                "role": role,
                "summary": ROLE_SUMMARIES.get(role, ""),
                "allowed": [{"id": p, "label": PERMISSION_LABELS[p]} for p in every if p in perms],
                "not_allowed": [{"id": p, "label": PERMISSION_LABELS[p]} for p in every if p not in perms],
            }
        )
    return out


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


def issue_token(conn: sqlite3.Connection, user_id: int, label: str = "", ttl_days: float | None = None) -> str:
    """Create a token. `ttl_days` of None or 0 means it never expires (demo tokens, CLI default)."""
    token = "vlt_" + secrets.token_urlsafe(32)
    created = now()
    expires = created + ttl_days * 86400 if ttl_days else None
    conn.execute(
        "INSERT INTO api_tokens (user_id, token_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, hash_token(token), label, created, expires),
    )
    return token


def revoke_token(conn: sqlite3.Connection, token_id: int) -> bool:
    """Revoke by id. Takes effect on the very next request, because every request re-checks the database."""
    cur = conn.execute(
        "UPDATE api_tokens SET revoked = 1, revoked_at = ? WHERE id = ? AND revoked = 0", (now(), token_id)
    )
    return cur.rowcount == 1


def list_tokens(conn: sqlite3.Connection) -> list[dict]:
    """Token metadata for administrators. Never includes the token or its hash."""
    rows = conn.execute(
        """SELECT t.id, u.username, u.role, t.label, t.created_at, t.expires_at, t.revoked, t.revoked_at,
                  t.last_used_at
           FROM api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.id"""
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["revoked"] = bool(d["revoked"])
        d["expired"] = bool(d["expires_at"] and d["expires_at"] <= now())
        out.append(d)
    return out


def authenticate(conn: sqlite3.Connection, token: str) -> Principal | None:
    if not token or len(token) > 200:
        return None
    t = now()
    row = conn.execute(
        """SELECT t.id AS token_id, u.id, u.username, u.role FROM api_tokens t JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ? AND t.revoked = 0 AND u.disabled = 0
             AND (t.expires_at IS NULL OR t.expires_at > ?)""",
        (hash_token(token), t),
    ).fetchone()
    if not row:
        return None
    # Coarse (once a minute) so a busy client does not turn every read into a write.
    conn.execute(
        "UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
        (t, row["token_id"], t - 60),
    )
    return Principal(user_id=row["id"], username=row["username"], role=row["role"])
