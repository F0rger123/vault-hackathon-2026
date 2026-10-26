"""HTTP API v1, part 2: agent activity, capacity planning and teach-by-example."""

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.deps import effective_settings, get_conn, get_settings, require
from backend.api.routes import _provider, _row
from backend.api.schemas import CalibrateRequest, ExampleCreate
from backend.core.capacity import CapacityPlan, calibrate, static_ceiling
from backend.core.config import Settings
from backend.core.hardware import profile_hardware
from backend.providers import get_provider
from backend.providers.base import ProviderError
from backend.security import audit
from backend.security.auth import Principal
from backend.storage.db import dumps, loads, now
from backend.workers.processing import load_pages

router = APIRouter(prefix="/api/v1")


@router.get("/jobs/{job_id}/events")
def job_events(
    job_id: int,
    after_id: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    conn=Depends(get_conn),
    _: Principal = Depends(require("jobs:read")),
) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM agent_events WHERE job_id = ? AND id > ? ORDER BY id LIMIT ?", (job_id, after_id, limit)
    ).fetchall()
    return [{**dict(r), "detail": loads(r["detail"], {})} for r in rows]


@router.get("/jobs/{job_id}/agents")
def job_agents(job_id: int, conn=Depends(get_conn), _: Principal = Depends(require("jobs:read"))) -> list[dict]:
    """Per-agent summary for the live agent view."""
    rows = conn.execute(
        """SELECT agent, COUNT(*) AS events, SUM(action = 'extract') AS extracted,
                  SUM(outcome = 'error') AS errors, SUM(outcome = 'denied') AS denied, MAX(ts) AS last_ts
           FROM agent_events WHERE job_id = ? GROUP BY agent ORDER BY agent""",
        (job_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@router.get("/system/capacity")
def capacity(
    provider: str | None = None,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    _: Principal = Depends(require("system:read")),
) -> dict:
    eff = effective_settings(conn, settings)
    try:
        info = get_provider(provider or eff.provider, eff).info()
    except ProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    hw = profile_hardware(settings.data_dir)
    ceiling, reason = static_ceiling(hw, info.model, info.locality)
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (f"calibration:{info.name}",)).fetchone()
    return {
        "provider": info.__dict__,
        "hardware": hw.to_dict(),
        "static_ceiling": ceiling,
        "reason": reason,
        "calibration": loads(row["value"], None) if row else None,
    }


@router.post("/system/capacity/calibrate")
def calibrate_capacity(
    body: CalibrateRequest,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("settings:write")),
) -> dict:
    """Measure throughput at increasing concurrency on real stored documents (admin; can take minutes)."""
    provider, info = _provider(conn, settings, body.provider, body.confirm_remote, p.username)
    docs = conn.execute(
        "SELECT id, filename FROM documents WHERE media_type NOT LIKE 'image/%' ORDER BY RANDOM() LIMIT ?",
        (body.sample_size,),
    ).fetchall()
    if len(docs) < 2:
        raise HTTPException(status_code=400, detail="need at least 2 text documents to calibrate")
    sample = [(d["filename"], load_pages(conn, d["id"])) for d in docs]
    hw = profile_hardware(settings.data_dir)
    ceiling, reason = static_ceiling(hw, info.model, info.locality)
    provider.extract(sample[0][1], sample[0][0], [])  # warm-up so model loading does not skew level 1
    levels, best = calibrate(
        lambda i: provider.extract(sample[i][1], sample[i][0], []), len(sample), min(ceiling, body.max_concurrency)
    )
    plan = CapacityPlan(
        info.name,
        info.model,
        info.locality,
        ceiling,
        reason,
        levels,
        best,
        next(lv.docs_per_minute for lv in levels if lv.concurrency == best),
    )
    result = plan.to_dict() | {"measured_at": now()}
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (f"calibration:{info.name}", dumps(result)),
    )
    audit.record(
        conn,
        p.username,
        "capacity.calibrate",
        "allowed",
        detail={"provider": info.name, "best": best, "docs_per_minute": plan.docs_per_minute},
    )
    return result


@router.post("/examples", status_code=201)
def add_example(
    body: ExampleCreate, conn=Depends(get_conn), p: Principal = Depends(require("corrections:create"))
) -> dict:
    """Teach by example: store human-verified labels for a document. Used as few-shot guidance, not training."""
    _row(conn.execute("SELECT id FROM documents WHERE id = ?", (body.document_id,)).fetchone())
    allowed = {"doc_type", "project", "doc_date", "title"}
    labels = {k: v for k, v in body.labels.items() if k in allowed}
    if not labels:
        raise HTTPException(status_code=422, detail=f"labels must include one of {sorted(allowed)}")
    conn.execute(
        "INSERT INTO examples (document_id, labels, note, created_by, created_at) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(document_id) DO UPDATE SET labels = excluded.labels, note = excluded.note",
        (body.document_id, dumps(labels), body.note, p.user_id, now()),
    )
    audit.record(conn, p.username, "example.add", "allowed", target=f"document:{body.document_id}")
    return {"document_id": body.document_id, "labels": labels}


@router.get("/examples")
def list_examples(conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))) -> list[dict]:
    rows = conn.execute(
        "SELECT e.document_id, e.labels, e.note, e.created_at, d.filename FROM examples e "
        "JOIN documents d ON d.id = e.document_id ORDER BY e.id"
    ).fetchall()
    return [{**dict(r), "labels": loads(r["labels"], {})} for r in rows]


@router.get("/documents/{document_id}/screening")
def document_screening(
    document_id: int, conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))
) -> dict:
    r = _row(conn.execute("SELECT * FROM screenings WHERE document_id = ?", (document_id,)).fetchone())
    return {
        **r,
        "markings": loads(r["markings"], []),
        "injection": loads(r["injection"], []),
        "pii": loads(r["pii"], []),
    }
