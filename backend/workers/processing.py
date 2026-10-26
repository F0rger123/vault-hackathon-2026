"""Per-document processing: run a provider, verify evidence, apply policy, persist the extraction."""

import sqlite3
import time

from backend.core.config import Settings
from backend.providers import apply_policy, get_provider
from backend.providers.base import Provider
from backend.providers.prompting import detect_injection
from backend.providers.schema import verify_evidence
from backend.storage.db import dumps, loads, now


def current_policy(conn: sqlite3.Connection) -> tuple[int, list[dict]]:
    row = conn.execute("SELECT version, rules FROM policies ORDER BY version DESC LIMIT 1").fetchone()
    if not row:
        return 1, []
    return row["version"], loads(row["rules"], [])


def load_pages(conn: sqlite3.Connection, document_id: int) -> list[str]:
    rows = conn.execute("SELECT text FROM pages WHERE document_id = ? ORDER BY page_no", (document_id,)).fetchall()
    return [r["text"] for r in rows]


def process_document(
    conn: sqlite3.Connection,
    provider: Provider,
    document_id: int,
    policy: tuple[int, list[dict]] | None = None,
) -> dict:
    doc = conn.execute("SELECT id, filename FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not doc:
        raise LookupError(f"document {document_id} not found")
    version, rules = policy or current_policy(conn)
    pages = load_pages(conn, document_id)
    info = provider.info()

    started = time.perf_counter()
    extraction = provider.extract(pages, doc["filename"], rules)
    extraction = apply_policy(extraction, pages, rules)
    duration_ms = int((time.perf_counter() - started) * 1000)

    evidence = verify_evidence(extraction, pages)
    verified_ratio = sum(e["verified"] for e in evidence) / len(evidence) if evidence else 0.0
    flags = detect_injection(pages)
    data = extraction.model_dump(exclude={"evidence"})
    conn.execute(
        """INSERT INTO extractions (document_id, provider, model, locality, policy_version, doc_type,
               project, doc_date, title, summary, data, evidence, verified_ratio, injection_flags,
               duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            document_id,
            info.name,
            info.model,
            info.locality,
            version,
            extraction.doc_type,
            extraction.project,
            extraction.doc_date,
            extraction.title,
            extraction.summary,
            dumps(data),
            dumps(evidence),
            verified_ratio,
            dumps(flags),
            duration_ms,
            now(),
        ),
    )
    conn.execute("UPDATE documents SET status = 'processed', error = NULL WHERE id = ?", (document_id,))
    return {
        "document_id": document_id,
        "duration_ms": duration_ms,
        "doc_type": extraction.doc_type,
        "verified_ratio": verified_ratio,
        "injection_flags": len(flags),
    }


def make_provider(settings: Settings, name: str | None = None) -> Provider:
    return get_provider(name or settings.provider, settings)
