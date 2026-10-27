"""Security agent: screens every document before any model sees it.

Deterministic and local, so it can run on documents that must never reach a model. It decides the
routing constraint: documents with sensitivity markings are pinned to local lanes, so even when an
administrator enables a remote model for a demo, marked documents never leave the machine.
"""

import re
import sqlite3
from dataclasses import dataclass, field

from backend.providers.prompting import detect_injection
from backend.storage.db import dumps, now

RESTRICTED_MARKINGS = [
    r"\bTOP SECRET\b",
    r"\bSECRET//",
    r"\bNOFORN\b",
    r"\bITAR\b",
    r"\bEXPORT[- ]CONTROLLED\b",
    r"\bCUI\b",
    r"\bCONTROLLED UNCLASSIFIED\b",
    r"\bRESTRICTED\b",
    r"\bNUCLEAR\b",
]
INTERNAL_MARKINGS = [r"\bCONFIDENTIAL\b", r"\bPROPRIETARY\b", r"\bINTERNAL USE ONLY\b"]
PII_PATTERNS = {
    "us_ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
}

_RESTRICTED = re.compile("|".join(RESTRICTED_MARKINGS), re.IGNORECASE)
_INTERNAL = re.compile("|".join(INTERNAL_MARKINGS), re.IGNORECASE)


@dataclass
class Screening:
    document_id: int
    sensitivity: str
    route: str
    markings: list[str] = field(default_factory=list)
    injection: list[dict] = field(default_factory=list)
    pii: list[str] = field(default_factory=list)


def screen(document_id: int, pages: list[str]) -> Screening:
    text = "\n".join(pages)
    restricted = sorted({m.group(0).upper() for m in _RESTRICTED.finditer(text)})
    internal = sorted({m.group(0).upper() for m in _INTERNAL.finditer(text)})
    pii = sorted(k for k, pat in PII_PATTERNS.items() if re.search(pat, text))
    if restricted:
        sensitivity = "restricted"
    elif internal or pii:
        sensitivity = "internal"
    else:
        sensitivity = "none"
    # Restricted markings or personal data: never send to a remote model.
    route = "local_only" if restricted or pii else "any"
    return Screening(document_id, sensitivity, route, restricted + internal, detect_injection(pages), pii)


def save(conn: sqlite3.Connection, s: Screening) -> None:
    conn.execute(
        """INSERT INTO screenings (document_id, sensitivity, markings, injection, pii, route, screened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(document_id) DO UPDATE SET sensitivity = excluded.sensitivity,
             markings = excluded.markings, injection = excluded.injection, pii = excluded.pii,
             route = excluded.route, screened_at = excluded.screened_at""",
        (s.document_id, s.sensitivity, dumps(s.markings), dumps(s.injection), dumps(s.pii), s.route, now()),
    )
