"""Coordinator agent: plans a run, screens documents, delegates them to model lanes, and reviews results.

Pipeline for every document:

    coordinator ──► security agent ──► extractor lane(s) ──► review agent ──► (escalation lane) ──► findings

- A *lane* is one model provider with N concurrent slots (for example: local Llama with 4 slots, or the
  Meta Model API with 24 slots). Lanes pull work from shared queues, so faster lanes take more documents.
- The security agent pins documents with sensitivity markings or personal data to local lanes. A remote
  lane can never receive them, even when remote inference is enabled.
- The review agent accepts an extraction, escalates it once to a stronger lane, or flags it for a person.

Nothing a model returns is executed; agents exchange only validated data through the database.
"""

import logging
import queue
import sqlite3
import threading
import time
from dataclasses import dataclass

from backend.agents import review_agent, security_agent
from backend.core.config import Settings
from backend.core.runtime import effective_settings
from backend.indexing.findings import analyse_collection
from backend.providers.base import Provider, ProviderError, ProviderInfo
from backend.storage.db import connect, dumps, loads, now
from backend.workers.processing import current_policy, load_examples, load_pages, make_provider, process_document

log = logging.getLogger("vault.orchestrator")
TERMINAL = {"completed", "failed", "cancelled", "completed_with_errors"}


@dataclass
class Lane:
    name: str
    provider: Provider
    info: ProviderInfo
    concurrency: int

    @property
    def remote(self) -> bool:
        return self.info.locality == "remote"


def lanes_from_params(params: dict, workers: int) -> list[dict]:
    if params.get("lanes"):
        return params["lanes"]
    return [{"provider": params.get("provider", "heuristic"), "concurrency": workers}]


