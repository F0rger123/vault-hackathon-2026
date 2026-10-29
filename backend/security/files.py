"""File validation and path containment.

Uploads are identified by their content (magic bytes), never by the client-supplied name or
content type alone. Every server-side path is resolved and checked against an allowed root.
"""

import re
from pathlib import Path, PurePosixPath, PureWindowsPath

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
# Office files are ZIP archives, so the content only says "zip". The extension picks which Office reader runs, and
# that reader then requires the matching parts. Macro-enabled variants (.docm, .xlsm, .pptm) are not listed.
OFFICE_EXTENSIONS = {".docx": DOCX, ".xlsx": XLSX, ".pptx": PPTX}

ALLOWED_TYPES = {
    "application/pdf": {".pdf"},
    "image/png": {".png"},
    "image/jpeg": {".jpg", ".jpeg"},
    "text/plain": {".txt", ".md", ".csv", ".json", ".log"},
    DOCX: {".docx"},
    XLSX: {".xlsx"},
    PPTX: {".pptx"},
}

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


class FileRejected(ValueError):
    """Raised when a file fails validation. The message is safe to show to the client."""


def sniff_media_type(head: bytes) -> str | None:
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"PK\x03\x04"):
        return "application/zip"
    if b"\x00" in head:
        return None
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        # A multi-byte character may be cut at the sniff boundary; accept if only the tail fails.
        if exc.start < len(head) - 4:
            return None
    return "text/plain"


def sanitize_filename(name: str) -> str:
    """Reduce a client-supplied name to a safe basename. Directory parts are discarded."""
    base = PureWindowsPath(PurePosixPath(name).name).name
    base = _SAFE_NAME.sub("_", base).strip(" .")
    if not base:
        raise FileRejected("empty filename")
    return base[:180]


def validate_upload(filename: str, head: bytes, size: int, max_bytes: int) -> tuple[str, str]:
    """Return (safe_name, media_type) or raise FileRejected."""
    if size <= 0:
        raise FileRejected("empty file")
    if size > max_bytes:
        raise FileRejected(f"file exceeds limit of {max_bytes // (1024 * 1024)} MB")
    safe = sanitize_filename(filename)
    media_type = sniff_media_type(head)
    if media_type is None:
        raise FileRejected("unsupported or binary file type")
    ext = Path(safe).suffix.lower()
    if media_type == "application/zip":
        if ext not in OFFICE_EXTENSIONS:
            raise FileRejected("archives are not accepted; only Word, Excel and PowerPoint files (.docx, .xlsx, .pptx)")
        return safe, OFFICE_EXTENSIONS[ext]
    if ext not in ALLOWED_TYPES[media_type]:
        raise FileRejected(f"extension {ext or '(none)'} does not match detected type {media_type}")
    return safe, media_type


def contained(path: Path, roots: list[Path]) -> Path:
    """Resolve `path` and require it to sit inside one of `roots`. Symlinks are resolved first."""
    resolved = path.resolve()
    for root in roots:
        root = root.resolve()
        if resolved == root or root in resolved.parents:
            return resolved
    raise FileRejected("path is outside the allowed directories")


def safe_join(root: Path, *parts: str) -> Path:
    """Join relative parts under root; reject absolute parts, drive letters and '..' escapes."""
    for part in parts:
        if not part or Path(part).is_absolute() or PureWindowsPath(part).drive or ".." in Path(part).parts:
            raise FileRejected("invalid path component")
    return contained(root.joinpath(*parts), [root])
