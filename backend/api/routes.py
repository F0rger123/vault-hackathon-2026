"""HTTP API, version 1. Every route except /health requires a bearer token and a permission."""

import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from backend.api.deps import effective_settings, get_conn, get_settings, require
from backend.api.schemas import (
    CollectionCreate,
    CorrectionCreate,
    Decision,
    EstimateRequest,
    ImportPath,
    InvestigationCreate,
    JobCreate,
    ProposalCreate,
    RemoteToggle,
)
from backend.core.config import Settings
from backend.core.estimates import compare as compare_estimate
from backend.core.estimates import record_estimate
from backend.core.hardware import estimate_runtime, profile_hardware, recommend_workers
from backend.indexing.investigate import investigate
from backend.indexing.search import search as run_search
from backend.ingest.service import ensure_collection, ingest_bytes
from backend.providers import PROVIDER_NAMES, get_provider
from backend.providers.base import ProviderError
from backend.security import audit
from backend.security.auth import Principal, list_tokens, revoke_token
from backend.security.files import FileRejected, contained, safe_join
from backend.storage.db import dumps, loads, now
from backend.workers.importer import candidate_files, create_import_job, import_one
from backend.workers.jobs import create_process_job
from backend.workers.processing import process_document
from backend.workers.proposals import create_proposal, execute_proposal

VERSION = "0.1.0"
router = APIRouter(prefix="/api/v1")


def _row(r: sqlite3.Row | None) -> dict:
    if r is None:
        raise HTTPException(status_code=404, detail="not found")
    return dict(r)


def _provider(conn, settings: Settings, name: str | None, confirm_remote: bool, actor: str):
    eff = effective_settings(conn, settings)
    try:
        provider = get_provider(name or eff.provider, eff)
    except ProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    info = provider.info()
    if info.locality == "remote":
        if not eff.allow_remote_inference:
            audit.record(
                conn,
                actor,
                "inference.remote",
                "denied",
                detail={"provider": info.name, "reason": "remote inference disabled"},
            )
            raise HTTPException(status_code=403, detail="remote inference is disabled by the administrator")
        if not confirm_remote:
            raise HTTPException(
                status_code=409,
                detail="this provider sends document text off this machine; resend with confirm_remote=true to approve",
            )
    if not info.available:
        raise HTTPException(status_code=503, detail=f"provider {info.name} unavailable: {info.detail}")
    return provider, info


# ---------- system ----------


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION}


@router.get("/me")
def me(p: Principal = Depends(require("system:read"))) -> dict:
    return {"username": p.username, "role": p.role}


@router.get("/tokens")
def tokens(conn=Depends(get_conn), _: Principal = Depends(require("users:manage"))) -> list[dict]:
    """Every API token's metadata (F09.8). The token value and its hash are never returned."""
    return list_tokens(conn)


@router.post("/tokens/{token_id}/revoke")
def revoke(token_id: int, conn=Depends(get_conn), p: Principal = Depends(require("users:manage"))) -> dict:
    """Revoke a token. Requests using it get 401 from the next call on."""
    if not conn.execute("SELECT 1 FROM api_tokens WHERE id = ?", (token_id,)).fetchone():
        raise HTTPException(status_code=404, detail="token not found")
    changed = revoke_token(conn, token_id)
    audit.record(conn, p.username, "token.revoke", "allowed", target=f"token:{token_id}", detail={"changed": changed})
    return next(t for t in list_tokens(conn) if t["id"] == token_id)


@router.get("/system/hardware")
def hardware(settings: Settings = Depends(get_settings), _: Principal = Depends(require("system:read"))) -> dict:
    return profile_hardware(settings.data_dir).to_dict()


@router.get("/system/providers")
def providers(
    conn=Depends(get_conn), settings: Settings = Depends(get_settings), _: Principal = Depends(require("system:read"))
) -> dict:
    eff = effective_settings(conn, settings)
    out = []
    for name in PROVIDER_NAMES:
        try:
            out.append(get_provider(name, eff).info().__dict__)
        except ProviderError as exc:
            out.append({"name": name, "available": False, "detail": str(exc)})
    return {"default": eff.provider, "allow_remote_inference": eff.allow_remote_inference, "providers": out}


