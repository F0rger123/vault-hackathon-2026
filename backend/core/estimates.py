"""Estimate calibration (F03.5): remember the last runtime estimate and compare it with the real run.

The latest estimate per collection and provider is kept in `settings_kv` (no schema change). When a
single-lane job with that provider finishes, `compare` scales the estimate to the documents the job really
processed and reports how far off it was, so users can see how much to trust estimates on this machine.
"""

from __future__ import annotations

import sqlite3

from backend.storage.db import dumps, loads, now

TERMINAL_OK = ("completed", "completed_with_errors")
# Sub-second runs are timing noise; a 1 s slack keeps a 0.0 s estimate for a 0.1 s run from reading as "wrong".
SLACK_S = 1.0


def _key(collection_id: int, provider: str) -> str:
    return f"estimate:{collection_id}:{provider}"


def record_estimate(conn: sqlite3.Connection, collection_id: int, provider: str, estimate: dict) -> None:
    value = {
        "created_at": now(),
        "documents": estimate["documents"],
        "workers": estimate["workers"],
        "low_s": estimate["est_seconds_low"],
        "high_s": estimate["est_seconds_high"],
        "sample_size": estimate["sample_size"],
    }
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (_key(collection_id, provider), dumps(value)),
    )


def compare(conn: sqlite3.Connection, job: dict) -> dict | None:
    """Estimated vs actual runtime for a finished single-lane job, or None when there is nothing to compare."""
    lanes = job["params"].get("lanes") or []
    if job["status"] not in TERMINAL_OK or not job.get("started_at") or not job.get("finished_at") or len(lanes) != 1:
        return None
    provider = lanes[0]["provider"]
    key = _key(job["collection_id"], provider)
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (key,)).fetchone()
    est = loads(row["value"], None) if row else None
    # Only an estimate made before the job started can be checked against it.
    if not est or est["created_at"] > job["started_at"] or not est["documents"]:
        return None
    processed = job["done"] + job["failed"]
    scale = processed / est["documents"]
    low, high = est["low_s"] * scale, est["high_s"] * scale
    actual = job["finished_at"] - job["started_at"]
    mid = (low + high) / 2
    return {
        "provider": provider,
        "estimated_at": est["created_at"],
        "estimated_low_s": round(low, 1),
        "estimated_high_s": round(high, 1),
        "actual_s": round(actual, 1),
        "within_range": low - SLACK_S <= actual <= high + SLACK_S,
        # 1.0 means exactly the middle of the range; 0.5 means the run took half as long as expected.
        "actual_vs_estimate": round(actual / mid, 2) if mid else None,
        "estimated_workers": est["workers"],
        "job_workers": job["workers"],
        "sample_size": est["sample_size"],
    }
