"""Organization proposals: plan, preview, approve, then export copies.

Executing an approved proposal copies originals into a new export folder. Originals and their
source locations are never moved, renamed or modified. F09.23: restricted documents are left out of exports, and a
document with approved redactions is exported as a redacted copy built from its text, never as the original.
Each copy written is listed in the result and recorded in the collection's activity feed (F10.22) with its path
inside the export folder.
"""

import re
import shutil
import sqlite3
from pathlib import Path

from backend.core.config import Settings
from backend.indexing.findings import LATEST_EXTRACTION
from backend.security import classification as cls
from backend.security.files import FileRejected, contained, original_path, safe_join, sanitize_filename
from backend.storage.db import dumps, loads, now
from backend.workers import activity

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


def execute_proposal(conn: sqlite3.Connection, settings: Settings, proposal_id: int, admin: str = "admin") -> dict:
    p = conn.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
    plan = loads(p["plan"], {})
    if p["kind"] == "classify_redact":
        from backend.agents.classifier import execute as execute_classify

        return execute_classify(conn, proposal_id, plan, admin)
    if p["kind"] == "share_pack":
        from backend.workers.share_pack import execute_share

        return execute_share(conn, settings, proposal_id, plan)
    export_root = settings.exports_dir / f"proposal-{proposal_id}"
    export_root.mkdir(parents=True, exist_ok=True)
    copied, used, items = 0, set(), []
    export_rel = export_root.relative_to(settings.data_dir).as_posix()
    for item in plan["items"]:
        doc = conn.execute(
            "SELECT stored_path, status, classification FROM main.documents WHERE id = ?", (item["document_id"],)
        ).fetchone()
        if not doc or doc["status"] == "quarantined" or doc["classification"] == "restricted":
            reason = "no longer in the collection"
            if doc:
                reason = "held by the security gate" if doc["status"] == "quarantined" else "restricted: never exported"
            items.append(
                {
                    "document_id": item["document_id"],
                    "filename": item["filename"],
                    "target": None,
                    "copied": False,
                    "reason": reason,
                }
            )
            continue
        redacted = cls.has_redactions(conn, item["document_id"])
        target_rel = item["target"]
        if redacted:
            target_rel = target_rel.rsplit(".", 1)[0] + ".redacted.pdf"
        stem, dot, ext = target_rel.rpartition(".")
        n = 1
        while target_rel in used:
            n += 1
            target_rel = f"{stem}-{n}{dot}{ext}" if dot else f"{item['target']}-{n}"
        used.add(target_rel)
        target = safe_join(export_root, *target_rel.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        if redacted:
            from backend.workers.share_pack import _write_pdf

            _write_pdf(target, item["filename"], cls.redacted_pages(conn, item["document_id"]), "this export")
        else:
            shutil.copyfile(original_path(settings.data_dir, doc["stored_path"]), target)
        copied += 1
        entry = {"document_id": item["document_id"], "filename": item["filename"], "target": target_rel, "copied": True}
        if redacted:
            entry["redacted"] = True
        items.append(entry)
        activity.record(
            conn,
            p["collection_id"],
            "Organizer",
            "copied",
            item["document_id"],
            run=f"proposal-{proposal_id}",
            filename=item["filename"],
            target=target_rel,
            export_dir=export_rel,
        )
    return {"export_dir": export_rel, "copied": copied, "items": items}


# ---------- F10.24: removing requests and the copies VAULT wrote ----------


def export_folder(settings: Settings, proposal_id: int, kind: str) -> Path:
    """The one folder an approval may have written: data/exports/proposal-N or share-N. Never anything else."""
    name = f"share-{proposal_id}" if kind == "share_pack" else f"proposal-{proposal_id}"
    return safe_join(settings.exports_dir, name)


def _refuse_originals(path: Path, settings: Settings) -> None:
    # Belt and braces: the export folder never holds originals, but a copy is removed only if it is not one.
    originals = settings.originals_dir.resolve()
    if path == originals or originals in path.parents:
        raise FileRejected("originals are never deleted")


def remove_copies(settings: Settings, proposal_id: int, kind: str, target: str | None = None) -> list[str]:
    """Delete exported copies inside this proposal's export folder and return their paths relative to it.

    With `target`, only that one copy goes. Every path is checked to resolve inside the export folder before anything
    is removed, so a link pointing at an original, or a `..` in the target, refuses the whole request.
    """
    root = export_folder(settings, proposal_id, kind)
    if not root.exists():
        return []
    if target is not None:
        path = safe_join(root, *target.replace("\\", "/").split("/"))
        files = [path] if path.is_file() else []
    else:
        files = [contained(f, [root]) for f in sorted(root.rglob("*")) if f.is_file() or f.is_symlink()]
    for f in files:
        _refuse_originals(f, settings)
    removed = []
    for f in files:
        removed.append(f.relative_to(root.resolve()).as_posix())
        f.unlink()
    # Empty folders left behind go too, deepest first, never above the export folder.
    for d in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()
    if target is None and root.exists() and not any(root.iterdir()):
        root.rmdir()
    return removed