@router.put("/settings/remote-inference")
def set_remote(body: RemoteToggle, conn=Depends(get_conn), p: Principal = Depends(require("settings:write"))):
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES ('allow_remote_inference', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ("true" if body.enabled else "false",),
    )
    audit.record(conn, p.username, "settings.remote_inference", "allowed", detail={"enabled": body.enabled})
    return {"allow_remote_inference": body.enabled}


@router.get("/stats")
def stats(conn=Depends(get_conn), _: Principal = Depends(require("system:read"))) -> dict:
    one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "collections": one("SELECT COUNT(*) FROM collections"),
        "documents": one("SELECT COUNT(*) FROM documents"),
        "processed": one("SELECT COUNT(*) FROM documents WHERE status = 'processed'"),
        "pages": one("SELECT COUNT(*) FROM pages"),
        "bytes": one("SELECT COALESCE(SUM(size_bytes), 0) FROM documents"),
        "findings": one("SELECT COUNT(*) FROM findings"),
        "jobs_active": one("SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'running')"),
        "proposals_pending": one("SELECT COUNT(*) FROM proposals WHERE status = 'pending'"),
    }


# ---------- collections and ingestion ----------


@router.post("/collections", status_code=201)
def create_collection(
    body: CollectionCreate, conn=Depends(get_conn), p: Principal = Depends(require("collections:create"))
) -> dict:
    cid = ensure_collection(conn, body.name, p.user_id, body.description)
    audit.record(conn, p.username, "collection.create", "allowed", target=f"collection:{cid}")
    return _row(conn.execute("SELECT * FROM collections WHERE id = ?", (cid,)).fetchone())


@router.get("/collections")
def list_collections(conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))) -> list[dict]:
    rows = conn.execute(
        """SELECT c.*, COUNT(d.id) AS documents, COALESCE(SUM(d.size_bytes), 0) AS bytes,
                  SUM(d.status = 'processed') AS processed
           FROM collections c LEFT JOIN documents d ON d.collection_id = c.id GROUP BY c.id ORDER BY c.id"""
    ).fetchall()
    return [dict(r) for r in rows]


def _collection(conn, collection_id: int) -> dict:
    return _row(conn.execute("SELECT * FROM collections WHERE id = ?", (collection_id,)).fetchone())


@router.post("/collections/{collection_id}/documents")
async def upload(
    collection_id: int,
    files: list[UploadFile],
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("documents:upload")),
) -> dict:
    _collection(conn, collection_id)
    limit = settings.max_upload_mb * 1024 * 1024
    accepted, rejected = [], []
    for f in files[:500]:
        data = await f.read(limit + 1)
        try:
            res = ingest_bytes(conn, settings, collection_id, f.filename or "", data)
            accepted.append(res.__dict__)
        except FileRejected as exc:
            rejected.append({"filename": f.filename, "reason": str(exc)})
            audit.record(
                conn,
                p.username,
                "document.upload",
                "denied",
                target=f"collection:{collection_id}",
                detail={"filename": (f.filename or "")[:120], "reason": str(exc)},
            )
    audit.record(
        conn,
        p.username,
        "document.upload",
        "allowed",
        target=f"collection:{collection_id}",
        detail={"accepted": len(accepted), "rejected": len(rejected)},
    )
    return {"accepted": accepted, "rejected": rejected}


