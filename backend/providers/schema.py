"""Structured extraction schema shared by every provider, plus evidence verification."""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DocType = Literal[
    "engineering_drawing",
    "inspection_report",
    "contract",
    "parts_list",
    "revision_history",
    "project_memo",
    "other",
]
DOC_TYPES: tuple[str, ...] = DocType.__args__  # type: ignore[attr-defined]


class Component(BaseModel):
    part_number: str = Field(max_length=64)
    description: str | None = Field(default=None, max_length=200)
    pressure_rating_psi: float | None = None
    material: str | None = Field(default=None, max_length=80)
    quantity: int | None = None

    @field_validator("part_number")
    @classmethod
    def norm_part(cls, v: str) -> str:
        return v.strip().upper()


class EvidenceQuote(BaseModel):
    field: str = Field(max_length=64)
    quote: str = Field(max_length=400)
    page: int = 1


class Extraction(BaseModel):
    doc_type: DocType = "other"
    title: str | None = Field(default=None, max_length=200)
    project: str | None = Field(default=None, max_length=80)
    doc_date: str | None = Field(default=None, description="ISO date YYYY-MM-DD if stated")
    summary: str | None = Field(default=None, max_length=600)
    parties: list[str] = Field(default_factory=list, max_length=20)
    components: list[Component] = Field(default_factory=list, max_length=100)
    stamps: list[str] = Field(default_factory=list, max_length=20)
    evidence: list[EvidenceQuote] = Field(default_factory=list, max_length=60)

    @field_validator("doc_date")
    @classmethod
    def iso_date(cls, v: str | None) -> str | None:
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.strip()):
            return None
        return v.strip() if v else None


def json_schema() -> dict:
    return Extraction.model_json_schema()


def inline_schema() -> dict:
    """JSON schema with $defs references inlined, for APIs that reject or limit $ref."""
    schema = Extraction.model_json_schema()
    defs = schema.pop("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(dict(defs[node["$ref"].split("/")[-1]]))
            return {k: walk(v) for k, v in node.items()}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().casefold()


def verify_evidence(extraction: Extraction, pages: list[str]) -> list[dict]:
    """Mark each quote verified only if it appears verbatim (whitespace-normalised) on its page.

    A quote that appears on a different page is re-attributed to that page. Unverifiable quotes are
    kept but flagged, so the UI can separate checked evidence from model interpretation.
    """
    normalised = [_norm(p) for p in pages]
    out = []
    for ev in extraction.evidence:
        q = _norm(ev.quote)
        page = ev.page
        verified = False
        if q:
            if 1 <= page <= len(pages) and q in normalised[page - 1]:
                verified = True
            else:
                for i, text in enumerate(normalised, start=1):
                    if q in text:
                        page, verified = i, True
                        break
        out.append({"field": ev.field, "quote": ev.quote, "page": page, "verified": verified})
    return out
