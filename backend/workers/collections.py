"""F12.17: remove a whole collection from VAULT, and the demo archive's "removed" choice.

Deleting a collection removes its rows in one transaction, then the stored copies that no other collection still
uses. Stored copies are de-duplicated by SHA-256 across collections (`originals/ab/abcd...`), so a file uploaded
to two collections stays until both are gone. Only files inside the managed originals folder are ever touched;
the user's own files outside VAULT never are.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import stat
from dataclasses import dataclass

from backend.core.config import Settings
from backend.security.files import FileRejected, contained, original_path
from backend.storage.db import transaction

log = logging.getLogger(__name__)

DEMO_REMOVED_KEY = "demo_removed"
ACTIVE = ("queued", "running")


class CollectionBusy(Exception):
    """A job is still queued or running for the collection."""


@dataclass
class Deleted:
    collection_id: int
    name: str
    was_demo: bool
    documents: int
    copies_removed: int
    copies_kept: int


def active_job(conn: sqlite3.Connection, collection_id: int) -> int | None:
    row = conn.execute(
        "SELECT id FROM jobs WHERE collection_id = ? AND status IN (?, ?) ORDER BY id DESC LIMIT 1",
        (collection_id, *ACTIVE),
    ).fetchone()
    return row["id"] if row else None


# Child rows first; foreign-key checks are deferred to COMMIT anyway, so the order is for readability only.
_DELETES = (
    "DELETE FROM agent_events WHERE job_id IN (SELECT id FROM jobs WHERE collection_id = :c) "
    "OR document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM job_items WHERE job_id IN (SELECT id FROM jobs WHERE collection_id = :c) "
    "OR document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM redactions WHERE document_id IN (SELECT id FROM documents WHERE collection_id = :c) "
    "OR proposal_id IN (SELECT id FROM proposals WHERE collection_id = :c)",
    # The pages_ad trigger removes the search index rows.
    "DELETE FROM pages WHERE document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM extractions WHERE document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM corrections WHERE document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM screenings WHERE document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM examples WHERE document_id IN (SELECT id FROM documents WHERE collection_id = :c)",
    "DELETE FROM activity WHERE collection_id = :c",
    "DELETE FROM ask_answers WHERE collection_id = :c",
    "DELETE FROM findings WHERE collection_id = :c",
    "DELETE FROM knowledge WHERE collection_id = :c",
    "DELETE FROM jobs WHERE collection_id = :c",
    "DELETE FROM proposals WHERE collection_id = :c",
    "DELETE FROM documents WHERE collection_id = :c",
    "DELETE FROM settings_kv WHERE key LIKE :estimates",
    "DELETE FROM collections WHERE id = :c",
)


def delete_collection(conn: sqlite3.Connection, settings: Settings, collection_id: int) -> Deleted | None:
    """Remove the collection and everything VAULT made from it. None when it does not exist."""
    col = conn.execute("SELECT id, name, is_demo FROM collections WHERE id = ?", (collection_id,)).fetchone()
    if col is None:
        return None
    with transaction(conn):
        # Checked inside the write lock, so a run cannot start between the check and the delete.
        if active_job(conn, collection_id):
            raise CollectionBusy
        conn.execute("PRAGMA defer_foreign_keys = ON")
        stored = [
            r["stored_path"]
            for r in conn.execute(
                "SELECT DISTINCT stored_path FROM documents WHERE collection_id = ?", (collection_id,)
            ).fetchall()
        ]
        documents = conn.execute("SELECT COUNT(*) FROM documents WHERE collection_id = ?", (collection_id,)).fetchone()[
            0
        ]
        args = {"c": collection_id, "estimates": f"estimate:{collection_id}:%"}
        for sql in _DELETES:
            conn.execute(sql, args)
        still_used = {
            rel
            for rel in stored
            if conn.execute("SELECT 1 FROM documents WHERE stored_path = ? LIMIT 1", (rel,)).fetchone()
        }
        if col["is_demo"] and not conn.execute("SELECT 1 FROM collections WHERE is_demo = 1").fetchone():
            set_demo_removed(conn, True)
    # Files go only after the rows are gone for good; a failed commit above leaves every copy in place.
    removed = 0
    for rel in stored:
        if rel in still_used:
            continue
        if _remove_copy(settings, rel):
            removed += 1
    return Deleted(collection_id, col["name"], bool(col["is_demo"]), documents, removed, len(still_used))


def _remove_copy(settings: Settings, stored_path: str) -> bool:
    try:
        path = contained(original_path(settings.data_dir, stored_path), [settings.originals_dir])
    except FileRejected:
        log.warning("skipped a stored copy whose recorded location is not inside the originals folder")
        return False
    try:
        # Stored copies are read-only on purpose; clear the flag only on this managed copy, then remove it.
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        log.warning("a stored copy could not be removed; it stays on disk")
        return False


def demo_removed(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (DEMO_REMOVED_KEY,)).fetchone()
    return bool(row) and row["value"] == "true"


def set_demo_removed(conn: sqlite3.Connection, removed: bool) -> None:
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (DEMO_REMOVED_KEY, "true" if removed else "false"),
    )