@router.post("/collections/{collection_id}/import-path")
def import_path(
    collection_id: int,
    body: ImportPath,
    request: Request,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("settings:write")),
) -> dict:
    """Admin-only: import every supported file under a server directory inside VAULT_IMPORT_ROOTS."""
    _collection(conn, collection_id)
    roots = settings.import_root_paths
    if not roots:
        raise HTTPException(status_code=403, detail="path imports are disabled (VAULT_IMPORT_ROOTS is empty)")
    try:
        base = contained(Path(body.path), roots)
    except FileRejected as exc:
        audit.record(conn, p.username, "document.import_path", "denied", detail={"reason": str(exc)})
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if body.background:
        job_id = create_import_job(conn, collection_id, base, p.user_id)
        audit.record(
            conn, p.username, "document.import_path", "allowed", target=f"job:{job_id}", detail={"background": True}
        )
        request.app.state.runner.start(job_id)
        return _job(conn, job_id)
    accepted, rejected = 0, []
    for path in candidate_files(base):
        try:
            import_one(conn, settings, collection_id, base, path)
            accepted += 1
        except FileRejected as exc:
            rejected.append({"filename": path.name, "reason": str(exc)})
    audit.record(
        conn,
        p.username,
        "document.import_path",
        "allowed",
        target=f"collection:{collection_id}",
        detail={"accepted": accepted, "rejected": len(rejected)},
    )
    return {"accepted": accepted, "rejected": rejected[:200]}


@router.get("/collections/{collection_id}/inventory")
def inventory(
    collection_id: int,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    _: Principal = Depends(require("documents:read")),
) -> dict:
    _collection(conn, collection_id)
    by_type = conn.execute(
        """SELECT media_type, COUNT(*) AS documents, SUM(size_bytes) AS bytes, SUM(page_count) AS pages
           FROM documents WHERE collection_id = ? GROUP BY media_type""",
        (collection_id,),
    ).fetchall()
    hw = profile_hardware(settings.data_dir)
    eff = effective_settings(conn, settings)
    try:
        prov = get_provider(eff.provider, eff)
        workers, reason = recommend_workers(hw, prov.locality, prov.name)
    except ProviderError:
        workers, reason = 1, "default provider misconfigured"
    return {
        "collection_id": collection_id,
        "by_media_type": [dict(r) for r in by_type],
        "hardware": hw.to_dict(),
        "recommended_workers": workers,
        "reason": reason,
    }


@router.post("/collections/{collection_id}/estimate")
def estimate(
    collection_id: int,
    body: EstimateRequest,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("jobs:create")),
) -> dict:
    """Benchmark: really process a small sample with the chosen provider and project total runtime."""
    _collection(conn, collection_id)
    provider, info = _provider(conn, settings, body.provider, body.confirm_remote, p.username)
    docs = conn.execute(
        "SELECT id FROM documents WHERE collection_id = ? ORDER BY RANDOM() LIMIT ?",
        (collection_id, body.sample_size),
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM documents WHERE collection_id = ?", (collection_id,)).fetchone()[0]
    if not docs:
        raise HTTPException(status_code=400, detail="collection has no documents")
    timings, errors = [], []
    for d in docs:
        try:
            timings.append(process_document(conn, provider, d["id"])["duration_ms"])
        except ProviderError as exc:
            errors.append(str(exc))
    if not timings:
        raise HTTPException(status_code=502, detail=f"benchmark failed: {errors[0]}")
    hw = profile_hardware(settings.data_dir)
    workers, reason = recommend_workers(hw, info.locality, info.name)
    overlap = 0.15 if info.name == "ollama" else 0.9
    est = estimate_runtime(timings, total, workers, overlap)
    record_estimate(conn, collection_id, info.name, est.to_dict())
    audit.record(
        conn,
        p.username,
        "collection.estimate",
        "allowed",
        target=f"collection:{collection_id}",
        detail={"provider": info.name, "model": info.model, "sample": len(timings)},
    )
    return {
        "provider": info.__dict__,
        "estimate": est.to_dict(),
        "recommended_workers": workers,
        "reason": reason,
        "errors": errors,
    }


# ---------- documents ----------


@router.get("/documents")
def list_documents(
    collection_id: int | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
    _: Principal = Depends(require("documents:read")),
) -> list[dict]:
    sql = (
        "SELECT id, collection_id, filename, sha256, size_bytes, media_type, page_count, status, created_at "
        "FROM documents"
    )
    args: list = []
    if collection_id is not None:
        sql += " WHERE collection_id = ?"
        args.append(collection_id)
    sql += " ORDER BY id LIMIT ? OFFSET ?"
    return [dict(r) for r in conn.execute(sql, [*args, limit, offset]).fetchall()]


@router.get("/documents/{document_id}")
def get_document(document_id: int, conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))):
    doc = _row(
        conn.execute(
            "SELECT id, collection_id, filename, sha256, size_bytes, media_type, page_count, status, error, created_at "
            "FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
    )
    x = conn.execute(
        "SELECT * FROM extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1", (document_id,)
    ).fetchone()
    if x:
        doc["extraction"] = {
            "provider": x["provider"],
            "model": x["model"],
            "locality": x["locality"],
            "policy_version": x["policy_version"],
            "data": loads(x["data"], {}),
            "evidence": loads(x["evidence"], []),
            "verified_ratio": x["verified_ratio"],
            "injection_flags": loads(x["injection_flags"], []),
            "duration_ms": x["duration_ms"],
            "created_at": x["created_at"],
        }
    else:
        doc["extraction"] = None
    return doc


@router.get("/documents/{document_id}/pages/{page_no}")
def get_page(
    document_id: int, page_no: int, conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))
) -> dict:
    return _row(
        conn.execute(
            "SELECT document_id, page_no, text FROM pages WHERE document_id = ? AND page_no = ?", (document_id, page_no)
        ).fetchone()
    )


