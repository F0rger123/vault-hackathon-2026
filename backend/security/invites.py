"""One-time invites, so a person picks their own password instead of being handed one (F09.21).

- A code is 20 random characters from Crockford's base32 (100 bits), shown in groups of four. Only its SHA-256 hash
  is stored, so a copy of the database cannot be turned into a working invite.
- An invite works once, for `INVITE_HOURS`, and an admin can withdraw it before then.
- The admin may ask for more sign-in steps (passkey, face check, key phrase). Each has to be set up by the person
  on their own device, so they are kept as "requested" and switched on the moment the person sets them up.
"""

from __future__ import annotations

import json
import secrets
import sqlite3

from backend.security.auth import hash_token
from backend.storage.db import now

INVITE_HOURS = 48
CODE_LENGTH = 20
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
EXTRA_STEPS = ("passkey", "face", "voice")
# People retype codes: read the letters that look like digits as those digits, as Crockford's base32 does.
_LOOKALIKE = str.maketrans({"O": "0", "I": "1", "L": "1"})


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def normalize(code: str) -> str | None:
    """The canonical code from what someone typed or pasted, or None if it cannot be one."""
    clean = "".join(ch for ch in code.upper() if ch.isalnum()).translate(_LOOKALIKE)
    if len(clean) != CODE_LENGTH or any(ch not in ALPHABET for ch in clean):
        return None
    return clean


def grouped(code: str) -> str:
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def requested_extras(wanted: list[str]) -> list[str]:
    """The extra steps in a fixed order, without repeats. Raises ValueError for anything else."""
    bad = [s for s in wanted if s not in EXTRA_STEPS]
    if bad:
        raise ValueError(f"unknown sign-in step: {bad[0]}")
    return [s for s in EXTRA_STEPS if s in wanted]


def create(conn: sqlite3.Connection, username: str, role: str, note: str, extras: list[str], actor: str) -> dict:
    code = new_code()
    created = now()
    cur = conn.execute(
        "INSERT INTO invites (code_hash, username, role, note, steps, created_by, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (hash_token(code), username, role, note, json.dumps(extras), actor, created, created + INVITE_HOURS * 3600),
    )
    return {**public(_by_id(conn, cur.lastrowid)), "code": grouped(code)}


def _by_id(conn: sqlite3.Connection, invite_id: int):
    return conn.execute("SELECT * FROM invites WHERE id = ?", (invite_id,)).fetchone()


def public(row) -> dict:
    """What an admin sees about an invite. Never the code or its hash."""
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "note": row["note"],
        "steps": json.loads(row["steps"]),
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
    }


_OPEN = "used_at IS NULL AND revoked_at IS NULL AND expires_at > ?"


def pending(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(f"SELECT * FROM invites WHERE {_OPEN} ORDER BY id DESC", (now(),)).fetchall()  # noqa: S608
    return [public(r) for r in rows]


def open_for_name(conn: sqlite3.Connection, username: str) -> bool:
    sql = f"SELECT 1 FROM invites WHERE username = ? AND {_OPEN}"  # noqa: S608
    return conn.execute(sql, (username, now())).fetchone() is not None


def find_open(conn: sqlite3.Connection, code: str):
    """The invite row for a code that still works, or None (unknown, used, withdrawn and expired look the same)."""
    canon = normalize(code)
    if canon is None:
        return None
    sql = f"SELECT * FROM invites WHERE code_hash = ? AND {_OPEN}"  # noqa: S608
    return conn.execute(sql, (hash_token(canon), now())).fetchone()


def revoke(conn: sqlite3.Connection, invite_id: int):
    """Withdraw an invite that still works. Returns its row, or None if there was nothing to withdraw."""
    row = _by_id(conn, invite_id)
    if not row or row["used_at"] or row["revoked_at"] or row["expires_at"] <= now():
        return None
    conn.execute("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (now(), invite_id))
    return row


def mark_used(conn: sqlite3.Connection, invite_id: int) -> bool:
    cur = conn.execute("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL", (now(), invite_id))
    return cur.rowcount == 1


def request_steps(conn: sqlite3.Connection, user_id: int, extras: list[str]) -> None:
    """Store the steps an admin asked for. Password then becomes a required step too, so the end result is
    "password, then the steps they asked for" rather than a passkey alone replacing the password."""
    set_requested(conn, user_id, extras)
    if extras:
        conn.execute("UPDATE users SET require_password = 1 WHERE id = ?", (user_id,))


def set_requested(conn: sqlite3.Connection, user_id: int, extras: list[str]) -> None:
    conn.execute("UPDATE users SET requested_steps = ? WHERE id = ?", (json.dumps(extras), user_id))


def requested(conn: sqlite3.Connection, user_id: int) -> list[str]:
    row = conn.execute("SELECT requested_steps FROM users WHERE id = ?", (user_id,)).fetchone()
    return json.loads(row["requested_steps"]) if row else []
