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


ProviderName = Literal["ollama", "meta_api", "heuristic"]


class LaneSpec(BaseModel):
    provider: ProviderName
    concurrency: int = Field(default=1, ge=1, le=64)


class JobCreate(BaseModel):
    collection_id: int
    provider: ProviderName | None = None
    workers: int | None = Field(default=None, ge=1, le=64)
    lanes: list[LaneSpec] | None = Field(default=None, max_length=8, description="Run several model lanes at once")
    escalate_provider: ProviderName | None = None
    confirm_remote: bool = False


class CalibrateRequest(BaseModel):
    provider: ProviderName | None = None
    sample_size: int = Field(default=8, ge=2, le=40)
    max_concurrency: int = Field(default=8, ge=1, le=64)
    confirm_remote: bool = False


class ExampleCreate(BaseModel):
    document_id: int
    labels: dict[str, str | float | None] = Field(description="Correct values, e.g. {'doc_type': 'contract'}")
    note: str = Field(default="", max_length=500)


class ProposalCreate(BaseModel):
    collection_id: int
    instruction: str = Field(default="Organize by project, document type and year", max_length=500)
    pattern: str = Field(default="{project}/{doc_type}/{year}", max_length=100)


class LayoutRequest(BaseModel):
    instruction: str = Field(min_length=3, max_length=500)
    provider: ProviderName | None = None
    confirm_remote: bool = False


class InvestigationCreate(BaseModel):
    collection_id: int
    question: str = Field(min_length=3, max_length=500)
    provider: Literal["ollama", "meta_api", "heuristic"] | None = None
    confirm_remote: bool = False


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
