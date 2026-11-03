"""F10.22: one activity feed per collection, recording what VAULT actually does to files.

Rows come from three places: database triggers (a file stored, a document read by a processing job), the Ask VAULT
helpers (which documents each helper looked at, in the order it produced), and approved reorganizations (each copy
written, with its export-relative path). The live brain draws only these rows; nothing moves without one.

Detail payloads carry ids, counts, file names, search words and export-relative paths. Never document text, quotes
or paths on disk.
"""

from __future__ import annotations

import sqlite3

from backend.storage.db import dumps, loads, now

MAX_IDS = 60
_FORBIDDEN_DETAIL_KEYS = {"text", "quote", "content", "line", "stored_path", "path", "token", "password"}


def record(
    conn: sqlite3.Connection,
    collection_id: int,
    actor: str,
    action: str,
    document_id: int | None = None,
    run: str | None = None,
    **detail,
) -> int:
    clean = {k: v for k, v in detail.items() if k not in _FORBIDDEN_DETAIL_KEYS and v is not None}
    if "document_ids" in clean:
        clean["document_ids"] = [int(d) for d in clean["document_ids"]][:MAX_IDS]
    cur = conn.execute(
        "INSERT INTO activity (collection_id, ts, actor, action, document_id, run, detail)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (collection_id, now(), actor[:60], action[:40], document_id, run, dumps(clean)),
    )
    return cur.lastrowid


def unique_ids(ids) -> list[int]:
    """Document ids in first-seen order, without repeats or blanks."""
    out: list[int] = []
    for d in ids:
        if d is not None and int(d) not in out:
            out.append(int(d))
    return out


def feed(
    conn: sqlite3.Connection, collection_id: int, after_id: int = 0, limit: int = 100, run: str | None = None
) -> dict:
    """Rows after `after_id`, oldest first. With no cursor, the newest `limit` rows (still oldest first)."""
    # A fixed query either way: the optional run filter is a bound value, never text joined into the SQL.
    base = "SELECT * FROM activity WHERE collection_id = ? AND (? IS NULL OR run = ?) AND id > ?"
    if after_id > 0:
        rows = conn.execute(base + " ORDER BY id LIMIT ?", (collection_id, run, run, after_id, limit)).fetchall()
    else:
        rows = conn.execute(base + " ORDER BY id DESC LIMIT ?", (collection_id, run, run, 0, limit)).fetchall()[::-1]
    last = conn.execute("SELECT MAX(id) FROM activity WHERE collection_id = ?", (collection_id,)).fetchone()[0]
    events = [
        {
            "id": r["id"],
            "ts": r["ts"],
            "actor": r["actor"],
            "action": r["action"],
            "document_id": r["document_id"],
            "run": r["run"],
            "detail": loads(r["detail"], {}),
        }
        for r in rows
    ]
    return {
        "events": events,
        "last_id": events[-1]["id"] if events else max(after_id, 0),
        "latest_id": last or 0,
        "now": now(),
    }
