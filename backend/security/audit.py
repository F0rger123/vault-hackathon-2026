"""Append-only audit trail. Detail payloads must never contain document text or secrets."""

import sqlite3

from backend.storage.db import dumps, now

_FORBIDDEN_DETAIL_KEYS = {"token", "api_key", "password", "text", "content"}


def record(
    conn: sqlite3.Connection,
    actor: str,
    action: str,
    outcome: str,
    target: str | None = None,
    detail: dict | None = None,
) -> None:
    clean = {k: v for k, v in (detail or {}).items() if k.lower() not in _FORBIDDEN_DETAIL_KEYS}
    conn.execute(
        "INSERT INTO audit_log (ts, actor, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)",
        (now(), actor, action, target, outcome, dumps(clean)),
    )
