"""HTTP API v1: classification labels and redactions (F09.23).

The Classifier helper proposes; an administrator approves in Approvals (the existing proposal routes). Administrators
can also relabel a document or remove a redaction directly; both are audited. Nothing here changes an original file.
"""

from fastapi import APIRouter, Depends, HTTPException

from backend.agents import classifier
from backend.api.deps import get_conn, require
from backend.api.routes import _open_check, _proposal, _row
from backend.api.schemas import ClassifyRequest, Relabel
from backend.security import audit
from backend.security import classification as cls
from backend.security.auth import ROLE_PERMISSIONS, Principal
from backend.storage.db import now

router = APIRouter(prefix="/api/v1")


@router.get("/classification/levels")
def levels(p: Principal = Depends(require("documents:read"))) -> dict:
    """The four labels, what each means, and which roles may open each one."""
    return {
        "levels": [
            {
                "level": level,
                "meaning": cls.LEVEL_WORDS[level],
                "roles": [r for r in ROLE_PERMISSIONS if cls.may_open(r, level)],
            }
            for level in cls.LEVELS
        ],
        "default": cls.DEFAULT_LEVEL,
        "your_clearance": cls.clearance(p.role),
        "sees_redacted": cls.sees_redacted(p.role),
    }


@router.post("/collections/{collection_id}/classify", status_code=201)
def classify(
    collection_id: int,
    body: ClassifyRequest,
    conn=Depends(get_conn),
    p: Principal = Depends(require("proposals:create")),
) -> dict:
    """Run the Classifier helper and store what it suggests as a pending proposal. Applies nothing."""
    _row(conn.execute("SELECT id FROM collections WHERE id = ?", (collection_id,)).fetchone())
    rows = conn.execute(
        "SELECT id, classification FROM main.documents WHERE collection_id = ? ORDER BY id", (collection_id,)
    ).fetchall()
    # Only documents this person may open: an analyst cannot learn about restricted ones by asking for a scan.
    allowed = [r["id"] for r in rows if cls.may_open(p.role, r["classification"])]
    if body.document_ids is not None:
        wanted = set(body.document_ids)
        allowed = [i for i in allowed if i in wanted]
    if not allowed:
        raise HTTPException(status_code=400, detail="no documents to classify")
    pid = classifier.create_proposal(conn, collection_id, p.user_id, allowed, body.instruction, body.level)
    audit.record(
        conn,
        p.username,
        "classification.propose",
        "allowed",
        target=f"proposal:{pid}",
        detail={"documents": len(allowed), "level": body.level},
    )
    return _proposal(conn, pid)


@router.put("/documents/{document_id}/classification")
def relabel(
    document_id: int,
    body: Relabel,
    conn=Depends(get_conn),
    p: Principal = Depends(require("documents:classify")),
) -> dict:
    """An administrator sets the label directly. Audited with the old and new label, never the document's text."""
    row = _open_check(conn, p, document_id, "classification.set")
    conn.execute(
        "UPDATE main.documents SET classification = ?, classification_reason = ?, classification_set_by = 'user', "
        "classification_by_user = ?, classification_set_at = ? WHERE id = ?",
        (body.level, body.reason.strip()[:300] or "Set by an administrator", p.username, now(), document_id),
    )
    audit.record(
        conn,
        p.username,
        "classification.set",
        "allowed",
        target=f"document:{document_id}",
        detail={"from": cls.level(row["classification"]), "to": body.level},
    )
    return cls.describe(cls.classification_of(conn, document_id))


@router.post("/documents/{document_id}/redactions/{redaction_id}/remove")
def unredact(
    document_id: int,
    redaction_id: int,
    conn=Depends(get_conn),
    p: Principal = Depends(require("documents:classify")),
) -> dict:
    """An administrator lifts one redaction. The span is shown again to everyone who may open the document."""
    _open_check(conn, p, document_id, "redaction.remove")
    r = conn.execute(
        "SELECT id, kind, status FROM main.redactions WHERE id = ? AND document_id = ?", (redaction_id, document_id)
    ).fetchone()
    if r is None:
        raise HTTPException(status_code=404, detail="not found")
    if r["status"] not in ("applied", "proposed"):
        raise HTTPException(status_code=409, detail=f"redaction is already {r['status']}")
    conn.execute(
        "UPDATE main.redactions SET status = 'removed', decided_by = ?, decided_at = ? WHERE id = ?",
        (p.username, now(), redaction_id),
    )
    audit.record(
        conn,
        p.username,
        "redaction.remove",
        "allowed",
        target=f"document:{document_id}",
        detail={"redaction_id": redaction_id, "kind": r["kind"], "was": r["status"]},
    )
    return {"id": redaction_id, "status": "removed"}
