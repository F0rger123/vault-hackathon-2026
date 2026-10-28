"""F05.6: worker robustness. Faults are counted correctly, jobs never hang, and a restart resumes work."""

import threading

from backend.providers import heuristic
from backend.providers.base import ProviderError
from backend.storage.db import connect
from backend.workers.jobs import JobRunner, create_process_job
from tests.conftest import auth, wait_job

API = "/api/v1"
FILES = [("files", (f"memo-{i}.txt", f"Project: Beta\nFL-{2000 + i} rated 600 psi".encode())) for i in range(4)]


def _collection(client, token):
    h = auth(token)
    cid = client.post(f"{API}/collections", json={"name": "robustness"}, headers=h).json()["id"]
    r = client.post(f"{API}/collections/{cid}/documents", files=FILES, headers=h)
    assert r.status_code == 200 and len(r.json()["accepted"]) == len(FILES)
    return cid


def _use(monkeypatch, provider_cls):
    monkeypatch.setattr("backend.workers.processing.get_provider", lambda name, s: provider_cls())


def _run(client, tokens, cid, workers=2):
    job = client.post(
        f"{API}/jobs",
        json={"collection_id": cid, "provider": "heuristic", "workers": workers},
        headers=auth(tokens["analyst"]),
    ).json()
    return wait_job(client, tokens["analyst"], job["id"], timeout=60)


def test_flaky_provider_succeeds_on_retry(client, tokens, monkeypatch):
    calls: dict[str, int] = {}
    lock = threading.Lock()

    class Flaky(heuristic.HeuristicProvider):
        def extract(self, pages, filename, *a, **k):
            with lock:
                calls[filename] = calls.get(filename, 0) + 1
                first = calls[filename] == 1
            if first:
                raise ProviderError("temporary model timeout")
            return super().extract(pages, filename, *a, **k)

    _use(monkeypatch, Flaky)
    job = _run(client, tokens, _collection(client, tokens["analyst"]))
    assert job["status"] == "completed" and job["done"] == len(FILES) and job["failed"] == 0
    assert all(n == 2 for n in calls.values()) and len(calls) == len(FILES)


def test_always_failing_provider_marks_items_failed_without_hanging(client, tokens, settings, monkeypatch):
    class Broken(heuristic.HeuristicProvider):
        def extract(self, *a, **k):
            raise ProviderError("model unavailable")

    _use(monkeypatch, Broken)
    job = _run(client, tokens, _collection(client, tokens["analyst"]))
    assert job["status"] == "failed" and job["done"] == 0 and job["failed"] == len(FILES)
    with connect(settings.db_path) as conn:
        rows = conn.execute("SELECT status, attempts, error FROM job_items WHERE job_id = ?", (job["id"],)).fetchall()
    assert {r["status"] for r in rows} == {"failed"}
    assert {r["attempts"] for r in rows} == {settings.job_max_attempts}
    # The stored reason is the provider's message, never document text.
    assert all("600 psi" not in (r["error"] or "") for r in rows)


def test_unexpected_crash_in_one_document_does_not_stop_the_job(client, tokens, monkeypatch):
    class CrashesOnOne(heuristic.HeuristicProvider):
        def extract(self, pages, filename, *a, **k):
            if filename == "memo-2.txt":
                raise RuntimeError("parser bug")
            return super().extract(pages, filename, *a, **k)

    _use(monkeypatch, CrashesOnOne)
    job = _run(client, tokens, _collection(client, tokens["analyst"]))
    assert job["status"] == "completed_with_errors"
    assert (job["done"], job["failed"]) == (len(FILES) - 1, 1)


def test_restart_resumes_unfinished_job(client, tokens, settings):
    cid = _collection(client, tokens["analyst"])
    with connect(settings.db_path) as conn:
        job_id = create_process_job(conn, cid, "heuristic", 2, None)
        # Simulate a crash mid-run: the job was running and one item was in flight when the process died.
        conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job_id,))
        conn.execute(
            "UPDATE job_items SET status = 'running' WHERE id = (SELECT MIN(id) FROM job_items WHERE job_id = ?)",
            (job_id,),
        )
    runner = JobRunner(settings)
    assert runner.resume_unfinished() == [job_id]
    runner.wait(job_id, timeout=30)
    job = client.get(f"{API}/jobs/{job_id}", headers=auth(tokens["analyst"])).json()
    assert job["status"] == "completed" and job["done"] == len(FILES) and job["failed"] == 0


def test_low_memory_holds_documents_back_then_continues(client, tokens, settings, monkeypatch):
    """With RAM below the floor, each slot waits (recording why) and still finishes the job."""
    settings.min_free_memory_mb = 10**9  # more than any machine has, so every check is "low"
    settings.memory_wait_s = 0.6
    job = _run(client, tokens, _collection(client, tokens["analyst"]))
    assert job["status"] == "completed" and job["done"] == len(FILES)
    events = client.get(f"{API}/jobs/{job['id']}/events?limit=500", headers=auth(tokens["analyst"])).json()
    actions = [e["action"] for e in (events["events"] if isinstance(events, dict) else events)]
    assert actions.count("memory.wait") == len(FILES) and actions.count("memory.low") == len(FILES)
