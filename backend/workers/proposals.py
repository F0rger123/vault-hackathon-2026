"""Organization proposals: plan, preview, approve, then export copies.

Executing an approved proposal copies originals into a new export folder. Originals and their
source locations are never moved, renamed or modified.
"""

import re
import shutil
import sqlite3

from backend.core.config import Settings
from backend.indexing.findings import LATEST_EXTRACTION
from backend.security.files import original_path, safe_join, sanitize_filename
from backend.storage.db import dumps, loads, now

PATTERN_FIELDS = {"project", "doc_type", "year"}
DEFAULT_PATTERN = "{project}/{doc_type}/{year}"
_SEGMENT = re.compile(r"[^A-Za-z0-9_-]+")


def _segment(value: str | None, fallback: str) -> str:
    cleaned = _SEGMENT.sub("_", value or "").strip("_")
    return cleaned[:60] or fallback


def build_plan(conn: sqlite3.Connection, collection_id: int, pattern: str = DEFAULT_PATTERN) -> list[dict]:
    fields = set(re.findall(r"{(\w+)}", pattern))
    # Only plain {name} fields: anything else in braces, such as a width, could make a huge string.
    leftover = re.sub(r"{\w+}", "", pattern)
    bad_braces = "{" in leftover or "}" in leftover
    if bad_braces or not fields or not fields <= PATTERN_FIELDS or ".." in pattern or pattern.startswith(("/", "\\")):
        raise ValueError(f"pattern may only use {sorted(PATTERN_FIELDS)} separated by '/'")
    rows = conn.execute(
        f"""SELECT d.id, d.filename, x.project, x.doc_type, x.doc_date FROM documents d
            LEFT JOIN ({LATEST_EXTRACTION}) x ON x.document_id = d.id
            WHERE d.collection_id = ? ORDER BY d.id""",
        (collection_id,),
    ).fetchall()
    plan = []
    for r in rows:
        values = {
            "project": _segment(r["project"], "unassigned-project"),
            "doc_type": _segment(r["doc_type"], "unclassified"),
            "year": _segment((r["doc_date"] or "")[:4], "undated"),
        }
        folder = pattern
        for name, value in values.items():
            folder = folder.replace("{" + name + "}", value)
        plan.append(
            {
                "document_id": r["id"],
                "filename": r["filename"],
                "target": f"{folder}/{sanitize_filename(r['filename'])}",
            }
        )
    return plan


def create_proposal(
    conn: sqlite3.Connection, collection_id: int, user_id: int, instruction: str, pattern: str = DEFAULT_PATTERN
) -> int:
    plan = build_plan(conn, collection_id, pattern)
    cur = conn.execute(
        """INSERT INTO proposals (collection_id, kind, instruction, plan, created_by, created_at)
           VALUES (?, 'organize_export', ?, ?, ?, ?)""",
        (collection_id, instruction[:500], dumps({"pattern": pattern, "items": plan}), user_id, now()),
    )
    return cur.lastrowid


def execute_proposal(conn: sqlite3.Connection, settings: Settings, proposal_id: int) -> dict:
    p = conn.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
    plan = loads(p["plan"], {})
    if p["kind"] == "share_pack":
        from backend.workers.share_pack import execute_share

        return execute_share(conn, settings, proposal_id, plan)
    export_root = settings.exports_dir / f"proposal-{proposal_id}"
    export_root.mkdir(parents=True, exist_ok=True)
    copied, used = 0, set()
    for item in plan["items"]:
        doc = conn.execute("SELECT stored_path, status FROM documents WHERE id = ?", (item["document_id"],)).fetchone()
        if not doc or doc["status"] == "quarantined":
            continue
        target_rel = item["target"]
        stem, dot, ext = target_rel.rpartition(".")
        n = 1
        while target_rel in used:
            n += 1
            target_rel = f"{stem}-{n}{dot}{ext}" if dot else f"{item['target']}-{n}"
        used.add(target_rel)
        target = safe_join(export_root, *target_rel.split("/"))
        source = original_path(settings.data_dir, doc["stored_path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        copied += 1
    return {"export_dir": export_root.relative_to(settings.data_dir).as_posix(), "copied": copied}
