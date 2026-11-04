"""Keeper's Classifier helper (F09.23): suggests a label and the spans to redact. It never applies either.

Plain rules, run locally, so it can read documents that must never reach a model. What it looks for:

- handling markings already printed on the page (CONFIDENTIAL, PROPRIETARY, INTERNAL USE ONLY, and the export and
  handling markings the security agent treats as restricted);
- pricing and contract values (amounts of money; contracts are confidential by default);
- personal details: email addresses, phone numbers, ID numbers and people's names (after "Contact:", "Attn:",
  "Signed by:" and similar, and the people a document's reading lists as parties).

Each suggestion becomes one `classify_redact` proposal. An administrator approves it in Approvals, and only then is
the label set and the redactions hidden (backend/security/classification.py). The plan never repeats a hidden value:
each span has its page, position, kind and a short hint.
"""

from __future__ import annotations

import re
import sqlite3

from backend.agents.security_agent import _INTERNAL, _RESTRICTED
from backend.ingest.media import is_media
from backend.security import classification as cls
from backend.storage.db import dumps, loads, now
from backend.workers.share_pack import _PATTERNS as SHARE_PATTERNS

HELPER = "Classifier"
# The same patterns as share packs (F08.6), so both features hide the same things.
_PATTERNS = {kind: SHARE_PATTERNS[kind] for kind in ("emails", "id_numbers", "phone_numbers", "money")}
# A person's name after a label: "Contact: Jane Doe", "Signed by Dr. Omar Reyes".
_NAME_AFTER = re.compile(
    r"\b(?i:contact|attn|attention|signed(?:\s+by)?|prepared\s+by|approved\s+by|inspector|engineer|witness|"
    r"client\s+contact|project\s+manager)\s*[:\-]?\s+"
    r"((?:(?:Dr|Mr|Mrs|Ms)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z'-]+){1,2})",
)
_COMPANY = re.compile(
    r"\b(?:inc|ltd|llc|plc|gmbh|corp|corporation|co|company|group|industries|engineering|valves|systems|"
    r"fabrication|works|partners|holdings|services|solutions|limited|labs?)\b\.?",
    re.I,
)
PRICED_TYPES = {"contract"}


def _person_like(name: str) -> bool:
    words = name.split()
    return 2 <= len(words) <= 4 and not _COMPANY.search(name) and all(w[:1].isupper() for w in words)


def _spans(text: str, people: list[str]) -> list[dict]:
    found: list[dict] = []
    for kind, rx in _PATTERNS.items():
        found += [{"start": m.start(), "end": m.end(), "kind": kind} for m in rx.finditer(text)]
    found += [{"start": m.start(1), "end": m.end(1), "kind": "people"} for m in _NAME_AFTER.finditer(text)]
    for name in sorted({p for p in people if _person_like(p)}, key=len, reverse=True):
        found += [
            {"start": m.start(), "end": m.end(), "kind": "people"}
            for m in re.finditer(rf"\b{re.escape(name)}\b", text, re.I)
        ]
    # Keep the first, longest span where two overlap.
    out, last_end = [], -1
    for s in sorted(found, key=lambda s: (s["start"], -s["end"])):
        if s["start"] >= last_end:
            out.append(s)
            last_end = s["end"]
    return out


def suggest(conn: sqlite3.Connection, document_id: int) -> dict | None:
    """One document's suggested label, the reason in plain words, and the spans to redact. Reads the real text."""
    d = conn.execute(
        """SELECT d.id, d.filename, d.media_type, d.classification, x.doc_type, x.data FROM main.documents d
           LEFT JOIN main.extractions x ON x.id = (SELECT MAX(id) FROM main.extractions WHERE document_id = d.id)
           WHERE d.id = ?""",
        (document_id,),
    ).fetchone()
    if d is None:
        return None
    item = {"document_id": d["id"], "filename": d["filename"], "current": cls.level(d["classification"])}
    if is_media(d["media_type"]):
        return {
            **item,
            "suggested": item["current"],
            "reason": "A photo, video or sound file: VAULT cannot read it, so its label is left as it is.",
            "markers": [],
            "redactions": [],
        }
    pages = conn.execute(
        "SELECT page_no, text FROM main.pages WHERE document_id = ? ORDER BY page_no", (document_id,)
    ).fetchall()
    text = "\n".join(p["text"] for p in pages)
    data = loads(d["data"], {}) or {}
    people = [str(p) for p in data.get("parties") or [] if isinstance(p, str)]

    done = {
        (r["page_no"], r["start"], r["end"])
        for r in conn.execute(
            "SELECT page_no, start, end FROM main.redactions WHERE document_id = ? "
            "AND status IN ('proposed', 'applied')",
            (document_id,),
        )
    }
    redactions = []
    for p in pages:
        for s in _spans(p["text"], people):
            if (p["page_no"], s["start"], s["end"]) in done:
                continue
            value = p["text"][s["start"] : s["end"]]
            redactions.append(
                {
                    "page_no": p["page_no"],
                    "start": s["start"],
                    "end": s["end"],
                    "kind": s["kind"],
                    "label": cls.label(s["kind"]),
                    "hint": cls.hint(value),
                }
            )
    kinds = {r["kind"] for r in redactions}
    restricted = sorted({m.group(0).upper() for m in _RESTRICTED.finditer(text)})
    marked = sorted({m.group(0).upper() for m in _INTERNAL.finditer(text)})
    if restricted:
        level, reason = "restricted", f"Marked {', '.join(restricted)}: administrators only"
    elif marked:
        level, reason = "confidential", f"Marked {', '.join(marked)}"
    elif "money" in kinds or d["doc_type"] in PRICED_TYPES:
        level, reason = "confidential", "Holds pricing or contract values"
    elif kinds & {"emails", "phone_numbers", "id_numbers", "people"}:
        level, reason = "internal", "Holds people's names or contact details"
    else:
        level, reason = "internal", "Nothing sensitive found; internal is the default"
    # Never suggest lowering a label someone already set.
    if d["classification"] and cls.RANK[d["classification"]] > cls.RANK[level]:
        level, reason = d["classification"], f"Kept {d['classification']}, as already labelled"
    return {**item, "suggested": level, "reason": reason, "markers": restricted + marked, "redactions": redactions}