class Orchestrator:
    def __init__(self, settings: Settings, job_id: int):
        self.settings = settings
        self.job_id = job_id
        self.db = settings.db_path
        self._cancel_checked = 0.0
        self._cancelled = False
        self._lock = threading.Lock()

    # ---------- helpers ----------

    def event(self, conn, agent: str, action: str, outcome: str, document_id: int | None = None, **detail) -> None:
        conn.execute(
            "INSERT INTO agent_events (job_id, ts, agent, document_id, action, outcome, detail) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (self.job_id, now(), agent, document_id, action, outcome, dumps(detail)),
        )

    def cancelled(self) -> bool:
        with self._lock:
            if time.monotonic() - self._cancel_checked > 0.5:
                with connect(self.db) as c:
                    self._cancelled = bool(
                        c.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (self.job_id,)).fetchone()[0]
                    )
                self._cancel_checked = time.monotonic()
            return self._cancelled

    def _build_lane(self, conn, eff: Settings, spec: dict, label: str) -> Lane | None:
        try:
            provider = make_provider(eff, spec["provider"])
            info = provider.info()
        except ProviderError as exc:
            self.event(conn, "coordinator", "lane.unavailable", "error", lane=label, reason=str(exc))
            return None
        if not info.available:
            self.event(conn, "coordinator", "lane.unavailable", "error", lane=label, reason=info.detail)
            return None
        if info.locality == "remote" and not eff.allow_remote_inference:
            self.event(conn, "coordinator", "lane.blocked", "denied", lane=label, reason="remote inference disabled")
            return None
        return Lane(label, provider, info, max(1, min(int(spec.get("concurrency", 1)), 64)))

    # ---------- main ----------

    def run(self) -> None:
        with connect(self.db) as conn:
            job = conn.execute("SELECT * FROM jobs WHERE id = ?", (self.job_id,)).fetchone()
            if not job or job["status"] in TERMINAL:
                return
            params = loads(job["params"], {})
            eff = effective_settings(conn, self.settings)
            lanes = []
            for i, spec in enumerate(lanes_from_params(params, job["workers"])):
                lane = self._build_lane(conn, eff, spec, f"{spec['provider']}#{i + 1}")
                if lane:
                    lanes.append(lane)
            escalation = None
            if params.get("escalate_provider"):
                escalation = self._build_lane(
                    conn,
                    eff,
                    {"provider": params["escalate_provider"], "concurrency": 1},
                    f"{params['escalate_provider']}#escalation",
                )
            if not lanes:
                conn.execute(
                    "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
                    ("no usable model lane", now(), self.job_id),
                )
                return
            self.event(
                conn,
                "coordinator",
                "plan",
                "allowed",
                lanes=[
                    {"lane": ln.name, "model": ln.info.model, "locality": ln.info.locality, "slots": ln.concurrency}
                    for ln in lanes
                ],
                escalation=escalation.name if escalation else None,
            )
            conn.execute(
                "UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?) WHERE id = ?",
                (now(), self.job_id),
            )
            items = conn.execute(
                "SELECT ji.id, ji.document_id, d.media_type, d.filename FROM job_items ji "
                "JOIN documents d ON d.id = ji.document_id "
                "WHERE ji.job_id = ? AND ji.status = 'pending' ORDER BY ji.id",
                (self.job_id,),
            ).fetchall()
            policy = current_policy(conn)
            examples = load_examples(conn)

            # Security agent screens everything before any model sees it.
            local_q: queue.Queue = queue.Queue()
            any_q: queue.Queue = queue.Queue()
            has_local = any(not ln.remote for ln in lanes)
            counts = {"restricted": 0, "internal": 0, "injection": 0}
            for it in items:
                s = security_agent.screen(it["document_id"], load_pages(conn, it["document_id"]))
                security_agent.save(conn, s)
                if s.sensitivity != "none":
                    counts[s.sensitivity] += 1
                if s.injection:
                    counts["injection"] += 1
                    self.event(
                        conn,
                        "security",
                        "injection.flagged",
                        "allowed",
                        it["document_id"],
                        filename=it["filename"],
                        matches=len(s.injection),
                    )
                if s.route == "local_only" or s.injection:
                    if s.route == "local_only":
                        self.event(
                            conn,
                            "security",
                            "route.local_only",
                            "allowed",
                            it["document_id"],
                            filename=it["filename"],
                            markings=s.markings,
                            pii=s.pii,
                        )
                    if not has_local:
                        why = (
                            "marked or personal-data document cannot go to a remote model"
                            if s.route == "local_only"
                            else "document with instruction-like text is kept off remote models"
                        )
                        self._fail_item(conn, it["id"], it["document_id"], f"blocked: {why}", it["filename"])
                        self.event(conn, "security", "route.blocked", "denied", it["document_id"], reason=why)
                        continue
                    local_q.put(dict(it))
                else:
                    any_q.put(dict(it))
            self.event(conn, "security", "screening.summary", "allowed", screened=len(items), **counts)

        def worker(lane: Lane, slot: int) -> None:
            with connect(self.db) as c:
                while not self.cancelled():
                    try:
                        it = (any_q if lane.remote else local_q).get_nowait()
                    except queue.Empty:
                        if lane.remote:
                            return
                        try:
                            it = any_q.get_nowait()
                        except queue.Empty:
                            return
                    it["slot"] = slot
                    self._process_safely(c, lane, escalation, it, policy, examples)

        threads = [
            threading.Thread(target=worker, args=(ln, i + 1), name=f"{ln.name}-{i}", daemon=True)
            for ln in lanes
            for i in range(ln.concurrency)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        with connect(self.db) as conn:
            if self.cancelled():
                conn.execute(
                    "UPDATE job_items SET status = 'cancelled' WHERE job_id = ? AND status = 'pending'", (self.job_id,)
                )
            # Reconcile: every item must end in a terminal state, so the job totals always add up.
            lost = conn.execute(
                "UPDATE job_items SET status = 'failed', error = 'not processed' "
                "WHERE job_id = ? AND status IN ('pending', 'running')",
                (self.job_id,),
            ).rowcount
            if lost:
                conn.execute("UPDATE jobs SET failed = failed + ? WHERE id = ?", (lost, self.job_id))
                self.event(conn, "coordinator", "reconcile", "error", lost=lost)
            j = conn.execute("SELECT * FROM jobs WHERE id = ?", (self.job_id,)).fetchone()
            if j["cancel_requested"]:
                status = "cancelled"
            elif j["failed"] and not j["done"]:
                status = "failed"
            elif j["failed"]:
                status = "completed_with_errors"
            else:
                status = "completed"
            if j["done"]:
                n = analyse_collection(conn, j["collection_id"])
                self.event(conn, "reviewer", "findings.analyse", "allowed", findings=n)
            self.event(conn, "coordinator", "finish", "allowed", status=status, done=j["done"], failed=j["failed"])
            conn.execute("UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?", (status, now(), self.job_id))

    def _process_safely(self, c, lane: Lane, escalation: Lane | None, it: dict, policy, examples) -> None:
        """Run one item; retry when SQLite is momentarily locked; never let an item disappear."""
        for attempt in range(1, 6):
            try:
                self._process(c, lane, escalation, it, policy, examples)
                return
            except sqlite3.OperationalError as exc:
                if "locked" not in str(exc) or attempt == 5:
                    break
                time.sleep(0.05 * 2**attempt)
            except Exception:
                break
        log.error("item %s could not be recorded after retries", it["id"])
        for _ in range(10):  # the failure itself must be recorded, or job counts would be wrong
            try:
                self._fail_item(c, it["id"], it["document_id"], "internal error (storage busy)", it.get("filename"))
                return
            except sqlite3.OperationalError:
                time.sleep(0.2)

    def _fail_item(self, c, item_id: int, document_id: int, error: str, filename: str | None = None) -> None:
        c.execute("UPDATE job_items SET status = 'failed', error = ? WHERE id = ?", (error, item_id))
        self.event(c, "coordinator", "item.failed", "error", document_id, filename=filename, reason=error)
        c.execute("UPDATE documents SET status = 'error', error = ? WHERE id = ?", (error, document_id))
        c.execute("UPDATE jobs SET failed = failed + 1 WHERE id = ?", (self.job_id,))

    def _extract(self, c, lane: Lane, it: dict, policy, examples) -> dict:
        last = ""
        for attempt in range(1, self.settings.job_max_attempts + 1):
            c.execute("UPDATE job_items SET attempts = ? WHERE id = ?", (attempt, it["id"]))
            try:
                return process_document(c, lane.provider, it["document_id"], policy, lane.info, examples, lane.name)
            except ProviderError as exc:
                last = str(exc)
                self.event(
                    c,
                    f"extractor:{lane.name}",
                    "extract.retry",
                    "error",
                    it["document_id"],
                    attempt=attempt,
                    reason=last,
                )
                if attempt < self.settings.job_max_attempts and not self.cancelled():
                    time.sleep(min(2**attempt, 10))
        raise ProviderError(last)

    def _process(self, c, lane: Lane, escalation: Lane | None, it: dict, policy, examples) -> None:
        c.execute("UPDATE job_items SET status = 'running' WHERE id = ?", (it["id"],))
        started = time.perf_counter()
        try:
            result = self._extract(c, lane, it, policy, examples)
            self.event(
                c,
                f"extractor:{lane.name}",
                "extract",
                "allowed",
                it["document_id"],
                ms=result["duration_ms"],
                doc_type=result["doc_type"],
                examples=result["examples_used"],
                slot=it.get("slot"),
                filename=it.get("filename"),
            )
            rev = review_agent.review(result, result["injection_flags"], it["media_type"], escalated=False)
            route = c.execute("SELECT route FROM screenings WHERE document_id = ?", (it["document_id"],)).fetchone()
            local_only = bool(route and route["route"] == "local_only")
            if rev.decision == review_agent.ESCALATE and escalation and not (escalation.remote and local_only):
                self.event(
                    c, "reviewer", "escalate", "allowed", it["document_id"], to=escalation.name, reasons=rev.reasons
                )
                result = self._extract(c, escalation, it, policy, examples)
                rev = review_agent.review(result, result["injection_flags"], it["media_type"], escalated=True)
            elif rev.decision == review_agent.ESCALATE:
                rev = review_agent.Review(review_agent.HUMAN, rev.reasons)
            c.execute("UPDATE extractions SET review_status = ? WHERE id = ?", (rev.decision, result["extraction_id"]))
            self.event(
                c,
                "reviewer",
                "review",
                "allowed" if rev.decision == review_agent.ACCEPT else "error",
                it["document_id"],
                decision=rev.decision,
                reasons=rev.reasons,
            )
            ms = int((time.perf_counter() - started) * 1000)
            c.execute(
                "UPDATE job_items SET status = 'done', error = NULL, duration_ms = ? WHERE id = ?", (ms, it["id"])
            )
            c.execute("UPDATE jobs SET done = done + 1 WHERE id = ?", (self.job_id,))
        except ProviderError as exc:
            self._fail_item(c, it["id"], it["document_id"], str(exc), it.get("filename"))
        except Exception as exc:  # unexpected: record the type only, never document content
            log.exception("item %s failed", it["id"])
            self._fail_item(
                c, it["id"], it["document_id"], f"internal error ({type(exc).__name__})", it.get("filename")
            )
