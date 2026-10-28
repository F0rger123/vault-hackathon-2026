"""F03.5: comparing a stored runtime estimate with the real job."""

import sqlite3

from backend.core.estimates import compare, record_estimate
from backend.storage.db import MIGRATIONS


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    for sql in MIGRATIONS:
        conn.executescript(sql)
    return conn


def _job(**kw):
    job = {
        "status": "completed",
        "collection_id": 1,
        "params": {"lanes": [{"provider": "ollama", "concurrency": 2}]},
        "started_at": 1000.0,
        "finished_at": 1300.0,
        "done": 50,
        "failed": 0,
        "workers": 2,
    }
    job.update(kw)
    return job


EST = {"documents": 100, "workers": 2, "est_seconds_low": 400.0, "est_seconds_high": 800.0, "sample_size": 3}


def test_estimate_is_scaled_to_documents_processed(monkeypatch):
    conn = _conn()
    monkeypatch.setattr("backend.core.estimates.now", lambda: 900.0)
    record_estimate(conn, 1, "ollama", EST)
    c = compare(conn, _job())
    # Half the documents, so half the estimate: 200-400 s. The run took 300 s.
    assert (c["estimated_low_s"], c["estimated_high_s"], c["actual_s"]) == (200.0, 400.0, 300.0)
    assert c["within_range"] is True and c["actual_vs_estimate"] == 1.0


def test_no_comparison_without_a_prior_single_lane_estimate(monkeypatch):
    conn = _conn()
    assert compare(conn, _job()) is None  # no estimate stored
    monkeypatch.setattr("backend.core.estimates.now", lambda: 2000.0)
    record_estimate(conn, 1, "ollama", EST)
    assert compare(conn, _job()) is None  # estimate made after the job started
    monkeypatch.setattr("backend.core.estimates.now", lambda: 900.0)
    record_estimate(conn, 1, "ollama", EST)
    two_lanes = {"lanes": [{"provider": "ollama", "concurrency": 2}, {"provider": "heuristic", "concurrency": 4}]}
    assert compare(conn, _job(params=two_lanes)) is None
    assert compare(conn, _job(status="running", finished_at=None)) is None
    assert compare(conn, _job(params={"lanes": [{"provider": "heuristic", "concurrency": 4}]})) is None


def test_sub_second_runs_count_as_within_range(monkeypatch):
    conn = _conn()
    monkeypatch.setattr("backend.core.estimates.now", lambda: 900.0)
    tiny = {**EST, "est_seconds_low": 0.0, "est_seconds_high": 0.0}
    record_estimate(conn, 1, "ollama", tiny)
    assert compare(conn, _job(finished_at=1000.1))["within_range"] is True
