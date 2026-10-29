"""The brain as a graph: documents joined to the projects, parts, markings and document types they mention (F07.8).

The interface draws this as a map a person can move around and click. Every edge comes from a document's latest
checked reading, so the picture shows what VAULT actually knows, not a guess. Conflicting parts are marked, so the
problems stand out. Sizes are capped so a very large collection still draws quickly; the counts say what was left
out.
"""

from __future__ import annotations

import sqlite3
from collections import Counter

from backend.storage.db import loads
from backend.workers.brain import _marking

MAX_DOCUMENTS = 400
MAX_PARTS = 60


def graph(conn: sqlite3.Connection, collection_id: int) -> dict:
    rows = conn.execute(
        """SELECT d.id, d.filename, x.doc_type, x.project, x.data
           FROM documents d JOIN extractions x ON x.id = (SELECT MAX(id) FROM extractions WHERE document_id = d.id)
           WHERE d.collection_id = ? ORDER BY d.id""",
        (collection_id,),
    ).fetchall()
    conflicted = {
        r["key"]
        for r in conn.execute(
            "SELECT key FROM findings WHERE collection_id = ? AND kind LIKE '%conflict'", (collection_id,)
        )
    }
    part_counts: Counter = Counter()
    parsed = []
    for r in rows:
        data = loads(r["data"], {})
        parts = sorted({c.get("part_number") for c in data.get("components") or [] if c.get("part_number")})
        marks = sorted({m for m in (_marking(s) for s in data.get("stamps") or []) if m})
        part_counts.update(parts)
        parsed.append((r, parts, marks))
    # Parts named in only one document add clutter without connecting anything, unless they are in conflict.
    keep_parts = {p for p, n in part_counts.most_common(MAX_PARTS) if n >= 2 or p in conflicted} | (
        conflicted & set(part_counts)
    )

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def node(nid: str, kind: str, label: str, **extra) -> str:
        if nid not in nodes:
            nodes[nid] = {"id": nid, "kind": kind, "label": label, "weight": 0, **extra}
        nodes[nid]["weight"] += 1
        return nid

    for r, parts, marks in parsed[:MAX_DOCUMENTS]:
        doc = node(f"doc:{r['id']}", "document", r["filename"], document_id=r["id"], doc_type=r["doc_type"])
        edges.append(
            {"source": doc, "target": node(f"type:{r['doc_type'] or 'other'}", "doc_type", r["doc_type"] or "other")}
        )
        if r["project"]:
            edges.append({"source": doc, "target": node(f"project:{r['project'].casefold()}", "project", r["project"])})
        for p in parts:
            if p in keep_parts:
                edges.append({"source": doc, "target": node(f"part:{p}", "part", p, conflict=p in conflicted)})
        for m in marks:
            edges.append({"source": doc, "target": node(f"mark:{m.casefold()}", "marking", m)})
    return {
        "collection_id": collection_id,
        "nodes": list(nodes.values()),
        "edges": edges,
        "documents_total": len(rows),
        "documents_shown": min(len(rows), MAX_DOCUMENTS),
    }
