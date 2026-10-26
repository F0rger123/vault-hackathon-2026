"""Durable, bounded-concurrency job runner.

Job and item states live in SQLite, so a restart resumes unfinished work. Each job gets a
coordinator thread that feeds a ThreadPoolExecutor of `workers` threads. Cancellation is
cooperative: items not yet started are skipped once cancel is requested.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from backend.core.config import Settings
from backend.core.runtime import effective_settings
from backend.indexing.findings import analyse_collection
from backend.providers.base import ProviderError
from backend.storage.db import connect, dumps, loads, now
from backend.workers.processing import current_policy, make_provider, process_document

log = logging.getLogger("vault.jobs")

TERMINAL = {"completed", "failed", "cancelled", "completed_with_errors"}


def create_process_job(
    conn, collection_id: int, provider: str, workers: int, user_id: int | None, document_ids: list[int] | None = None
) -> int:
    if document_ids is None:
        rows = conn.execute("SELECT id FROM documents WHERE collection_id = ? ORDER BY id", (collection_id,)).fetchall()
        document_ids = [r["id"] for r in rows]
    cur = conn.execute(
        """INSERT INTO jobs (kind, status, collection_id, params, total, workers, created_by, created_at)
           VALUES ('process', 'queued', ?, ?, ?, ?, ?, ?)""",
        (collection_id, dumps({"provider": provider}), len(document_ids), workers, user_id, now()),
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
            t = threading.Thread(target=self._run, args=(job_id,), name=f"job-{job_id}", daemon=True)
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

    def _run(self, job_id: int) -> None:
        db = self.settings.db_path
        with connect(db) as conn:
            job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not job or job["status"] in TERMINAL:
                return
            params = loads(job["params"], {})
            try:
                provider = make_provider(effective_settings(conn, self.settings), params.get("provider"))
            except ProviderError as exc:
                conn.execute(
                    "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
                    (str(exc), now(), job_id),
                )
                return
            policy = current_policy(conn)
            conn.execute(
                "UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?", (now(), job_id)
            )
            items = conn.execute(
                "SELECT id, document_id FROM job_items WHERE job_id = ? AND status = 'pending' ORDER BY id",
                (job_id,),
            ).fetchall()

        def cancelled() -> bool:
            with connect(db) as c:
                return bool(c.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()[0])

        def work(item_id: int, document_id: int) -> None:
            with connect(db) as c:
                if cancelled():
                    c.execute("UPDATE job_items SET status = 'cancelled' WHERE id = ?", (item_id,))
                    return
                c.execute("UPDATE job_items SET status = 'running' WHERE id = ?", (item_id,))
                last_error = ""
                for attempt in range(1, self.settings.job_max_attempts + 1):
                    c.execute("UPDATE job_items SET attempts = ? WHERE id = ?", (attempt, item_id))
                    try:
                        started = time.perf_counter()
                        process_document(c, provider, document_id, policy)
                        ms = int((time.perf_counter() - started) * 1000)
                        c.execute(
                            "UPDATE job_items SET status = 'done', error = NULL, duration_ms = ? WHERE id = ?",
                            (ms, item_id),
                        )
                        c.execute("UPDATE jobs SET done = done + 1 WHERE id = ?", (job_id,))
                        return
                    except ProviderError as exc:
                        last_error = str(exc)
                        if attempt < self.settings.job_max_attempts and not cancelled():
                            time.sleep(min(2**attempt, 10))
                    except Exception as exc:  # unexpected: do not retry, record type only
                        log.exception("item %s failed", item_id)
                        last_error = f"internal error ({type(exc).__name__})"
                        break
                c.execute("UPDATE job_items SET status = 'failed', error = ? WHERE id = ?", (last_error, item_id))
                c.execute("UPDATE documents SET status = 'error', error = ? WHERE id = ?", (last_error, document_id))
                c.execute("UPDATE jobs SET failed = failed + 1 WHERE id = ?", (job_id,))

        workers = max(1, min(job["workers"], 32))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"job{job_id}") as pool:
            futures = [pool.submit(work, it["id"], it["document_id"]) for it in items]
            for f in futures:
                f.result()

        with connect(db) as conn:
            j = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if j["cancel_requested"]:
                status = "cancelled"
            elif j["failed"] and not j["done"]:
                status = "failed"
            elif j["failed"]:
                status = "completed_with_errors"
            else:
                status = "completed"
            if j["done"]:
                analyse_collection(conn, j["collection_id"])
            conn.execute("UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?", (status, now(), job_id))
