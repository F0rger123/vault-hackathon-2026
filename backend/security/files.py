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
    # F11.8: photos, video and sound are stored and described, never read by a model. See backend/ingest/media.py.
    "video/mp4": {".mp4", ".m4v"},
    "video/quicktime": {".mov"},
    "video/webm": {".webm"},
    "video/x-msvideo": {".avi"},
    "audio/wav": {".wav"},
    "audio/mpeg": {".mp3"},
    "audio/mp4": {".m4a"},
    "audio/ogg": {".ogg", ".oga", ".opus"},
}
# MP4, MOV and M4A share one container (ISO base media), so the content says only "that family". As with Office,
# the extension then picks the exact type, and only these three extensions may claim it.
ISO_MEDIA = "video/iso-bmff"
ISO_EXTENSIONS = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".m4a": "audio/mp4"}
_QT_FIRST_ATOMS = (b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot")

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
    if len(head) >= 12 and head.startswith(b"RIFF"):
        return {b"WAVE": "audio/wav", b"AVI ": "video/x-msvideo"}.get(head[8:12])
    # A box starts with its 4-byte size, so its first byte is a control byte for any first box under 512 MB (an ftyp
    # box is ~32 bytes, so 0). That keeps text such as "The free market..." from looking like a QuickTime atom.
    if len(head) >= 12 and head[0] == 0 and head[4:8] == b"ftyp":
        return ISO_MEDIA
    if len(head) >= 8 and head[0] < 0x20 and head[0] not in (9, 10, 13) and head[4:8] in _QT_FIRST_ATOMS:
        return ISO_MEDIA if int.from_bytes(head[:4], "big") >= 8 else None  # old QuickTime: an atom, no ftyp
    if head.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in head[:64]:
        return "video/webm"
    if head.startswith(b"OggS\x00"):
        return "audio/ogg"
    if head.startswith(b"ID3") or (len(head) >= 4 and _mp3_frame(head)):
        return "audio/mpeg"
    if b"\x00" in head:
        return None
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        # A multi-byte character may be cut at the sniff boundary; accept if only the tail fails.
        if exc.start < len(head) - 4:
            return None
    return "text/plain"


def _mp3_frame(head: bytes) -> bool:
    """An MPEG audio Layer III frame header with a legal bitrate and sample rate (not just any 0xFF byte)."""
    b1, b2 = head[1], head[2]
    return (
        head[0] == 0xFF
        and (b1 & 0xE0) == 0xE0
        and (b1 >> 3) & 3 != 1
        and (b1 >> 1) & 3 == 1
        and (b2 >> 4 not in (0, 15) and (b2 >> 2) & 3 != 3)
    )


def sanitize_filename(name: str) -> str:
    """Reduce a client-supplied name to a safe basename. Directory parts are discarded."""
    base = PureWindowsPath(PurePosixPath(name).name).name
    base = _SAFE_NAME.sub("_", base).strip(" .")
    if not base:
        raise FileRejected("empty filename")
    if len(base) <= 180:
        return base
    # Shorten the name but keep the extension, or a long name would lose it and be refused as the wrong type.
    stem, dot, ext = base.rpartition(".")
    if dot and 0 < len(ext) <= 10:
        return stem[: 179 - len(ext)] + "." + ext
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
    if media_type == ISO_MEDIA:
        if ext not in ISO_EXTENSIONS:
            raise FileRejected(f"extension {ext or '(none)'} does not match detected type video/mp4")
        return safe, ISO_EXTENSIONS[ext]
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


_ORIGINAL = re.compile(r"^originals[/\\][0-9a-f]{2}[/\\][0-9a-f]{64}[^/\\]*$")


def original_path(data_dir: Path, stored_path: str) -> Path:
    """The file for a document row. A row can only name an original, so a tampered database cannot point at secrets."""
    if not _ORIGINAL.match(stored_path or ""):
        raise FileRejected("this document's stored location is not valid")
    return safe_join(data_dir, *stored_path.replace("\\", "/").split("/"))