@router.get("/documents/{document_id}/original")
def get_original(
    document_id: int,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("documents:read")),
):
    doc = _row(
        conn.execute("SELECT filename, media_type, stored_path FROM documents WHERE id = ?", (document_id,)).fetchone()
    )
    path = safe_join(settings.data_dir, *doc["stored_path"].replace("\\", "/").split("/"))
    audit.record(conn, p.username, "document.download", "allowed", target=f"document:{document_id}")
    return FileResponse(
        path, media_type=doc["media_type"], filename=doc["filename"], headers={"X-Content-Type-Options": "nosniff"}
    )


@router.post("/documents/{document_id}/corrections", status_code=201)
def add_correction(
    document_id: int,
    body: CorrectionCreate,
    conn=Depends(get_conn),
    p: Principal = Depends(require("corrections:create")),
) -> dict:
    """Record a human correction. With `when_contains`, also publish a new policy version with a rule."""
    _row(conn.execute("SELECT id FROM documents WHERE id = ?", (document_id,)).fetchone())
    # body.field is a validated Literal, so the column name cannot be attacker-controlled.
    x = conn.execute(
        f"SELECT {body.field} AS v FROM extractions WHERE document_id = ? ORDER BY id DESC LIMIT 1", (document_id,)
    ).fetchone()  # noqa: S608
    old = x["v"] if x else None
    conn.execute(
        "INSERT INTO corrections (document_id, field, old_value, new_value, note, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (document_id, body.field, old, body.value, body.note, p.user_id, now()),
    )
    version = None
    if body.when_contains:
        row = conn.execute("SELECT version, rules FROM policies ORDER BY version DESC LIMIT 1").fetchone()
        rules = loads(row["rules"], []) if row else []
        rules.append({"when_contains": body.when_contains, "field": body.field, "value": body.value})
        version = (row["version"] if row else 1) + 1
        conn.execute(
            "INSERT INTO policies (version, rules, created_by, created_at) VALUES (?, ?, ?, ?)",
            (version, dumps(rules), p.user_id, now()),
        )
    audit.record(
        conn,
        p.username,
        "document.correct",
        "allowed",
        target=f"document:{document_id}",
        detail={"field": body.field, "policy_version": version},
    )
    return {
        "document_id": document_id,
        "field": body.field,
        "old_value": old,
        "new_value": body.value,
        "policy_version": version,
    }


@router.get("/policies")
def list_policies(conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))) -> list[dict]:
    rows = conn.execute("SELECT version, rules, created_at FROM policies ORDER BY version").fetchall()
    return [{"version": r["version"], "rules": loads(r["rules"], []), "created_at": r["created_at"]} for r in rows]


