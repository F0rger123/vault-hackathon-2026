"""Record a human correction, optionally publishing a new policy version with a rule (F07.1, F07.2)."""

from __future__ import annotations

import sqlite3

from backend.storage.db import dumps, loads, now, transaction

CORRECTABLE = ("doc_type", "project")
_LATEST = {
    "doc_type": "SELECT doc_type AS v FROM extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1",
    "project": "SELECT project AS v FROM extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1",
}


def record_correction(
    conn: sqlite3.Connection,
    user_id: int | None,
    document_id: int,
    field: str,
    value: str,
    when_contains: str | None = None,
    note: str = "",
) -> dict:
    if field not in CORRECTABLE:
        raise ValueError(f"field must be one of {CORRECTABLE}")
    # One fixed query per field, so no SQL is ever built from input.
    x = conn.execute(_LATEST[field], (document_id,)).fetchone()
    old = x["v"] if x else None
    conn.execute(
        "INSERT INTO corrections (document_id, field, old_value, new_value, note, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (document_id, field, old, value, note, user_id, now()),
    )
    version = None
    if when_contains:
        # Read the latest version and write the next one in a single write transaction, so two
        # corrections at the same moment cannot both claim the same version number.
        with transaction(conn):
            row = conn.execute("SELECT version, rules FROM policies ORDER BY version DESC LIMIT 1").fetchone()
            rules = loads(row["rules"], []) if row else []
            rules.append({"when_contains": when_contains, "field": field, "value": value})
            version = (row["version"] if row else 1) + 1
            conn.execute(
                "INSERT INTO policies (version, rules, created_by, created_at) VALUES (?, ?, ?, ?)",
                (version, dumps(rules), user_id, now()),
            )
    return {"document_id": document_id, "field": field, "old_value": old, "new_value": value, "policy_version": version}
