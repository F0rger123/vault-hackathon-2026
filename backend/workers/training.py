"""Training: grade how well VAULT reads a collection, teach it, and re-test, before trusting real data (F07.6).

What "training" means here, honestly: VAULT does not change the model's weights. It improves through two
things a person controls, and measures the effect each time:
- rules: a phrase plus the right value, published as a new policy version (corrections);
- examples: labelled documents shown to the model as guidance (teach by example).

Grading needs known right answers.
- Demo collections use the ground truth that ships with the synthetic dataset.
- Real collections use the documents a person has labelled as examples.

Graded documents are split into a practice set and a held-out set. Mistakes are shown, and rules are
suggested, from the practice set only. The held-out score is the honest one: it is measured on documents
nobody corrected.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from functools import lru_cache
from pathlib import Path

from backend.storage.db import dumps, loads, now
from backend.workers.rule_suggestions import FIELDS, pick_rules

ROOT = Path(__file__).resolve().parents[2]
MANIFESTS = (ROOT / "data" / "synthetic" / "v2" / "manifest.json", ROOT / "data" / "synthetic" / "v1" / "manifest.json")
GRADED_FIELDS = ("doc_type", "project", "doc_date")
HISTORY_KEEP = 20
# A collection is called ready when the held-out score reaches these rates (and planted conflicts are found).
READY = {"doc_type": 0.9, "project": 0.85}


@lru_cache(maxsize=1)
def _demo_truth() -> dict[str, dict]:
    truth: dict[str, dict] = {}
    for path in MANIFESTS:
        if path.is_file():
            for d in json.loads(path.read_text(encoding="utf-8"))["documents"]:
                truth.setdefault(d["filename"], d)
    return truth


def _demo_anomalies() -> list[dict]:
    for path in MANIFESTS:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))["anomalies"]
    return []


def _split_for(document_id: int) -> str:
    # Stable, roughly 30% held out, independent of upload order.
    return "heldout" if int(hashlib.sha256(str(document_id).encode()).hexdigest(), 16) % 10 in (2, 5, 8) else "train"


def _graded_documents(conn: sqlite3.Connection, collection_id: int) -> tuple[str, list[dict]]:
    """(source, documents with their right answers, latest reading and text)."""
    col = conn.execute("SELECT is_demo FROM collections WHERE id = ?", (collection_id,)).fetchone()
    rows = conn.execute(
        """SELECT d.id, d.filename, e.doc_type, e.project, e.doc_date, e.provider, e.model
           FROM documents d LEFT JOIN extractions e ON e.id =
             (SELECT MAX(id) FROM extractions WHERE document_id = d.id)
           WHERE d.collection_id = ? ORDER BY d.id""",
        (collection_id,),
    ).fetchall()
    out = []
    if col and col["is_demo"]:
        source, truth = "demo ground truth", _demo_truth()
        for r in rows:
            t = truth.get(r["filename"])
            if t:
                out.append({**dict(r), "truth": {f: t.get(f) for f in GRADED_FIELDS}, "split": t["split"]})
    else:
        source = "your labelled examples"
        labels = {
            x["document_id"]: loads(x["labels"], {})
            for x in conn.execute(
                "SELECT document_id, labels FROM examples WHERE document_id IN "
                "(SELECT id FROM documents WHERE collection_id = ?)",
                (collection_id,),
            )
        }
        for r in rows:
            if r["id"] in labels:
                out.append({**dict(r), "truth": labels[r["id"]], "split": _split_for(r["id"])})
    return source, out


def _same(a, b) -> bool:
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def grade(conn: sqlite3.Connection, collection_id: int) -> dict:
    source, docs = _graded_documents(conn, collection_id)
    stats = {s: {f: [0, 0] for f in GRADED_FIELDS} for s in ("train", "heldout")}
    mistakes, readers = [], set()
    for d in docs:
        if d["doc_type"] is None and d["provider"] is None:
            continue  # not read yet
        readers.add(f"{d['provider']}:{d['model']}")
        for f in GRADED_FIELDS:
            want = d["truth"].get(f)
            if not want:
                continue
            ok = _same(d.get(f), want)
            stats[d["split"]][f][0] += ok
            stats[d["split"]][f][1] += 1
            if not ok and d["split"] == "train":
                mistakes.append(
                    {"document_id": d["id"], "filename": d["filename"], "field": f, "got": d.get(f), "expected": want}
                )
    fields = {
        s: {f: {"correct": c, "total": n, "rate": round(c / n, 3) if n else None} for f, (c, n) in per.items()}
        for s, per in stats.items()
    }
    conflicts = _conflict_check(conn, collection_id) if source == "demo ground truth" else None
    return {
        "collection_id": collection_id,
        "source": source,
        "graded_documents": len(docs),
        "read_documents": stats["train"]["doc_type"][1] + stats["heldout"]["doc_type"][1],
        "read_by": sorted(readers),
        "fields": fields,
        "conflicts": conflicts,
        "mistakes": mistakes[:200],
        "readiness": _readiness(fields, conflicts, len(docs)),
        "graded_at": now(),
    }


def _conflict_check(conn: sqlite3.Connection, collection_id: int) -> dict:
    filenames = {
        r["filename"] for r in conn.execute("SELECT filename FROM documents WHERE collection_id = ?", (collection_id,))
    }
    planted = {
        (a["kind"], a["part_number"])
        for a in _demo_anomalies()
        # documents[0] is the file that carries the planted problem; the rest only mention the part.
        if a["kind"].endswith("_conflict") and a["documents"] and a["documents"][0] in filenames
    }
    found = {
        (r["kind"], r["key"])
        for r in conn.execute("SELECT kind, key FROM findings WHERE collection_id = ?", (collection_id,))
        if r["kind"].endswith("_conflict")
    }
    return {"planted": len(planted), "found": len(planted & found), "false_alarms": len(found - planted)}


def _readiness(fields: dict, conflicts: dict | None, graded: int) -> dict:
    held = fields["heldout"]
    if graded < 10:
        return {"ready": False, "reason": "Label at least 10 documents so there is something to grade against."}
    missing = [f for f, need in READY.items() if (held[f]["rate"] or 0) < need]
    if missing:
        names = ", ".join(f.replace("doc_type", "document type") for f in missing)
        return {"ready": False, "reason": f"Held-out {names} below the target. Teach it and re-test."}
    if conflicts and (conflicts["found"] < conflicts["planted"] or conflicts["false_alarms"]):
        return {"ready": False, "reason": "Not every planted conflict was found without false alarms yet."}
    return {"ready": True, "reason": "Held-out scores meet the targets on documents nobody corrected."}


def save_grade(conn: sqlite3.Connection, report: dict) -> list[dict]:
    """Keep a short history so the screen can show before and after."""
    key = f"training:{report['collection_id']}"
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (key,)).fetchone()
    history = loads(row["value"], []) if row else []
    history.append(
        {
            "graded_at": report["graded_at"],
            "read_by": report["read_by"],
            "heldout": {f: v["rate"] for f, v in report["fields"]["heldout"].items()},
            "train": {f: v["rate"] for f, v in report["fields"]["train"].items()},
            "conflicts": report["conflicts"],
            "rules": _rule_count(conn, report["collection_id"]),
        }
    )
    history = history[-HISTORY_KEEP:]
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, dumps(history)),
    )
    return history


def history(conn: sqlite3.Connection, collection_id: int) -> list[dict]:
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (f"training:{collection_id}",)).fetchone()
    return loads(row["value"], []) if row else []


def _rule_count(conn: sqlite3.Connection, collection_id: int) -> int:
    row = conn.execute("SELECT rules FROM policies ORDER BY version DESC LIMIT 1").fetchone()
    rules = loads(row["rules"], []) if row else []
    return sum(r.get("collection_id") in (None, collection_id) for r in rules)


def suggest_rules(conn: sqlite3.Connection, collection_id: int) -> list[dict]:
    """Rules that would fix practice-set mistakes without breaking any practice document."""
    _, docs = _graded_documents(conn, collection_id)
    train = []
    for d in docs:
        if d["split"] != "train" or d["provider"] is None:
            continue
        text = "\n".join(
            r["text"] for r in conn.execute("SELECT text FROM pages WHERE document_id = ? ORDER BY page_no", (d["id"],))
        )
        if all(d["truth"].get(f) for f in FIELDS):
            train.append(
                {
                    "document_id": d["id"],
                    "text": text,
                    "truth": {f: d["truth"][f] for f in FIELDS},
                    "got": {f: d.get(f) for f in FIELDS},
                }
            )
    existing = {
        (r.get("field"), str(r.get("when_contains", "")).casefold())
        if r.get("collection_id") in (None, collection_id)
        else None
        for r in loads(
            (conn.execute("SELECT rules FROM policies ORDER BY version DESC LIMIT 1").fetchone() or {"rules": "[]"})[
                "rules"
            ],
            [],
        )
    }
    return [r for r in pick_rules(train) if (r["field"], r["when_contains"].casefold()) not in existing]
