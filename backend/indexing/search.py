"""Full-text search over page text (SQLite FTS5) combined with structured extraction filters.

User input never reaches FTS5 query syntax directly: it is reduced to quoted terms, so operators
such as NEAR, column filters or unbalanced quotes cannot be injected.
"""

import re
import sqlite3

from backend.indexing.findings import LATEST_EXTRACTION
from backend.storage.db import loads

_TERM = re.compile(r"[\w.-]+", re.UNICODE)


def to_fts_query(q: str) -> str:
    terms = [t.replace('"', "") for t in _TERM.findall(q)][:20]
    return " ".join(f'"{t}"' for t in terms if t)


def search(
    conn: sqlite3.Connection,
    q: str = "",
    collection_id: int | None = None,
    doc_type: str | None = None,
    project: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    part_number: str | None = None,
    limit: int = 50,
) -> list[dict]:
    where, args = [], []
    fts = to_fts_query(q)
    base = f"""
        SELECT d.id AS document_id, d.filename, d.media_type, d.collection_id,
               x.doc_type, x.project, x.doc_date, x.title, x.data, x.provider, x.model{{extra}}
        FROM documents d
        LEFT JOIN ({LATEST_EXTRACTION}) x ON x.document_id = d.id
        {{join}}
    """
    if fts:
        sql = base.format(
            extra=", p.page_no, snippet(pages_fts, 0, '[[', ']]', ' ... ', 16) AS snippet, bm25(pages_fts) AS rank",
            join="JOIN pages p ON p.document_id = d.id JOIN pages_fts ON pages_fts.rowid = p.id",
        )
        where.append("pages_fts MATCH ?")
        args.append(fts)
    else:
        sql = base.format(extra=", NULL AS page_no, NULL AS snippet, 0 AS rank", join="")
    if collection_id is not None:
        where.append("d.collection_id = ?")
        args.append(collection_id)
    if doc_type:
        where.append("x.doc_type = ?")
        args.append(doc_type)
    if project:
        where.append("x.project = ? COLLATE NOCASE")
        args.append(project)
    if date_from:
        where.append("x.doc_date >= ?")
        args.append(date_from)
    if date_to:
        where.append("x.doc_date <= ?")
        args.append(date_to)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY rank, d.id LIMIT ?"
    args.append(max(1, min(limit, 200)) * (4 if part_number else 1))

    results, seen = [], set()
    for r in conn.execute(sql, args).fetchall():
        data = loads(r["data"], {}) or {}
        parts = [c.get("part_number") for c in data.get("components", [])]
        if part_number and part_number.strip().upper() not in parts:
            continue
        key = (r["document_id"], r["page_no"])
        if key in seen:
            continue
        seen.add(key)
        results.append(
            {
                "document_id": r["document_id"],
                "filename": r["filename"],
                "media_type": r["media_type"],
                "collection_id": r["collection_id"],
                "doc_type": r["doc_type"],
                "project": r["project"],
                "doc_date": r["doc_date"],
                "title": r["title"],
                "page": r["page_no"],
                "snippet": r["snippet"],
                "part_numbers": parts,
                "extracted_by": f"{r['provider']}:{r['model']}" if r["provider"] else None,
            }
        )
        if len(results) >= limit:
            break
    return results