def plan(conn: sqlite3.Connection, document_ids: list[int], level: str | None = None, why: str | None = None) -> dict:
    """Suggestions for several documents. `level`, when a person asked for one, raises the label to at least that."""
    items = []
    for doc_id in document_ids:
        s = suggest(conn, doc_id)
        if s is None:
            continue
        if level in cls.RANK and cls.RANK[level] > cls.RANK[s["suggested"]]:
            s["suggested"] = level
            s["reason"] = (why or f"You asked for {level}") + f"; the helper found: {s['reason'].lower()}"
        items.append(s)
    changed = [i for i in items if i["suggested"] != i["current"] or i["redactions"]]
    return {
        "helper": HELPER,
        "level": level if level in cls.RANK else None,
        "items": items,
        "summary": {
            "documents": len(items),
            "relabelled": sum(1 for i in items if i["suggested"] != i["current"]),
            "redactions": sum(len(i["redactions"]) for i in items),
            "changes": len(changed),
        },
    }


def create_proposal(
    conn: sqlite3.Connection,
    collection_id: int,
    user_id: int,
    document_ids: list[int],
    instruction: str,
    level: str | None = None,
) -> int:
    """Store the suggestions as a pending proposal, and each span as a proposed redaction (nothing hidden yet)."""
    p = plan(conn, document_ids, level, instruction or None)
    cur = conn.execute(
        """INSERT INTO proposals (collection_id, kind, instruction, plan, created_by, created_at)
           VALUES (?, 'classify_redact', ?, ?, ?, ?)""",
        (collection_id, (instruction or "Classify and redact")[:500], dumps(p), user_id, now()),
    )
    pid = cur.lastrowid
    for item in p["items"]:
        texts = {
            r["page_no"]: r["text"]
            for r in conn.execute("SELECT page_no, text FROM main.pages WHERE document_id = ?", (item["document_id"],))
        }
        for r in item["redactions"]:
            value = texts[r["page_no"]][r["start"] : r["end"]]
            row = conn.execute(
                "INSERT INTO redactions (document_id, page_no, start, end, kind, value_sha, status, proposal_id, "
                "created_at) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)",
                (item["document_id"], r["page_no"], r["start"], r["end"], r["kind"], cls.value_sha(value), pid, now()),
            )
            r["id"] = row.lastrowid
    conn.execute("UPDATE proposals SET plan = ? WHERE id = ?", (dumps(p), pid))
    return pid


def execute(conn: sqlite3.Connection, proposal_id: int, plan_: dict, admin: str) -> dict:
    """Approve: set each suggested label and turn the proposal's redactions on. Re-checks each document exists."""
    labelled, applied = 0, 0
    for item in plan_.get("items", []):
        level = item.get("suggested")
        if level not in cls.RANK:
            continue
        cur = conn.execute(
            "UPDATE main.documents SET classification = ?, classification_reason = ?, classification_set_by = 'agent', "
            "classification_by_user = ?, classification_set_at = ? WHERE id = ?",
            (level, str(item.get("reason", ""))[:300], admin, now(), item["document_id"]),
        )
        labelled += cur.rowcount
    applied = conn.execute(
        "UPDATE main.redactions SET status = 'applied', decided_by = ?, decided_at = ? "
        "WHERE proposal_id = ? AND status = 'proposed'",
        (admin, now(), proposal_id),
    ).rowcount
    return {"copied": 0, "labelled": labelled, "redactions": applied}


def reject(conn: sqlite3.Connection, proposal_id: int, admin: str) -> None:
    conn.execute(
        "UPDATE main.redactions SET status = 'rejected', decided_by = ?, decided_at = ? "
        "WHERE proposal_id = ? AND status = 'proposed'",
        (admin, now(), proposal_id),
    )
