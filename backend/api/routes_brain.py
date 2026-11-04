"""HTTP API v1, part 3: the collection brain (F07.7) and its graph (F07.8)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, require
from backend.api.routes import _collection, _guard, _scrub
from backend.security import audit
from backend.security.auth import Principal
from backend.workers import activity, brain
from backend.workers.brain_graph import graph

router = APIRouter(prefix="/api/v1")


class KnowledgeCreate(BaseModel):
    kind: Literal["meaning", "instruction"]
    term: str | None = Field(default=None, max_length=120)
    text: str = Field(min_length=1, max_length=500)


class GapAnswer(BaseModel):
    gap_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    answer: str = Field(min_length=1, max_length=500)


class GapSkip(BaseModel):
    gap_id: str = Field(pattern=r"^[0-9a-f]{16}$")


@router.get("/collections/{collection_id}/brain")
def get_brain(collection_id: int, conn=Depends(get_conn), p: Principal = Depends(require("documents:read"))) -> dict:
    """What VAULT knows about this collection, what people taught it, and the questions it still has."""
    _collection(conn, collection_id)
    g = _guard(conn, p)
    return _scrub(g, {**brain.profile(conn, collection_id), "questions": brain.gaps(conn, collection_id)})


@router.get("/collections/{collection_id}/brain/graph")
def get_brain_graph(
    collection_id: int, conn=Depends(get_conn), p: Principal = Depends(require("documents:read"))
) -> dict:
    _collection(conn, collection_id)
    g = _guard(conn, p)
    return _scrub(g, graph(conn, collection_id))


@router.get("/collections/{collection_id}/activity")
def get_activity(
    collection_id: int,
    after_id: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    run: str | None = Query(default=None, pattern=r"^[A-Za-z0-9-]{1,40}$"),
    conn=Depends(get_conn),
    _: Principal = Depends(require("documents:read")),
) -> dict:
    """What VAULT actually did to this collection's files (F10.22), oldest first after `after_id`."""
    _collection(conn, collection_id)
    return activity.feed(conn, collection_id, after_id, limit, run)


@router.post("/collections/{collection_id}/brain/knowledge", status_code=201)
def teach(
    collection_id: int,
    body: KnowledgeCreate,
    conn=Depends(get_conn),
    p: Principal = Depends(require("corrections:create")),
) -> dict:
    """Teach the brain a meaning ("QA-7 means approved by quality") or an instruction, for this collection only."""
    _collection(conn, collection_id)
    try:
        saved = brain.add_knowledge(conn, collection_id, p.user_id, body.kind, body.term, body.text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    audit.record(
        conn, p.username, "brain.teach", "allowed", target=f"collection:{collection_id}", detail={"kind": body.kind}
    )
    return saved


@router.delete("/collections/{collection_id}/brain/knowledge/{knowledge_id}")
def forget(
    collection_id: int, knowledge_id: int, conn=Depends(get_conn), p: Principal = Depends(require("corrections:create"))
) -> dict:
    """Retire a meaning or instruction. It is kept for the record but no longer used."""
    if not brain.retire_knowledge(conn, collection_id, knowledge_id):
        raise HTTPException(status_code=404, detail="not found")
    audit.record(conn, p.username, "brain.forget", "allowed", target=f"collection:{collection_id}")
    return {"retired": knowledge_id}


@router.post("/collections/{collection_id}/brain/answer")
def answer(
    collection_id: int, body: GapAnswer, conn=Depends(get_conn), p: Principal = Depends(require("corrections:create"))
) -> dict:
    """Answer one of the brain's questions. The answer is used the next time the collection is read."""
    _collection(conn, collection_id)
    gap = brain.find_gap(conn, collection_id, body.gap_id)
    if not gap:
        raise HTTPException(status_code=404, detail="that question is no longer open")
    try:
        result = brain.answer_gap(conn, collection_id, p.user_id, gap, body.answer)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    audit.record(
        conn, p.username, "brain.answer", "allowed", target=f"collection:{collection_id}", detail={"kind": gap["kind"]}
    )
    return {"question": gap["question"], **result}


@router.post("/collections/{collection_id}/brain/skip")
def skip(
    collection_id: int, body: GapSkip, conn=Depends(get_conn), _: Principal = Depends(require("corrections:create"))
) -> dict:
    _collection(conn, collection_id)
    brain.skip_gap(conn, collection_id, body.gap_id)
    return {"skipped": body.gap_id}
