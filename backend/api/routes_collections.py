"""HTTP API v1 (F12.17): delete a collection, read new uploads automatically, remove or restore the demo data."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.api.deps import effective_settings, get_conn, get_settings, require
from backend.api.routes import _collection, _job, _provider
from backend.core.config import Settings
from backend.core.hardware import profile_hardware
from backend.core.local_models import local_models
from backend.ingest.service import ensure_collection, ingest_bytes
from backend.security import audit
from backend.security.auth import Principal
from backend.security.files import FileRejected
from backend.workers import demo_dataset
from backend.workers.collections import (
    CollectionBusy,
    active_job,
    delete_collection,
    demo_removed,
    set_demo_removed,
)
from backend.workers.jobs import create_process_job, documents_to_read

router = APIRouter(prefix="/api/v1")
log = logging.getLogger(__name__)

DEMO_COLLECTION = "Halvern Engineering Archive"


@router.delete("/collections/{collection_id}")
def remove_collection(
    collection_id: int,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("collections:delete")),
) -> dict:
    """Admin only. Removes the collection's rows and the stored copies no other collection uses."""
    target = f"collection:{collection_id}"
    try:
        gone = delete_collection(conn, settings, collection_id)
    except CollectionBusy as exc:
        audit.record(conn, p.username, "collection.delete", "denied", target=target, detail={"reason": "job running"})
        raise HTTPException(status_code=409, detail="a run is still going for this collection; stop it first") from exc
    if gone is None:
        raise HTTPException(status_code=404, detail="not found")
    detail = {
        "documents": gone.documents,
        "copies_removed": gone.copies_removed,
        "copies_kept": gone.copies_kept,
        "demo": gone.was_demo,
    }
    audit.record(conn, p.username, "collection.delete", "allowed", target=target, detail=detail)
    return {"deleted": gone.collection_id, "name": gone.name, **detail}


def _auto_lane(conn, settings: Settings) -> tuple[str, int]:
    """Llama 3 through the local Ollama when its model is installed and answering, otherwise the rules baseline.

    Never a remote model: auto-reading must not send anything off this computer without a person choosing it.
    """
    try:
        models = local_models(effective_settings(conn, settings), profile_hardware(settings.data_dir))
    except Exception:  # Ollama missing or slow: fall back quietly to the rules baseline
        log.info("local model check failed; reading with the rules baseline")
        models = {}
    llama = (
        next((m for m in models.get("models", []) if m.get("used_by_vault")), None) if models.get("reachable") else None
    )
    if llama:
        return "ollama", min(2, max(1, int(llama.get("copies_on_gpu") or 0) * 2))
    return "heuristic", 4


@router.post("/collections/{collection_id}/autoprocess", status_code=202)
def autoprocess(
    collection_id: int,
    request: Request,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("jobs:create")),
) -> dict:
    """Start reading new files after an upload. Never starts a second run while one is going for this collection."""
    _collection(conn, collection_id)
    running = active_job(conn, collection_id)
    if running:
        return {"started": False, "reason": "already_running", "job": _job(conn, running)}
    name, slots = _auto_lane(conn, settings)
    _, info = _provider(conn, settings, name, False, p.username)
    if info.locality != "local":  # defence in depth; _auto_lane only ever names local providers
        raise HTTPException(status_code=400, detail="automatic reading only uses models on this computer")
    todo, skipped = documents_to_read(conn, collection_id, {(info.name, info.model)})
    if not todo:
        return {"started": False, "reason": "nothing_new", "job": None}
    job_id = create_process_job(
        conn,
        collection_id,
        info.name,
        slots,
        p.user_id,
        document_ids=todo,
        lanes=[{"provider": info.name, "concurrency": slots}],
        skipped=skipped,
    )
    audit.record(
        conn,
        p.username,
        "job.create",
        "allowed",
        target=f"job:{job_id}",
        detail={"auto": True, "provider": info.name, "documents": len(todo), "skipped_already_read": skipped},
    )
    request.app.state.runner.start(job_id)
    return {"started": True, "reason": "started", "provider": info.name, "job": _job(conn, job_id)}


@router.get("/demo/status")
def demo_status(conn=Depends(get_conn), _: Principal = Depends(require("system:read"))) -> dict:
    demos = conn.execute("SELECT COUNT(*) FROM collections WHERE is_demo = 1").fetchone()[0]
    return {
        "demo_removed": demo_removed(conn),
        "demo_collections": demos,
        "can_restore": (demo_dataset.SYNTHETIC / "files").is_dir(),
    }


@router.post("/demo/restore", status_code=202)
def demo_restore(
    request: Request,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("collections:delete")),
) -> dict:
    """Admin only. Import the fictional demo archive again (data/synthetic/v1/files) and start reading it."""
    files = demo_dataset.SYNTHETIC / "files"
    if not files.is_dir():
        raise HTTPException(status_code=503, detail="the demo dataset is not part of this install")
    cid = ensure_collection(conn, DEMO_COLLECTION, p.user_id, "Fictional demo archive", True)
    conn.execute("UPDATE collections SET is_demo = 1 WHERE id = ?", (cid,))
    imported = rejected = 0
    for path in sorted(files.iterdir()):
        if not path.is_file():
            continue
        try:
            ingest_bytes(conn, settings, cid, path.name, path.read_bytes())
            imported += 1
        except FileRejected:
            rejected += 1
    set_demo_removed(conn, False)
    job = None
    if not active_job(conn, cid):
        _, info = _provider(conn, settings, "heuristic", False, p.username)
        todo, skipped = documents_to_read(conn, cid, {(info.name, info.model)})
        if todo:
            job_id = create_process_job(conn, cid, info.name, 4, p.user_id, document_ids=todo, skipped=skipped)
            request.app.state.runner.start(job_id)
            job = _job(conn, job_id)
    audit.record(
        conn,
        p.username,
        "demo.restore",
        "allowed",
        target=f"collection:{cid}",
        detail={"imported": imported, "rejected": rejected, "job": job["id"] if job else None},
    )
    return {"collection_id": cid, "imported": imported, "rejected": rejected, "job": job}