# ---------- jobs ----------


@router.post("/jobs", status_code=202)
def create_job(
    body: JobCreate,
    request: Request,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("jobs:create")),
) -> dict:
    _collection(conn, body.collection_id)
    if body.lanes:
        lanes = []
        for spec in body.lanes:
            _, info = _provider(conn, settings, spec.provider, body.confirm_remote, p.username)
            lanes.append(
                {"provider": info.name, "concurrency": spec.concurrency, "model": info.model, "locality": info.locality}
            )
    else:
        _, info = _provider(conn, settings, body.provider, body.confirm_remote, p.username)
        recommended, _reason = recommend_workers(profile_hardware(settings.data_dir), info.locality, info.name)
        workers = min(body.workers or settings.max_workers or recommended, 64)
        lanes = [{"provider": info.name, "concurrency": workers, "model": info.model, "locality": info.locality}]
    if body.escalate_provider:
        _provider(conn, settings, body.escalate_provider, body.confirm_remote, p.username)
    job_id = create_process_job(
        conn,
        body.collection_id,
        lanes[0]["provider"],
        lanes[0]["concurrency"],
        p.user_id,
        lanes=[{"provider": ln["provider"], "concurrency": ln["concurrency"]} for ln in lanes],
        escalate_provider=body.escalate_provider,
    )
    audit.record(
        conn,
        p.username,
        "job.create",
        "allowed",
        target=f"job:{job_id}",
        detail={"lanes": lanes, "escalate_provider": body.escalate_provider},
    )
    request.app.state.runner.start(job_id)
    return _job(conn, job_id)


def _job(conn, job_id: int) -> dict:
    job = _row(conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())
    job["params"] = loads(job["params"], {})
    job["items"] = {
        r["status"]: r["n"]
        for r in conn.execute(
            "SELECT status, COUNT(*) AS n FROM job_items WHERE job_id = ? GROUP BY status", (job_id,)
        ).fetchall()
    }
    job["errors"] = [
        dict(r)
        for r in conn.execute(
            "SELECT document_id, error, attempts FROM job_items WHERE job_id = ? AND status = 'failed' LIMIT 20",
            (job_id,),
        ).fetchall()
    ]
    job["estimate_check"] = compare_estimate(conn, job)
    return job


@router.get("/jobs")
def list_jobs(conn=Depends(get_conn), _: Principal = Depends(require("jobs:read"))) -> list[dict]:
    rows = conn.execute("SELECT id FROM jobs ORDER BY id DESC LIMIT 50").fetchall()
    return [_job(conn, r["id"]) for r in rows]


@router.get("/jobs/{job_id}")
def get_job(job_id: int, conn=Depends(get_conn), _: Principal = Depends(require("jobs:read"))) -> dict:
    return _job(conn, job_id)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int, conn=Depends(get_conn), p: Principal = Depends(require("jobs:cancel"))) -> dict:
    _job(conn, job_id)
    conn.execute("UPDATE jobs SET cancel_requested = 1 WHERE id = ?", (job_id,))
    audit.record(conn, p.username, "job.cancel", "allowed", target=f"job:{job_id}")
    return _job(conn, job_id)


# ---------- search and findings ----------


@router.get("/search")
def search(
    q: str = Query("", max_length=300),
    collection_id: int | None = None,
    doc_type: str | None = None,
    project: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    part_number: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    conn=Depends(get_conn),
    _: Principal = Depends(require("search")),
) -> dict:
    results = run_search(conn, q, collection_id, doc_type, project, date_from, date_to, part_number, limit)
    return {"query": q, "count": len(results), "results": results}


@router.get("/collections/{collection_id}/findings")
def findings(collection_id: int, conn=Depends(get_conn), _: Principal = Depends(require("findings:read"))):
    rows = conn.execute("SELECT * FROM findings WHERE collection_id = ? ORDER BY id", (collection_id,)).fetchall()
    return [{**dict(r), "evidence": loads(r["evidence"], [])} for r in rows]


