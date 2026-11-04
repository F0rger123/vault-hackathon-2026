"""Classification labels and redactions (F09.23), enforced on the server for every read.

Four labels, lowest first: public, internal, confidential, restricted. A document nobody labelled counts as internal.
Each role may open documents up to its clearance: viewers up to internal, analysts up to confidential, admins all.
Anything above a person's clearance is left out of lists, search, findings and Keeper's answers, and opening it
directly is refused.

Redactions are spans of a page's text (page, start, end) with the kind of thing they hide. Only a hash of the hidden
value is stored. Approved ("applied") redactions are hidden from everyone except administrators: the span is shown as
`[REDACTED <kind>]`. The original file and the stored page text never change; the hiding happens as text is read.

How the hiding reaches every read path: `guard(conn, role)` puts temporary views named `documents`, `pages`,
`extractions` and `findings` in front of the real tables on that one connection. SQLite looks in the temporary
schema first, so every existing query on that connection (search, the chat, investigations, records) only sees what
the person may see, with redacted page text, without each query having to remember. Writers use their own,
unguarded connections. Code that must see the real text (the helper that proposes redactions, exports written for an
approved proposal) names `main.pages` explicitly.

These labels are an organisation's own handling levels. They are not government security classifications, and
VAULT does not claim to be fit for classified government data.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field

LEVELS = ("public", "internal", "confidential", "restricted")
RANK = {level: n for n, level in enumerate(LEVELS)}
DEFAULT_LEVEL = "internal"
CLEARANCE = {"viewer": "internal", "analyst": "confidential", "admin": "restricted"}
LEVEL_WORDS = {
    "public": "Anyone with access to VAULT may see it and it may be shared.",
    "internal": "For people inside the organisation. The default for documents nobody labelled.",
    "confidential": "Analysts and administrators only. Redactions still apply to analysts.",
    "restricted": "Administrators only. Hidden from everyone else everywhere in VAULT.",
}
# What each kind of redaction is called where the text was hidden. Shares names with share packs (F08.6).
LABELS = {
    "emails": "email",
    "phone_numbers": "phone",
    "id_numbers": "ID number",
    "people": "name",
    "people_and_companies": "name",
    "money": "amount",
    "terms": "withheld",
}
PAGE_CHANGED = "[REDACTED page: the text changed after it was redacted. Ask an administrator.]"


def level(value: str | None) -> str:
    return value if value in RANK else DEFAULT_LEVEL


def clearance(role: str) -> str:
    return CLEARANCE.get(role, "public")


def may_open(role: str, classification: str | None) -> bool:
    return RANK[level(classification)] <= RANK[clearance(role)]


def sees_redacted(role: str) -> bool:
    """Only administrators see what a redaction hides (and can remove it)."""
    return role == "admin"


def label(kind: str) -> str:
    return LABELS.get(kind, "withheld")


def placeholder(kind: str) -> str:
    return f"[REDACTED {label(kind)}]"


def value_sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hint(value: str) -> str:
    """A hint an administrator can use to recognise a span without the plan repeating the value."""
    return f"{value[:1]}{'•' * min(max(len(value) - 1, 0), 10)} ({len(value)} characters)"


# ---------- rendering redacted text ----------


def render(text: str, spans: list[dict]) -> tuple[str, list[dict]]:
    """The page text with each span replaced by its placeholder, and where each placeholder now sits.

    Spans whose hash no longer matches (the text changed) fail closed: the whole page is hidden.
    """
    out, placed, pos = [], [], 0
    for s in sorted(spans, key=lambda s: (s["start"], -s["end"])):
        if s["start"] < pos:
            continue  # overlaps one already hidden
        if s["end"] > len(text) or value_sha(text[s["start"] : s["end"]]) != s["value_sha"]:
            return PAGE_CHANGED, []
        out.append(text[pos : s["start"]])
        start = sum(len(x) for x in out)
        mark = placeholder(s["kind"])
        out.append(mark)
        placed.append({"id": s.get("id"), "start": start, "end": start + len(mark), "kind": s["kind"]})
        pos = s["end"]
    out.append(text[pos:])
    return "".join(out), [{**p, "label": label(p["kind"])} for p in placed]


def spans(conn: sqlite3.Connection, document_id: int, status: tuple[str, ...] = ("applied",)) -> list[dict]:
    marks = ",".join("?" * len(status))
    rows = conn.execute(
        f"SELECT id, page_no, start, end, kind, value_sha, status FROM main.redactions "  # noqa: S608 - fixed marks
        f"WHERE document_id = ? AND status IN ({marks}) ORDER BY page_no, start",
        (document_id, *status),
    ).fetchall()
    return [dict(r) for r in rows]


def redacted_pages(conn: sqlite3.Connection, document_id: int) -> list[str]:
    """Every page of a document with its applied redactions hidden. Used for exports and share packs."""
    by_page: dict[int, list[dict]] = {}
    for s in spans(conn, document_id):
        by_page.setdefault(s["page_no"], []).append(s)
    rows = conn.execute(
        "SELECT page_no, text FROM main.pages WHERE document_id = ? ORDER BY page_no", (document_id,)
    ).fetchall()
    return [render(r["text"], by_page.get(r["page_no"], []))[0] for r in rows]


def has_redactions(conn: sqlite3.Connection, document_id: int) -> bool:
    return bool(
        conn.execute(
            "SELECT 1 FROM main.redactions WHERE document_id = ? AND status = 'applied' LIMIT 1", (document_id,)
        ).fetchone()
    )


def classification_of(conn: sqlite3.Connection, document_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, collection_id, filename, classification, classification_reason, classification_set_by, "
        "classification_by_user, classification_set_at FROM main.documents WHERE id = ?",
        (document_id,),
    ).fetchone()


def describe(row: sqlite3.Row | dict) -> dict:
    """The label as the API shows it."""
    r = dict(row)
    return {
        "level": level(r.get("classification")),
        "labelled": r.get("classification") is not None,
        "reason": r.get("classification_reason"),
        "set_by": r.get("classification_set_by"),
        "by_user": r.get("classification_by_user"),
        "set_at": r.get("classification_set_at"),
    }


# ---------- the per-connection guard ----------


@dataclass
class Guard:
    role: str
    values: list[tuple[str, str]] = field(default_factory=list)  # (hidden value, kind), longest first
    _rx: re.Pattern | None = None
    _kind: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        usable = [(v, k) for v, k in self.values if len(v.strip()) >= 2]
        if usable:
            # A highlight marker from a search snippet ("[[" or "]]") may sit inside a value; allow for it.
            gap = r"(?:\[\[|\]\])?"
            parts = [gap.join(re.escape(ch) for ch in v) for v, _ in usable]
            self._rx = re.compile("|".join(parts), re.IGNORECASE)
            self._kind = {v.casefold(): k for v, k in usable}

    def text(self, value: str) -> str:
        if not self._rx or not value:
            return value

        def sub(m: re.Match) -> str:
            plain = m.group(0).replace("[[", "").replace("]]", "").casefold()
            return placeholder(self._kind.get(plain, "terms"))

        return self._rx.sub(sub, value)

    def scrub(self, obj):
        """Hide every redacted value anywhere in a JSON-like object (strings, lists and dicts)."""
        if isinstance(obj, str):
            return self.text(obj)
        if isinstance(obj, list):
            return [self.scrub(v) for v in obj]
        if isinstance(obj, tuple):
            return tuple(self.scrub(v) for v in obj)
        if isinstance(obj, dict):
            return {k: self.scrub(v) for k, v in obj.items()}
        return obj

    def json_text(self, raw: str | None) -> str | None:
        if raw is None or not self._rx:
            return raw
        try:
            return json.dumps(self.scrub(json.loads(raw)), separators=(",", ":"), sort_keys=True)
        except ValueError:
            return self.text(raw)


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA main.table_info({table})").fetchall()]  # noqa: S608 - fixed names


def guard(conn: sqlite3.Connection, role: str) -> Guard | None:
    """Hide what `role` may not see on this connection. Administrators see everything: returns None for them."""
    if sees_redacted(role):
        return None
    rows = conn.execute(
        "SELECT r.id, r.document_id, r.page_no, r.start, r.end, r.kind, r.value_sha, p.id AS page_id, p.text "
        "FROM main.redactions r JOIN main.pages p ON p.document_id = r.document_id AND p.page_no = r.page_no "
        "WHERE r.status = 'applied'"
    ).fetchall()
    by_page: dict[int, list[dict]] = {}
    values: dict[str, str] = {}
    for r in rows:
        by_page.setdefault(r["page_id"], []).append(dict(r))
        value = r["text"][r["start"] : r["end"]]
        if value_sha(value) == r["value_sha"]:
            values.setdefault(value, r["kind"])
    g = Guard(role, sorted(values.items(), key=lambda kv: len(kv[0]), reverse=True))

    def page_text(page_id: int, text: str) -> str:
        found = by_page.get(page_id)
        return render(text, found)[0] if found else g.text(text)

    conn.create_function("vault_visible", 1, lambda c: 1 if may_open(role, c) else 0, deterministic=True)
    conn.create_function("vault_page", 2, page_text, deterministic=True)
    conn.create_function("vault_scrub", 1, lambda t: g.text(t) if isinstance(t, str) else t, deterministic=True)
    conn.create_function("vault_scrub_json", 1, g.json_text, deterministic=True)

    visible = "SELECT id FROM main.documents WHERE vault_visible(classification)"
    wrap = {
        "pages": {"text": "vault_page(t.id, t.text)"},
        "extractions": {
            "title": "vault_scrub(t.title)",
            "summary": "vault_scrub(t.summary)",
            "data": "vault_scrub_json(t.data)",
            "evidence": "vault_scrub_json(t.evidence)",
        },
        "findings": {"summary": "vault_scrub(t.summary)", "evidence": "vault_scrub_json(t.evidence)"},
    }
    where = {
        "documents": "vault_visible(t.classification)",
        "pages": f"t.document_id IN ({visible})",
        "extractions": f"t.document_id IN ({visible})",
        # A finding drawn from any document the person may not open is left out whole.
        "findings": "NOT EXISTS (SELECT 1 FROM json_each(t.evidence) j WHERE NOT vault_visible("
        "(SELECT classification FROM main.documents d WHERE d.id = json_extract(j.value, '$.document_id'))))",
    }
    for table, condition in where.items():
        cols = ", ".join(f"{wrap.get(table, {}).get(c, 't.' + c)} AS {c}" for c in _columns(conn, table))
        conn.execute(
            f"CREATE TEMP VIEW IF NOT EXISTS {table} AS SELECT {cols} FROM main.{table} t WHERE {condition}"  # noqa: S608
        )
    return g
