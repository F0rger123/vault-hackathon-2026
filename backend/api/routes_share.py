"""HTTP API v1, part 4: share packs for people outside the organization (F08.6)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_conn, get_settings, require
from backend.api.routes import _collection, _proposal, _provider
from backend.api.schemas import ProviderName
from backend.core.config import Settings
from backend.security import audit
from backend.security.auth import Principal
from backend.workers import share_pack

router = APIRouter(prefix="/api/v1")


class ShareCriteria(BaseModel):
    projects: list[str] = Field(default_factory=list, max_length=50)
    doc_types: list[str] = Field(default_factory=list, max_length=20)
    include_confidential: bool = False
    redact: list[str] = Field(default_factory=lambda: ["emails", "phone_numbers", "id_numbers"], max_length=10)
    terms: list[str] = Field(default_factory=list, max_length=100)


class ShareCreate(BaseModel):
    collection_id: int
    recipient: str = Field(min_length=1, max_length=120)
    instruction: str = Field(default="", max_length=500)
    criteria: ShareCriteria = Field(default_factory=ShareCriteria)


class ShareInterpret(BaseModel):
    collection_id: int
    instruction: str = Field(min_length=3, max_length=500)
    provider: ProviderName | None = None


@router.post("/share-packs/interpret")
def interpret_share(
    body: ShareInterpret,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    p: Principal = Depends(require("proposals:create")),
) -> dict:
    """Suggest share settings from plain words. Local models only, and nothing is created."""
    _collection(conn, body.collection_id)
    provider, info = _provider(conn, settings, body.provider, False, p.username)
    result = share_pack.interpret(
        conn, body.collection_id, body.instruction, provider if info.locality == "local" else None
    )
    audit.record(conn, p.username, "share.interpret", "allowed", target=f"collection:{body.collection_id}")
    return result


@router.post("/share-packs", status_code=201)
def create_share(
    body: ShareCreate, conn=Depends(get_conn), p: Principal = Depends(require("proposals:create"))
) -> dict:
    """Plan a share pack. Nothing is written until an administrator approves it under Approvals."""
    _collection(conn, body.collection_id)
    try:
        pid = share_pack.create_share_proposal(
            conn, body.collection_id, p.user_id, body.recipient, body.criteria.model_dump(), body.instruction
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    prop = _proposal(conn, pid)
    audit.record(
        conn,
        p.username,
        "share.plan",
        "allowed",
        target=f"proposal:{pid}",
        detail={k: prop["plan"]["summary"][k] for k in ("shared", "left_out", "redactions")},
    )
    return prop
