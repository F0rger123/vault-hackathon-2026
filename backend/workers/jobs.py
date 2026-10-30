"""Durable job records and the runner that hands each job to the coordinator agent.

Job and item states live in SQLite, so a restart resumes unfinished work. Each job runs in its own
coordinator thread (see backend/agents/orchestrator.py), which fans documents out to model lanes.
"""

import threading

from backend.agents.orchestrator import TERMINAL, Orchestrator
from backend.core.config import Settings
from backend.storage.db import connect, dumps, now
from backend.workers.importer import run_import

__all__ = ["TERMINAL", "JobRunner", "create_process_job"]


def documents_to_read(conn, collection_id: int, readers: set[tuple[str, str]]) -> tuple[list[int], int]:
    """Documents that need reading, and how many can be skipped (F05.10).

    A document is skipped only when its latest reading came from one of the chosen models and is newer than
    anything that would change the result: a new rule version, or a meaning, instruction or labelled example
    taught in this collection. Anything else (new files, failed readings, a different model) is read again.
    """
    changed = (
        conn.execute(
            """SELECT MAX(t) FROM (
             SELECT MAX(created_at) AS t FROM policies
             UNION ALL SELECT MAX(COALESCE(retired_at, created_at)) FROM knowledge WHERE collection_id = ?
             UNION ALL SELECT MAX(e.created_at) FROM examples e JOIN documents d ON d.id = e.document_id
                       WHERE d.collection_id = ?)""",
            (collection_id, collection_id),
        ).fetchone()[0]
        or 0
    )
    rows = conn.execute(
        """SELECT d.id, d.status, x.provider, x.model, x.created_at
           FROM documents d LEFT JOIN extractions x ON x.id = (SELECT MAX(id) FROM extractions WHERE document_id = d.id)
           WHERE d.collection_id = ? ORDER BY d.id""",
        (collection_id,),
    ).fetchall()
    todo = [
        r["id"]
        for r in rows
        if not (
            r["status"] == "processed" and (r["provider"], r["model"]) in readers and (r["created_at"] or 0) > changed
        )
    ]
    return todo, len(rows) - len(todo)


def create_process_job(
    conn,
    collection_id: int,
    provider: str,
    workers: int,
    user_id: int | None,
    document_ids: list[int] | None = None,
    lanes: list[dict] | None = None,
    escalate_provider: str | None = None,
    skipped: int = 0,
) -> int:
    if document_ids is None:
        rows = conn.execute(
            "SELECT id FROM documents WHERE collection_id = ? AND status != 'quarantined' ORDER BY id", (collection_id,)
        ).fetchall()
        document_ids = [r["id"] for r in rows]
    lanes = lanes or [{"provider": provider, "concurrency": workers}]
    params = {
        "provider": provider,
        "lanes": lanes,
        "escalate_provider": escalate_provider,
        "skipped_already_read": skipped,
    }
    cur = conn.execute(
        """INSERT INTO jobs (kind, status, collection_id, params, total, workers, created_by, created_at)
           VALUES ('process', 'queued', ?, ?, ?, ?, ?, ?)""",
        (collection_id, dumps(params), len(document_ids), sum(ln["concurrency"] for ln in lanes), user_id, now()),
    )
    job_id = cur.lastrowid
    conn.executemany("INSERT INTO job_items (job_id, document_id) VALUES (?, ?)", [(job_id, d) for d in document_ids])
    return job_id


class JobRunner:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._threads: dict[int, threading.Thread] = {}
        self._lock = threading.Lock()

    def start(self, job_id: int) -> None:
        with self._lock:
            t = self._threads.get(job_id)
            if t and t.is_alive():
                return
            with connect(self.settings.db_path) as conn:
                row = conn.execute("SELECT kind FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row and row["kind"] == "import":
                target = lambda: run_import(self.settings, job_id)  # noqa: E731
            else:
                target = Orchestrator(self.settings, job_id).run
            t = threading.Thread(target=target, name=f"job-{job_id}", daemon=True)
            self._threads[job_id] = t
            t.start()

    def resume_unfinished(self) -> list[int]:
        with connect(self.settings.db_path) as conn:
            conn.execute("UPDATE job_items SET status = 'pending' WHERE status = 'running'")
            rows = conn.execute("SELECT id FROM jobs WHERE status IN ('queued', 'running')").fetchall()
        ids = [r["id"] for r in rows]
        for job_id in ids:
            self.start(job_id)
        return ids

    def wait(self, job_id: int, timeout: float | None = None) -> None:
        t = self._threads.get(job_id)
        if t:
            t.join(timeout)