@router.post("/investigations")
def new_investigation(
    body: InvestigationCreate,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("search")),
) -> dict:
    _collection(conn, body.collection_id)
    provider, info = _provider(conn, settings, body.provider, body.confirm_remote, p.username)
    try:
        result = investigate(conn, body.collection_id, body.question, provider)
    except ProviderError as exc:
        audit.record(conn, p.username, "investigation.run", "error", detail={"provider": info.name})
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # The question is the user's own words, but it can still name sensitive things; log sizes only.
    audit.record(
        conn,
        p.username,
        "investigation.run",
        "allowed",
        target=f"collection:{body.collection_id}",
        detail={"provider": info.name, "sources": len(result["sources"]), "sentences": len(result["answer"])},
    )
    return result


# ---------- proposals (approval workflow) ----------


@router.post("/proposals", status_code=201)
def new_proposal(body: ProposalCreate, conn=Depends(get_conn), p: Principal = Depends(require("proposals:create"))):
    _collection(conn, body.collection_id)
    try:
        pid = create_proposal(conn, body.collection_id, p.user_id, body.instruction, body.pattern)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit.record(conn, p.username, "proposal.create", "allowed", target=f"proposal:{pid}")
    return _proposal(conn, pid)


def _proposal(conn, pid: int) -> dict:
    r = _row(conn.execute("SELECT * FROM proposals WHERE id = ?", (pid,)).fetchone())
    r["plan"] = loads(r["plan"], {})
    r["result"] = loads(r["result"], None)
    return r


@router.get("/proposals")
def list_proposals(conn=Depends(get_conn), _: Principal = Depends(require("proposals:read"))) -> list[dict]:
    rows = conn.execute("SELECT id FROM proposals ORDER BY id DESC LIMIT 50").fetchall()
    return [_proposal(conn, r["id"]) for r in rows]


@router.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: int, conn=Depends(get_conn), _: Principal = Depends(require("proposals:read"))):
    return _proposal(conn, proposal_id)


@router.post("/proposals/{proposal_id}/approve")
def approve(
    proposal_id: int,
    body: Decision,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("proposals:approve")),
) -> dict:
    prop = _proposal(conn, proposal_id)
    if prop["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"proposal is already {prop['status']}")
    result = execute_proposal(conn, settings, proposal_id)
    conn.execute(
        "UPDATE proposals SET status = 'executed', decided_by = ?, decided_at = ?, result = ? WHERE id = ?",
        (p.user_id, now(), dumps(result), proposal_id),
    )
    audit.record(
        conn,
        p.username,
        "proposal.approve",
        "allowed",
        target=f"proposal:{proposal_id}",
        detail={"copied": result["copied"], "note": body.note[:200]},
    )
    return _proposal(conn, proposal_id)


@router.post("/proposals/{proposal_id}/reject")
def reject(
    proposal_id: int, body: Decision, conn=Depends(get_conn), p: Principal = Depends(require("proposals:approve"))
) -> dict:
    prop = _proposal(conn, proposal_id)
    if prop["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"proposal is already {prop['status']}")
    conn.execute(
        "UPDATE proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?",
        (p.user_id, now(), proposal_id),
    )
    audit.record(conn, p.username, "proposal.reject", "allowed", target=f"proposal:{proposal_id}")
    return _proposal(conn, proposal_id)


# ---------- audit ----------


@router.get("/audit")
def audit_log(
    limit: int = Query(100, ge=1, le=1000),
    outcome: str | None = None,
    conn=Depends(get_conn),
    _: Principal = Depends(require("audit:read")),
) -> list[dict]:
    sql, args = "SELECT * FROM audit_log", []
    if outcome:
        sql += " WHERE outcome = ?"
        args.append(outcome)
    sql += " ORDER BY id DESC LIMIT ?"
    return [{**dict(r), "detail": loads(r["detail"], {})} for r in conn.execute(sql, [*args, limit]).fetchall()]
