"""The collection brain: what VAULT knows about one collection, what people taught it, and what it still needs
to ask (F07.7).

Each collection has its own brain. Nothing taught in one collection is used in another, so a nuclear division and
a retail division can share one VAULT and the same local models without their knowledge mixing.

Three kinds of knowledge, all written by people:
- meanings: "QA-7 stamp" means "approved by the quality team";
- instructions: "Treat a red REVISED stamp as a revision request";
- rules and labelled examples (corrections, teach by example), now scoped to the collection.

Meanings and instructions go into the model's prompt as guidance from this organization. Rules still override fields
after reading. No model weights change: the brain is data the next reading uses, and Training measures the effect.

The gap finder reads the profile and asks a person about what VAULT cannot settle alone: markings with no known
meaning, abbreviations that keep appearing, documents it could only call "other", documents with no project, and
quotes it could not find on the page. Each answer goes back into the brain.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from collections import Counter

from backend.providers.schema import DOC_TYPES
from backend.storage.db import dumps, loads, now
from backend.workers.corrections import record_correction

KINDS = ("meaning", "instruction")
MAX_TEXT = 500
MAX_KNOWLEDGE_IN_PROMPT = 40
_ACRONYM = re.compile(r"\b[A-Z]{2,5}\b")
_WORD = re.compile(r"\b[A-Za-z]{2,}\b")
# Abbreviations every reader knows, or that VAULT already understands, so they are never asked about.
_KNOWN = {
    "PSI",
    "PDF",
    "QA",
    "QC",
    "PO",
    "BOM",
    "CSV",
    "ID",
    "NO",
    "REV",
    "DWG",
    "PASS",
    "FAIL",
    "OK",
    "NA",
    "TBD",
    "THE",
    "AND",
    "FOR",
    "USE",
    "ONLY",
    "APPROVED",
    "REJECTED",
    "RELEASED",
    "VOID",
    "DATE",
    "PAGE",
    "SHEET",
    "NOTE",
    "ISO",
    "ASME",
    "ANSI",
    "API",
    "USA",
    "UK",
    "EU",
    "AM",
    "PM",
    "MM",
    "IN",
    "FT",
    "LB",
    "KG",
    "TO",
    "OF",
    "BY",
}


def knowledge(conn: sqlite3.Connection, collection_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT k.id, k.kind, k.term, k.text, k.source, k.created_at, u.username AS created_by
           FROM knowledge k LEFT JOIN users u ON u.id = k.created_by
           WHERE k.collection_id = ? AND k.retired_at IS NULL ORDER BY k.id""",
        (collection_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def add_knowledge(
    conn: sqlite3.Connection,
    collection_id: int,
    user_id: int | None,
    kind: str,
    term: str | None,
    text: str,
    source: str = "person",
) -> dict:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    text = " ".join(text.split())[:MAX_TEXT]
    term = " ".join((term or "").split())[:120] or None
    if not text or (kind == "meaning" and not term):
        raise ValueError("a meaning needs the term and what it means")
    # Teaching the same term again replaces the old meaning, so the brain never holds two answers.
    if kind == "meaning":
        conn.execute(
            "UPDATE knowledge SET retired_at = ? WHERE collection_id = ? AND kind = 'meaning' "
            "AND lower(term) = lower(?) AND retired_at IS NULL",
            (now(), collection_id, term),
        )
    cur = conn.execute(
        "INSERT INTO knowledge (collection_id, kind, term, text, source, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (collection_id, kind, term, text, source, user_id, now()),
    )
    return {"id": cur.lastrowid, "kind": kind, "term": term, "text": text, "source": source}


def retire_knowledge(conn: sqlite3.Connection, collection_id: int, knowledge_id: int) -> bool:
    cur = conn.execute(
        "UPDATE knowledge SET retired_at = ? WHERE id = ? AND collection_id = ? AND retired_at IS NULL",
        (now(), knowledge_id, collection_id),
    )
    return cur.rowcount == 1


def prompt_guidance(conn: sqlite3.Connection, collection_id: int) -> list[dict]:
    """The collection's meanings and instructions, in the shape the prompt builder renders as guidance."""
    out = []
    for k in knowledge(conn, collection_id)[-MAX_KNOWLEDGE_IN_PROMPT:]:
        out.append({"meaning": k["term"], "is": k["text"]} if k["kind"] == "meaning" else {"instruction": k["text"]})
    return out


def scoped_rules(rules: list[dict], collection_id: int) -> list[dict]:
    """Rules taught in this collection, plus older rules that were taught before rules had a collection."""
    return [r for r in rules if r.get("collection_id") in (None, collection_id)]


def _latest(conn: sqlite3.Connection, collection_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """SELECT d.id, d.filename, d.media_type, x.doc_type, x.project, x.doc_date, x.data, x.evidence,
                  x.verified_ratio, x.provider, x.model
           FROM documents d LEFT JOIN extractions x ON x.id = (SELECT MAX(id) FROM extractions WHERE document_id = d.id)
           WHERE d.collection_id = ? ORDER BY d.id""",
        (collection_id,),
    ).fetchall()


def profile(conn: sqlite3.Connection, collection_id: int) -> dict:
    """What the brain holds: counts, the main subjects, what people taught, and how sure the reading is."""
    rows = _latest(conn, collection_id)
    read = [r for r in rows if r["provider"]]
    types, projects, parts, parties, stamps = Counter(), Counter(), Counter(), Counter(), Counter()
    dates = []
    for r in read:
        data = loads(r["data"], {})
        types[r["doc_type"] or "other"] += 1
        if r["project"]:
            projects[r["project"]] += 1
        if r["doc_date"]:
            dates.append(r["doc_date"])
        for c in data.get("components") or []:
            parts[c.get("part_number")] += 1
        for p in data.get("parties") or []:
            parties[p] += 1
        for s in data.get("stamps") or []:
            stamps[_marking(s)] += 1
    taught = knowledge(conn, collection_id)
    rules = scoped_rules(_policy_rules(conn), collection_id)
    examples = conn.execute(
        "SELECT COUNT(*) FROM examples WHERE document_id IN (SELECT id FROM documents WHERE collection_id = ?)",
        (collection_id,),
    ).fetchone()[0]
    verified = [r["verified_ratio"] for r in read if r["verified_ratio"] is not None]
    return {
        "collection_id": collection_id,
        "documents": len(rows),
        "read": len(read),
        "read_by": sorted({f"{r['provider']}:{r['model']}" for r in read}),
        "doc_types": dict(types.most_common()),
        "projects": [{"name": k, "documents": v} for k, v in projects.most_common(30)],
        "parts": [{"name": k, "documents": v} for k, v in parts.most_common(30) if k],
        "parties": [{"name": k, "documents": v} for k, v in parties.most_common(20)],
        "markings": [{"name": k, "documents": v} for k, v in stamps.most_common(20) if k],
        "date_range": [min(dates), max(dates)] if dates else None,
        "quotes_verified": round(sum(verified) / len(verified), 3) if verified else None,
        "taught": {
            "meanings": sum(k["kind"] == "meaning" for k in taught),
            "instructions": sum(k["kind"] == "instruction" for k in taught),
            "rules": len(rules),
            "examples": examples,
        },
        "knowledge": taught,
    }


def _policy_rules(conn: sqlite3.Connection) -> list[dict]:
    row = conn.execute("SELECT rules FROM policies ORDER BY version DESC LIMIT 1").fetchone()
    return loads(row["rules"], []) if row else []


def _marking(stamp: str) -> str:
    """The marking itself, without the date or signature that follows it ("APPROVED 2024-03-01 J. Lee")."""
    words = re.split(r"\s+", (stamp or "").strip())
    head = [w for w in words[:3] if not re.search(r"\d{2,}", w)]
    return " ".join(head)[:40].upper()


def _gap_id(*parts) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def gaps(conn: sqlite3.Connection, collection_id: int, limit: int = 12) -> list[dict]:
    """Questions VAULT needs a person to answer, most useful first. Answered questions do not come back."""
    rows = [r for r in _latest(conn, collection_id) if r["provider"]]
    taught = knowledge(conn, collection_id)
    known_terms = {(k["term"] or "").casefold() for k in taught if k["kind"] == "meaning"}
    skipped = _skipped(conn, collection_id)
    out: list[dict] = []

    # Markings that recur but have no meaning yet: the "this stamp means Department A" case.
    stamps: Counter = Counter()
    for r in rows:
        for s in loads(r["data"], {}).get("stamps") or []:
            stamps[_marking(s)] += 1
    for mark, n in stamps.most_common():
        if mark and n >= 2 and mark.casefold() not in known_terms:
            out.append(_gap("marking", mark, f'What does the marking "{mark}" mean? It appears on {n} documents.', n))

    # Abbreviations that keep coming up and nobody has explained.
    acronyms: Counter = Counter()
    ordinary: set[str] = set()
    for r in rows:
        text = " ".join(
            p["text"] for p in conn.execute("SELECT text FROM pages WHERE document_id = ? LIMIT 3", (r["id"],))
        )
        acronyms.update(set(_ACRONYM.findall(text)) - _KNOWN)
        # A word that also appears in normal case ("Parts list") is a heading in capitals, not an abbreviation.
        ordinary.update(w.casefold() for w in _WORD.findall(text) if not w.isupper())
    terms = [(t, n) for t, n in acronyms.most_common(30) if n >= 3 and t.casefold() not in ordinary | known_terms]
    for term, n in terms[:8]:
        out.append(_gap("term", term, f'What does "{term}" stand for here? It is used in {n} documents.', n))

    # Documents VAULT could not place, or placed without a project.
    for r in rows:
        if (r["doc_type"] or "other") == "other" and not r["media_type"].startswith("image/"):
            out.append(
                _gap("doc_type", r["filename"], f'What kind of document is "{r["filename"]}"?', 2, r["id"], DOC_TYPES)
            )
        elif not r["project"]:
            out.append(_gap("project", r["filename"], f'Which project does "{r["filename"]}" belong to?', 1, r["id"]))
        if r["verified_ratio"] is not None and r["verified_ratio"] < 0.5 and loads(r["evidence"], []):
            out.append(
                _gap(
                    "check",
                    r["filename"],
                    f'Most quotes VAULT took from "{r["filename"]}" are not on the page. Is its reading right?',
                    1.5,
                    r["id"],
                )
            )
    out = [g for g in out if g["id"] not in skipped]
    # Take turns between kinds of question, most widespread first within each, so one kind never fills the list.
    by_kind: dict[str, list[dict]] = {}
    for g in sorted(out, key=lambda g: -g["weight"]):
        by_kind.setdefault(g["kind"], []).append(g)
    mixed = []
    while any(by_kind.values()):
        for kind in ("marking", "doc_type", "term", "check", "project"):
            if by_kind.get(kind):
                mixed.append(by_kind[kind].pop(0))
    return mixed[:limit]


def _gap(kind, subject, question, weight, document_id=None, choices=None) -> dict:
    return {
        "id": _gap_id(kind, subject, document_id),
        "kind": kind,
        "subject": subject,
        "question": question,
        "document_id": document_id,
        "choices": list(choices) if choices else None,
        "weight": weight,
    }


def _skipped(conn: sqlite3.Connection, collection_id: int) -> set[str]:
    row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (f"brain-skip:{collection_id}",)).fetchone()
    return set(loads(row["value"], [])) if row else set()


