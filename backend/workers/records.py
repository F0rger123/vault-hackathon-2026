"""Export a collection's extractions as a table: one row per part, each with its source document and page (F08.5).

This is the "structured database" step of the vision: unstructured files become rows that a spreadsheet or another
database can load. Rows come from each document's latest extraction, so corrections and re-runs are reflected.
Nothing is written on the server; the caller downloads the result.

Values come from untrusted documents, so CSV cells that a spreadsheet would run as a formula are prefixed with a
single quote (the OWASP guidance for CSV injection).
"""

from __future__ import annotations

import csv
import io
import sqlite3

from backend.storage.db import loads

COLUMNS = [
    "document_id",
    "filename",
    "sha256",
    "doc_type",
    "project",
    "doc_date",
    "title",
    "part_number",
    "description",
    "material",
    "pressure_rating_psi",
    "quantity",
    "evidence_page",
    "evidence_quote",
    "evidence_verified",
    "provider",
    "model",
    "locality",
]
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def collection_records(conn: sqlite3.Connection, collection_id: int) -> list[dict]:
    """Rows for every processed document in the collection. A document with no parts still gets one row."""
    docs = conn.execute(
        """SELECT d.id, d.filename, d.sha256, x.provider, x.model, x.locality, x.data, x.evidence
           FROM documents d
           JOIN extractions x ON x.id = (SELECT MAX(id) FROM extractions WHERE document_id = d.id)
           WHERE d.collection_id = ? ORDER BY d.id""",
        (collection_id,),
    ).fetchall()
    rows = []
    for d in docs:
        data = loads(d["data"], {})
        evidence = loads(d["evidence"], [])
        base = {
            "document_id": d["id"],
            "filename": d["filename"],
            "sha256": d["sha256"],
            "doc_type": data.get("doc_type"),
            "project": data.get("project"),
            "doc_date": data.get("doc_date"),
            "title": data.get("title"),
            "provider": d["provider"],
            "model": d["model"],
            "locality": d["locality"],
        }
        components = data.get("components") or [{}]
        for comp in components:
            part = comp.get("part_number")
            rows.append({**base, **_component(comp), **_evidence_for(part, evidence)})
    return rows


def _component(comp: dict) -> dict:
    return {k: comp.get(k) for k in ("part_number", "description", "material", "pressure_rating_psi", "quantity")}


def _evidence_for(part: str | None, evidence: list[dict]) -> dict:
    """The best quote for a part: a verified quote about that part first, then any quote naming it."""
    if part:
        mine = [e for e in evidence if str(e.get("field", "")).startswith(f"components.{part}")]
        mine += [e for e in evidence if part in str(e.get("quote", "")) and e not in mine]
        mine.sort(key=lambda e: not e.get("verified"))
        if mine:
            e = mine[0]
            return {
                "evidence_page": e.get("page"),
                "evidence_quote": e.get("quote"),
                "evidence_verified": bool(e.get("verified")),
            }
    return {"evidence_page": None, "evidence_quote": None, "evidence_verified": None}


def _cell(value) -> str:
    if value is None:
        return ""
    text = str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(COLUMNS)
    for row in rows:
        writer.writerow([_cell(row.get(c)) for c in COLUMNS])
    return buf.getvalue()
