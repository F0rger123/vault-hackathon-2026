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


def create_process_job(
    conn,
    collection_id: int,
    provider: str,
    workers: int,
    user_id: int | None,
    document_ids: list[int] | None = None,
    lanes: list[dict] | None = None,
    escalate_provider: str | None = None,
) -> int:
    if document_ids is None:
        rows = conn.execute("SELECT id FROM documents WHERE collection_id = ? ORDER BY id", (collection_id,)).fetchall()
        document_ids = [r["id"] for r in rows]
    lanes = lanes or [{"provider": provider, "concurrency": workers}]
    params = {"provider": provider, "lanes": lanes, "escalate_provider": escalate_provider}
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
