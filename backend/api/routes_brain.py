"""HTTP API v1, part 3: the collection brain (F07.7) and its graph (F07.8)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, require
from backend.api.routes import _collection
from backend.security import audit
from backend.security.auth import Principal
from backend.workers import brain
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
def get_brain(collection_id: int, conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))) -> dict:
    """What VAULT knows about this collection, what people taught it, and the questions it still has."""
    _collection(conn, collection_id)
    return {**brain.profile(conn, collection_id), "questions": brain.gaps(conn, collection_id)}


@router.get("/collections/{collection_id}/brain/graph")
def get_brain_graph(
    collection_id: int, conn=Depends(get_conn), _: Principal = Depends(require("documents:read"))
) -> dict:
    _collection(conn, collection_id)
    return graph(conn, collection_id)


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
