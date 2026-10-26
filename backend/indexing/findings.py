"""Cross-document analysis: find conflicting facts about the same part across documents.

Every finding carries evidence located in the original page text, so each claim can be checked
against the source. A finding is "verified" only when every quoted line was found verbatim.
"""

import re
import sqlite3
from collections import defaultdict

from backend.storage.db import dumps, loads, now, transaction

LATEST_EXTRACTION = """
    SELECT e.* FROM extractions e
    JOIN (SELECT document_id, MAX(id) AS id FROM extractions GROUP BY document_id) l ON l.id = e.id
"""


def _locate(conn: sqlite3.Connection, document_id: int, part: str, rating: float | None) -> dict | None:
    """Find the source line that mentions `part` (and its rating, when known)."""
    rows = conn.execute(
        "SELECT page_no, text FROM pages WHERE document_id = ? ORDER BY page_no", (document_id,)
    ).fetchall()
    rating_pat = None
    if rating is not None:
        forms = {f"{rating:g}"}
        if float(rating).is_integer():
            forms |= {str(int(rating)), f"{int(rating):,}"}
        rating_pat = re.compile(r"(?<![\d,.])(" + "|".join(re.escape(f) for f in forms) + r")(?![\d,])")
    fallback = None
    for r in rows:
        for line in r["text"].splitlines():
            if part.casefold() in line.casefold():
                hit = {"page": r["page_no"], "quote": line.strip()[:400], "verified": True}
                if rating_pat is None or rating_pat.search(line):
                    return hit
                fallback = fallback or hit
    return fallback


def analyse_collection(conn: sqlite3.Connection, collection_id: int) -> int:
    rows = conn.execute(
        LATEST_EXTRACTION + " JOIN documents d ON d.id = e.document_id WHERE d.collection_id = ?",
        (collection_id,),
    ).fetchall()
    ratings: dict[str, dict[float, list[tuple[int, str]]]] = defaultdict(lambda: defaultdict(list))
    filenames = {}
    for r in rows:
        data = loads(r["data"], {})
        doc = conn.execute("SELECT filename FROM documents WHERE id = ?", (r["document_id"],)).fetchone()
        filenames[r["document_id"]] = doc["filename"]
        for comp in data.get("components", []):
            psi = comp.get("pressure_rating_psi")
            if comp.get("part_number") and psi is not None:
                ratings[comp["part_number"]][float(psi)].append((r["document_id"], r["doc_type"] or "other"))

    findings = []
    for part, by_value in sorted(ratings.items()):
        if len(by_value) < 2:
            continue
        evidence = []
        for value, docs in sorted(by_value.items()):
            for doc_id, doc_type in docs:
                loc = _locate(conn, doc_id, part, value)
                evidence.append(
                    {
                        "document_id": doc_id,
                        "filename": filenames[doc_id],
                        "doc_type": doc_type,
                        "value": value,
                        "page": loc["page"] if loc else None,
                        "quote": loc["quote"] if loc else None,
                        "verified": bool(loc),
                    }
                )
        values = ", ".join(f"{v:g} psi" for v in sorted(by_value))
        status = "verified" if all(e["verified"] for e in evidence) else "needs_review"
        findings.append(
            (
                collection_id,
                "rating_conflict",
                part,
                f"{part} has conflicting pressure ratings across {len(evidence)} documents: {values}",
                status,
                dumps(evidence),
                now(),
            )
        )

    with transaction(conn):
        conn.execute("DELETE FROM findings WHERE collection_id = ?", (collection_id,))
        conn.executemany(
            """INSERT INTO findings (collection_id, kind, key, summary, status, evidence, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            findings,
        )
    return len(findings)
