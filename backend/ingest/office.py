"""Text from Word, Excel and PowerPoint files (DOCX, XLSX, PPTX), with only the standard library (F02.8).

These formats are ZIP archives of XML parts. Uploaded files are untrusted, so the archive is checked before any part
is read: a member count limit, a per-part and total size limit on the *uncompressed* data, and a compression ratio
limit stop zip bombs. Parts are read in bounded chunks, so a header that understates a part's size cannot get past
the limit. Macro projects (`vbaProject.bin`) are refused, and any part declaring a DTD is refused before parsing, which
rules out entity-expansion and external-entity attacks (Office files never need a DTD).

Pages: Word text is cut into pages the same way as plain text. Each spreadsheet sheet and each slide is its own page.
Table rows become comma-separated lines, so the CSV column rules (part number, material, qty) apply unchanged.
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree as ET  # noqa: S405 (DTDs are refused before parsing, see _Archive.xml)

from backend.security.files import DOCX, PPTX, XLSX, FileRejected

MAX_MEMBERS = 2000
MAX_PART_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 80 * 1024 * 1024
MAX_RATIO = 100
SHEET_PAGE_CHARS = 4000

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_DTD = re.compile(rb"<!(DOCTYPE|ENTITY)", re.IGNORECASE)
_NUM = re.compile(r"(\d+)")


class _Archive:
    def __init__(self, data: bytes):
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(data))
            infos = self.zip.infolist()
        except (zipfile.BadZipFile, ValueError, OSError) as exc:
            raise FileRejected("Office file could not be opened") from exc
        if len(infos) > MAX_MEMBERS:
            raise FileRejected("Office file has too many parts")
        total = 0
        for info in infos:
            if info.flag_bits & 0x1:
                raise FileRejected("encrypted Office files are not supported")
            if info.filename.lower().endswith("vbaproject.bin"):
                raise FileRejected("Office files with macros are not accepted")
            if info.file_size > MAX_PART_BYTES:
                raise FileRejected("Office file has a part that is too large")
            if info.compress_size and info.file_size / info.compress_size > MAX_RATIO and info.file_size > 1_000_000:
                raise FileRejected("Office file is compressed suspiciously (possible zip bomb)")
            total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise FileRejected("Office file is too large when unpacked")
        self.names = {i.filename for i in infos}

    def read(self, name: str) -> bytes:
        """Read one part, never more than MAX_PART_BYTES, whatever its header claims."""
        buf = bytearray()
        try:
            with self.zip.open(name) as f:
                while chunk := f.read(65536):
                    buf += chunk
                    if len(buf) > MAX_PART_BYTES:
                        raise FileRejected("Office file has a part that is too large")
        except (zipfile.BadZipFile, KeyError, OSError, EOFError) as exc:
            raise FileRejected("Office file is damaged") from exc
        return bytes(buf)

    def xml(self, name: str) -> ET.Element:
        raw = self.read(name)
        # Requiring UTF-8 keeps the DTD check reliable: a UTF-16 part could spell "<!DOCTYPE" in bytes the pattern
        # would not match. Office writes its XML parts as UTF-8.
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise FileRejected("Office file contains XML that is not UTF-8") from exc
        if _DTD.search(raw):
            raise FileRejected("Office file contains a DTD, which is not allowed")
        try:
            # DTDs are refused above, so no entity can be declared or expanded.
            return ET.fromstring(raw)  # noqa: S314  # nosec B314
        except ET.ParseError as exc:
            raise FileRejected("Office file contains invalid XML") from exc


def _numbered(names: set[str], prefix: str) -> list[str]:
    found = [n for n in names if n.startswith(prefix) and n.endswith(".xml") and "/_rels/" not in n]
    return sorted(found, key=lambda n: int(m.group(1)) if (m := _NUM.search(n[len(prefix) :])) else 0)


def _docx(z: _Archive) -> str:
    if "word/document.xml" not in z.names:
        raise FileRejected("Word file has no document body")
    body = z.xml("word/document.xml").find(f"{_W}body")
    lines: list[str] = []
    for block in body if body is not None else []:
        if block.tag == f"{_W}p":
            lines.append(_w_text(block))
        elif block.tag == f"{_W}tbl":
            for row in block.iter(f"{_W}tr"):
                cells = [" ".join(_w_text(p) for p in tc.iter(f"{_W}p")).strip() for tc in row.iter(f"{_W}tc")]
                lines.append(", ".join(c.replace(",", " ") for c in cells))
    return "\n".join(lines).strip()


def _w_text(p: ET.Element) -> str:
    out = []
    for node in p.iter():
        if node.tag == f"{_W}t" and node.text:
            out.append(node.text)
        elif node.tag == f"{_W}tab":
            out.append("\t")
        elif node.tag in (f"{_W}br", f"{_W}cr"):
            out.append("\n")
    return "".join(out)


def _col(ref: str) -> int:
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return max(n - 1, 0)


def _xlsx(z: _Archive) -> list[str]:
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.names:
        for si in z.xml("xl/sharedStrings.xml").iter(f"{_S}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{_S}t")))
    titles = []
    if "xl/workbook.xml" in z.names:
        titles = [s.get("name", "") for s in z.xml("xl/workbook.xml").iter(f"{_S}sheet")]
    sheets = _numbered(z.names, "xl/worksheets/sheet")
    if not sheets:
        raise FileRejected("Excel file has no sheets")
    pages: list[str] = []
    for i, name in enumerate(sheets):
        rows: list[str] = []
        for row in z.xml(name).iter(f"{_S}row"):
            values: dict[int, str] = {}
            for c in row.iter(f"{_S}c"):
                kind, v = c.get("t"), c.find(f"{_S}v")
                if kind == "s" and v is not None and (v.text or "").isdigit() and int(v.text) < len(shared):
                    text = shared[int(v.text)]
                elif kind == "inlineStr":
                    text = "".join(t.text or "" for t in c.iter(f"{_S}t"))
                else:
                    text = v.text if v is not None and v.text else ""
                if text:
                    values[_col(c.get("r", "")) if c.get("r") else len(values)] = text.replace(",", " ").strip()
            if values:
                rows.append(",".join(values.get(k, "") for k in range(max(values) + 1)))
        title = titles[i] if i < len(titles) else f"Sheet {i + 1}"
        pages.extend(_sheet_pages(title, rows))
    return pages


def _sheet_pages(title: str, rows: list[str]) -> list[str]:
    """One page per sheet; a long sheet is split by rows, repeating the header row so columns stay labelled."""
    if not rows:
        return [f"Sheet: {title}"]
    header, pages, current = rows[0], [], [rows[0]]
    for row in rows[1:]:
        if sum(len(r) + 1 for r in current) + len(row) > SHEET_PAGE_CHARS and len(current) > 1:
            pages.append(current)
            current = [header]
        current.append(row)
    pages.append(current)
    return [f"Sheet: {title}\n" + "\n".join(p) for p in pages]


def _pptx(z: _Archive) -> list[str]:
    slides = _numbered(z.names, "ppt/slides/slide")
    if not slides:
        raise FileRejected("PowerPoint file has no slides")
    pages = []
    for i, name in enumerate(slides, start=1):
        paras = ["".join(t.text or "" for t in p.iter(f"{_A}t")) for p in z.xml(name).iter(f"{_A}p")]
        pages.append(f"Slide {i}\n" + "\n".join(x for x in paras if x.strip()))
    return pages


def office_pages(data: bytes, media_type: str, page_chars: int) -> list[str]:
    """Page texts for an Office file, or FileRejected with a message that is safe to show."""
    z = _Archive(data)
    if media_type == DOCX:
        text = _docx(z)
        return [text[i : i + page_chars] for i in range(0, len(text), page_chars)] or [""]
    if media_type == XLSX:
        return _xlsx(z)
    if media_type == PPTX:
        return _pptx(z)
    raise FileRejected("unsupported Office file type")
