"""The sign-in log (F09.17): who signed in, when, how, and from where. It keeps failures too.

Database triggers refuse every UPDATE and DELETE, and no route or command removes a row. Each row also carries a hash
of the row before it, so an edit made behind the triggers (someone opening the database file directly) breaks the
chain and `verify` reports where. A person with full control of the file could rewrite the whole chain; for that, keep
copies of the log elsewhere.
"""

import hashlib
import sqlite3

from backend.storage.db import now, transaction

_GENESIS = "0" * 64
LOCK_REPEAT_SECONDS = 60
_FIELDS = ("ts", "username", "method", "outcome", "reason", "ip", "user_agent")


def _hash(prev: str, row: dict) -> str:
    joined = "\x1f".join(repr(row[f]) for f in _FIELDS)
    return hashlib.sha256(f"{prev}\x1f{joined}".encode()).hexdigest()


def record(
    conn: sqlite3.Connection,
    username: str,
    method: str,
    outcome: str,
    reason: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    row = {
        "ts": now(),
        "username": username[:64],
        "method": method,
        "outcome": outcome,
        "reason": reason,
        "ip": (ip or "")[:64] or None,
        "user_agent": (user_agent or "")[:200] or None,
    }
    with transaction(conn):
        last = conn.execute("SELECT row_hash FROM signin_log ORDER BY id DESC LIMIT 1").fetchone()
        digest = _hash(last["row_hash"] if last else _GENESIS, row)
        conn.execute(
            "INSERT INTO signin_log (ts, username, method, outcome, reason, ip, user_agent, row_hash) "
            "VALUES (:ts, :username, :method, :outcome, :reason, :ip, :user_agent, :row_hash)",
            {**row, "row_hash": digest},
        )


def record_locked(conn: sqlite3.Connection, username: str, method: str, ip: str | None, user_agent: str | None) -> None:
    """A locked-out account is logged once a minute, so hammering it cannot fill the disk with permanent rows."""
    recent = conn.execute(
        "SELECT 1 FROM signin_log WHERE username = ? AND reason = 'locked' AND ts > ? LIMIT 1",
        (username[:64], now() - LOCK_REPEAT_SECONDS),
    ).fetchone()
    if not recent:
        record(conn, username, method, "denied", "locked", ip, user_agent)


def entries(conn: sqlite3.Connection, limit: int = 200, username: str | None = None) -> list[dict]:
    sql, args = "SELECT id, ts, username, method, outcome, reason, ip, user_agent FROM signin_log", []
    if username:
        sql += " WHERE username = ?"
        args.append(username)
    return [dict(r) for r in conn.execute(sql + " ORDER BY id DESC LIMIT ?", [*args, limit]).fetchall()]


def verify(conn: sqlite3.Connection) -> dict:
    """Walk the whole chain. Reports the first row that does not match, or a gap left by a removed row."""
    prev = _GENESIS
    count = 0
    expected_id = None
    for r in conn.execute("SELECT * FROM signin_log ORDER BY id"):
        row = dict(r)
        if (expected_id is not None and row["id"] != expected_id) or _hash(prev, row) != row["row_hash"]:
            return {"intact": False, "entries": count, "first_bad_id": row["id"]}
        prev, expected_id, count = row["row_hash"], row["id"] + 1, count + 1
    return {"intact": True, "entries": count, "first_bad_id": None}
