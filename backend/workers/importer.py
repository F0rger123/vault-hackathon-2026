"""Path imports for large server-side collections (F02.7).

An administrator points VAULT at a directory inside `VAULT_IMPORT_ROOTS`. Small folders can be imported in
the request; big ones run as a background job of kind "import" with live done/failed counts, cancellation
and resume. Every file still goes through the same checks as an upload, and nothing outside the chosen
directory is read: each path is re-checked with `contained`, and symlinks are skipped.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from backend.core.config import Settings
from backend.ingest.service import ingest_bytes
from backend.security.files import FileRejected, contained
from backend.storage.db import connect, dumps, loads, now

MAX_FILES = 20000
MAX_REJECTIONS_KEPT = 200


def candidate_files(base: Path) -> Iterator[Path]:
    """Regular files under `base`, in a stable order, never following symlinks out of it."""
    for path in sorted(base.rglob("*"))[:MAX_FILES]:
        if path.is_file() and not path.is_symlink():
            yield path


def import_one(conn: sqlite3.Connection, settings: Settings, collection_id: int, base: Path, path: Path) -> None:
    """Raise FileRejected with a readable reason, or ingest the file.

    The file is opened once (without following a link where the OS allows it) and every check runs on
    that open handle, so swapping the file for a link between the check and the read gains nothing.
    """
    real = contained(path, [base])
    limit = settings.max_upload_mb * 1024 * 1024
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(real, flags)
    try:
        st = os.fstat(fd)
        if not os.path.samestat(st, os.stat(contained(Path(real), [base]))):
            raise FileRejected("file changed while it was being imported")
        if st.st_size > limit:
            raise FileRejected("file exceeds upload limit")
        with os.fdopen(fd, "rb") as f:
            fd = -1
            data = f.read(limit + 1)
    finally:
        if fd != -1:
            os.close(fd)
    if len(data) > limit:
        raise FileRejected("file exceeds upload limit")
    ingest_bytes(conn, settings, collection_id, path.name, data)


def create_import_job(conn: sqlite3.Connection, collection_id: int, base: Path, user_id: int | None) -> int:
    total = sum(1 for _ in candidate_files(base))
    cur = conn.execute(
        """INSERT INTO jobs (kind, status, collection_id, params, total, workers, created_by, created_at)
           VALUES ('import', 'queued', ?, ?, ?, 1, ?, ?)""",
        (collection_id, dumps({"path": str(base), "rejected": []}), total, user_id, now()),
    )
    return cur.lastrowid


def run_import(settings: Settings, job_id: int) -> None:
    """Import every file for an import job. Safe to re-run after a restart: files already stored are
    de-duplicated by SHA-256, so the counts simply catch up."""
    with connect(settings.db_path) as conn:
        job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not job or job["status"] not in ("queued", "running"):
            return
        params = loads(job["params"], {})
        roots = settings.import_root_paths
        conn.execute(
            "UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?), done = 0, failed = 0 "
            "WHERE id = ?",
            (now(), job_id),
        )
        try:
            # The roots may have changed since the job was created; check again before reading anything.
            base = contained(Path(params["path"]), roots) if roots else None
        except FileRejected:
            base = None
        if base is None:
            conn.execute(
                "UPDATE jobs SET status = 'failed', error = 'path is no longer inside VAULT_IMPORT_ROOTS', "
                "finished_at = ? WHERE id = ?",
                (now(), job_id),
            )
            return
        rejected: list[dict] = []
        done = failed = 0
        for i, path in enumerate(candidate_files(base)):
            if i % 25 == 0 and conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()[0]:
                break
            try:
                import_one(conn, settings, job["collection_id"], base, path)
                done += 1
            except FileRejected as exc:
                failed += 1
                if len(rejected) < MAX_REJECTIONS_KEPT:
                    rejected.append({"filename": path.name, "reason": str(exc)})
            except OSError:
                # Unreadable file (permissions, vanished mid-import). Report it without the path.
                failed += 1
                if len(rejected) < MAX_REJECTIONS_KEPT:
                    rejected.append({"filename": path.name, "reason": "file could not be read"})
            conn.execute("UPDATE jobs SET done = ?, failed = ? WHERE id = ?", (done, failed, job_id))
        cancelled = conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()[0]
        status = "cancelled" if cancelled else "completed_with_errors" if failed else "completed"
        params["rejected"] = rejected
        conn.execute(
            "UPDATE jobs SET status = ?, params = ?, finished_at = ? WHERE id = ?",
            (status, dumps(params), now(), job_id),
        )
