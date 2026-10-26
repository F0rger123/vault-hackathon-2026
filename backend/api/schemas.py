"""Typed request bodies. Responses are plain JSON documented in coordination/API_CONTRACT.md."""

from typing import Literal

from pydantic import BaseModel, Field


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"^[\w .-]+$")
    description: str = Field(default="", max_length=500)


class ImportPath(BaseModel):
    path: str = Field(min_length=1, max_length=500)


class EstimateRequest(BaseModel):
    provider: Literal["ollama", "meta_api", "heuristic"] | None = None
    sample_size: int = Field(default=3, ge=1, le=20)
    confirm_remote: bool = False


class JobCreate(BaseModel):
    collection_id: int
    provider: Literal["ollama", "meta_api", "heuristic"] | None = None
    workers: int | None = Field(default=None, ge=1, le=32)
    confirm_remote: bool = False


class ProposalCreate(BaseModel):
    collection_id: int
    instruction: str = Field(default="Organize by project, document type and year", max_length=500)
    pattern: str = Field(default="{project}/{doc_type}/{year}", max_length=100)


class Decision(BaseModel):
    note: str = Field(default="", max_length=500)


class CorrectionCreate(BaseModel):
    field: Literal["doc_type", "project"]
    value: str = Field(min_length=1, max_length=80)
    when_contains: str | None = Field(
        default=None, max_length=120, description="Text that identifies similar documents; creates a rule"
    )
    note: str = Field(default="", max_length=500)


class RemoteToggle(BaseModel):
    enabled: bool
