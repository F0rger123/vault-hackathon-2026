"""Per-document processing: run a provider, verify evidence, apply policy, persist the extraction."""

import re
import sqlite3
import time

from backend.core.config import Settings
from backend.providers import apply_policy, get_provider
from backend.providers.base import Provider, ProviderInfo
from backend.providers.prompting import detect_injection
from backend.providers.schema import verify_evidence
from backend.storage.db import dumps, loads, now

EXCERPT_CHARS = 700
_WORD = re.compile(r"[a-z0-9-]{3,}")


def current_policy(conn: sqlite3.Connection) -> tuple[int, list[dict]]:
    row = conn.execute("SELECT version, rules FROM policies ORDER BY version DESC LIMIT 1").fetchone()
    if not row:
        return 1, []
    return row["version"], loads(row["rules"], [])


def load_pages(conn: sqlite3.Connection, document_id: int) -> list[str]:
    rows = conn.execute("SELECT text FROM pages WHERE document_id = ? ORDER BY page_no", (document_id,)).fetchall()
    return [r["text"] for r in rows]


def load_examples(conn: sqlite3.Connection) -> list[dict]:
    """Human-labelled examples ("teach by example"), each with a short excerpt of its document."""
    rows = conn.execute("SELECT document_id, labels FROM examples ORDER BY id").fetchall()
    out = []
    for r in rows:
        text = "\n".join(load_pages(conn, r["document_id"]))
        out.append(
            {
                "document_id": r["document_id"],
                "excerpt": text[:EXCERPT_CHARS],
                "labels": loads(r["labels"], {}),
                "words": set(_WORD.findall(text.lower())),
            }
        )
    return out


def pick_examples(examples: list[dict], pages: list[str], k: int = 3) -> list[dict]:
    """Choose the k labelled examples most similar to this document (word overlap, computed locally)."""
    if not examples:
        return []
    words = set(_WORD.findall("\n".join(pages).lower()))

    def score(e: dict) -> float:
        union = len(words | e["words"]) or 1
        return len(words & e["words"]) / union

    return [{"excerpt": e["excerpt"], "labels": e["labels"]} for e in sorted(examples, key=score, reverse=True)[:k]]


def process_document(
    conn: sqlite3.Connection,
    provider: Provider,
    document_id: int,
    policy: tuple[int, list[dict]] | None = None,
    info: ProviderInfo | None = None,
    examples: list[dict] | None = None,
    lane: str | None = None,
) -> dict:
    doc = conn.execute("SELECT id, filename, media_type FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not doc:
        raise LookupError(f"document {document_id} not found")
    version, rules = policy or current_policy(conn)
    pages = load_pages(conn, document_id)
    info = info or provider.info()
    shots = pick_examples(examples or [], pages)

    started = time.perf_counter()
    extraction = provider.extract(pages, doc["filename"], rules, shots)
    extraction = apply_policy(extraction, pages, rules)
    duration_ms = int((time.perf_counter() - started) * 1000)

    evidence = verify_evidence(extraction, pages)
    verified_ratio = sum(e["verified"] for e in evidence) / len(evidence) if evidence else 0.0
    flags = detect_injection(pages)
    data = extraction.model_dump(exclude={"evidence"})
    cur = conn.execute(
        """INSERT INTO extractions (document_id, provider, model, locality, policy_version, doc_type,
               project, doc_date, title, summary, data, evidence, verified_ratio, injection_flags,
               duration_ms, created_at, lane) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            lane,
        ),
    )
    conn.execute("UPDATE documents SET status = 'processed', error = NULL WHERE id = ?", (document_id,))
    return {
        "document_id": document_id,
        "extraction_id": cur.lastrowid,
        "duration_ms": duration_ms,
        "doc_type": extraction.doc_type,
        "verified_ratio": verified_ratio,
        "evidence_count": len(evidence),
        "injection_flags": len(flags),
        "examples_used": len(shots),
        "media_type": doc["media_type"],
    }


def make_provider(settings: Settings, name: str | None = None) -> Provider:
    provider = get_provider(name or settings.provider, settings)
    # Only model-backed providers are worth caching; the rule-based baseline is faster than a file read.
    if settings.response_cache and provider.info().is_ai_model:
        from backend.providers.cache import CachingProvider

        return CachingProvider(provider, settings.data_dir / "cache")
    return provider