def skip_gap(conn: sqlite3.Connection, collection_id: int, gap_id: str) -> None:
    ids = sorted(_skipped(conn, collection_id) | {gap_id})[-500:]
    conn.execute(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (f"brain-skip:{collection_id}", dumps(ids)),
    )


def find_gap(conn: sqlite3.Connection, collection_id: int, gap_id: str) -> dict | None:
    """Answers are only accepted for questions VAULT is asking right now, never for made-up subjects."""
    return next((g for g in gaps(conn, collection_id, limit=500) if g["id"] == gap_id), None)


def answer_gap(conn: sqlite3.Connection, collection_id: int, user_id: int | None, gap: dict, answer: str) -> dict:
    """Put a person's answer where the next reading will use it."""
    answer = " ".join(answer.split())[:MAX_TEXT]
    if not answer:
        raise ValueError("the answer is empty")
    if gap["kind"] in ("marking", "term"):
        saved = add_knowledge(conn, collection_id, user_id, "meaning", gap["subject"], answer, source="question")
        return {"saved_as": "meaning", "knowledge": saved}
    if gap["kind"] == "check":
        # "It is right" closes the question; anything else is kept as an instruction about that document.
        skip_gap(conn, collection_id, gap["id"])
        if answer.casefold() in ("yes", "right", "correct", "it is right", "ok"):
            return {"saved_as": "confirmed"}
        note = f'About "{gap["subject"]}": {answer}'
        saved = add_knowledge(conn, collection_id, user_id, "instruction", None, note, source="question")
        return {"saved_as": "instruction", "knowledge": saved}
    field = "doc_type" if gap["kind"] == "doc_type" else "project"
    if field == "doc_type" and answer not in DOC_TYPES:
        raise ValueError(f"choose one of: {', '.join(DOC_TYPES)}")
    record_correction(conn, user_id, gap["document_id"], field, answer, None, "Answered a question from the brain")
    # The answer also becomes a labelled example, so the model sees it next time it reads a similar document.
    row = conn.execute("SELECT labels FROM examples WHERE document_id = ?", (gap["document_id"],)).fetchone()
    labels = {**(loads(row["labels"], {}) if row else {}), field: answer}
    conn.execute(
        "INSERT INTO examples (document_id, labels, note, created_by, created_at) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(document_id) DO UPDATE SET labels = excluded.labels",
        (gap["document_id"], dumps(labels), "From a brain question", user_id, now()),
    )
    skip_gap(conn, collection_id, gap["id"])
    return {"saved_as": "example", "labels": labels}
