"""Document ingestion: validate, hash, store a read-only original, extract page text, index.

Originals are content-addressed (data/originals/ab/abcdef...) and marked read-only. VAULT never
writes to the source location of an imported file.
"""

import hashlib
import io
import os
import sqlite3
import stat
from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

from backend.core.config import Settings
from backend.security.files import FileRejected, validate_upload
from backend.storage.db import now, transaction

TEXT_PAGE_CHARS = 4000


@dataclass
class IngestResult:
    document_id: int
    filename: str
    sha256: str
    duplicate: bool
    page_count: int
    media_type: str


def extract_pages(data: bytes, media_type: str, max_pages: int) -> list[str]:
    if media_type == "application/pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise FileRejected("encrypted PDFs are not supported")
            if len(reader.pages) > max_pages:
                raise FileRejected(f"PDF has more than {max_pages} pages")
            return [(page.extract_text() or "").strip() for page in reader.pages]
        except FileRejected:
            raise
        except Exception as exc:  # pypdf raises many exception types for malformed files
            raise FileRejected("PDF could not be parsed") from exc
    if media_type.startswith("image/"):
        try:
            with Image.open(io.BytesIO(data)) as img:
                img.verify()
            with Image.open(io.BytesIO(data)) as img:
                w, h = img.size
        except Exception as exc:
            raise FileRejected("image could not be decoded") from exc
        # Image text needs OCR or a vision model; record dimensions so the page is searchable by type.
        return [f"[image {w}x{h} px; visual content not yet analysed]"]
    text = data.decode("utf-8", errors="replace")
    chunks = [text[i : i + TEXT_PAGE_CHARS] for i in range(0, len(text), TEXT_PAGE_CHARS)] or [""]
    if len(chunks) > max_pages:
        raise FileRejected(f"text file exceeds {max_pages} pages")
    return chunks


def store_original(settings: Settings, sha: str, data: bytes) -> Path:
    target_dir = settings.originals_dir / sha[:2]
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / sha
    if not target.exists():
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        target.chmod(stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)
    return target


def ingest_bytes(
    conn: sqlite3.Connection, settings: Settings, collection_id: int, filename: str, data: bytes
) -> IngestResult:
    safe_name, media_type = validate_upload(filename, data[:4096], len(data), settings.max_upload_mb * 1024 * 1024)
    sha = hashlib.sha256(data).hexdigest()
    existing = conn.execute(
        "SELECT id, filename, page_count, media_type FROM documents WHERE collection_id = ? AND sha256 = ?",
        (collection_id, sha),
    ).fetchone()
    if existing:
        return IngestResult(
            existing["id"], existing["filename"], sha, True, existing["page_count"], existing["media_type"]
        )

    pages = extract_pages(data, media_type, settings.max_pages_per_document)
    stored = store_original(settings, sha, data)
    with transaction(conn):
        cur = conn.execute(
            """INSERT INTO documents (collection_id, filename, sha256, size_bytes, media_type, page_count,
                   stored_path, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ingested', ?)""",
            (
                collection_id,
                safe_name,
                sha,
                len(data),
                media_type,
                len(pages),
                str(stored.relative_to(settings.data_dir)),
                now(),
            ),
        )
        doc_id = cur.lastrowid
        conn.executemany(
            "INSERT INTO pages (document_id, page_no, text) VALUES (?, ?, ?)",
            [(doc_id, i + 1, text) for i, text in enumerate(pages)],
        )
    return IngestResult(doc_id, safe_name, sha, False, len(pages), media_type)


def ensure_collection(
    conn: sqlite3.Connection, name: str, user_id: int | None, description: str = "", is_demo: bool = False
) -> int:
    row = conn.execute("SELECT id FROM collections WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        "INSERT INTO collections (name, description, created_by, created_at, is_demo) VALUES (?, ?, ?, ?, ?)",
        (name, description, user_id, now(), int(is_demo)),
    )
    return cur.lastrowid
