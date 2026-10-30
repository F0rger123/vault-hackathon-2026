"""Find active content in uploaded files: things that can run or reach out when a person opens the original (F09.13).

VAULT never runs these itself: it reads only the text. The danger is a person downloading the original and opening
it in a PDF reader or Office. So the security gate holds such files in quarantine: no model reads them, nobody can
download the original, until an administrator reviews and releases them. Every hold and release is audited.

What counts:
- PDF: JavaScript, actions that run on open (OpenAction, AA), Launch actions that start programs, embedded files,
  rich media (Flash/video), and XFA forms (scriptable).
- Office (DOCX/XLSX/PPTX): links to outside files or web addresses (TargetMode="External"), ActiveX controls, and
  embedded OLE objects. Macro files never get this far: they are refused at upload.
"""

from __future__ import annotations

import io
import re
import zipfile

from pypdf import PdfReader

_PDF_NAMES = {
    rb"/JavaScript\b": "runs JavaScript",
    rb"/JS\b": "runs JavaScript",
    rb"/Launch\b": "can start a program",
    rb"/EmbeddedFiles?\b": "carries embedded files",
    rb"/OpenAction\b": "runs an action when opened",
    rb"/RichMedia\b": "contains rich media",
    rb"/XFA\b": "uses a scriptable XFA form",
}
_PDF_RE = [(re.compile(k), v) for k, v in _PDF_NAMES.items()]


def _pdf(data: bytes) -> set[str]:
    found = {why for rx, why in _PDF_RE if rx.search(data)}
    # Names can hide inside compressed object streams, so also walk the parsed structure.
    try:
        reader = PdfReader(io.BytesIO(data))
        root = reader.trailer["/Root"]
        if "/OpenAction" in root:
            found.add("runs an action when opened")
        if "/AA" in root:
            found.add("runs actions on document events")
        names = root.get("/Names") or {}
        if "/JavaScript" in names:
            found.add("runs JavaScript")
        if "/EmbeddedFiles" in names:
            found.add("carries embedded files")
        if "/XFA" in (root.get("/AcroForm") or {}):
            found.add("uses a scriptable XFA form")
        for page in reader.pages:
            if "/AA" in page:
                found.add("runs actions on document events")
            for annot in page.get("/Annots") or []:
                widget = annot.get_object() if hasattr(annot, "get_object") else {}
                if "/AA" in widget:
                    found.add("runs actions on document events")
                action = widget.get("/A") or {}
                kind = action.get("/S") if hasattr(action, "get") else None
                if kind == "/Launch":
                    found.add("can start a program")
                elif kind == "/JavaScript":
                    found.add("runs JavaScript")
    except Exception:  # noqa: S110 - the raw scan above already ran; a parse failure is reported at upload
        pass
    return found


_EXTERNAL = re.compile(rb"""TargetMode\s*=\s*["']\s*External""", re.IGNORECASE)


def _office(data: bytes) -> set[str]:
    found: set[str] = set()
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                name = info.filename.lower()
                if "/activex/" in name:
                    found.add("contains ActiveX controls")
                elif "/embeddings/" in name and name.endswith(".bin"):
                    found.add("contains embedded objects")
                elif name.endswith(".rels"):
                    # XML allows either quote and spaces. A part too big to check is held, not skipped.
                    if info.file_size >= 1_000_000 or _EXTERNAL.search(z.read(info)):
                        found.add("links to outside files or web addresses")
    except (zipfile.BadZipFile, OSError):
        pass
    return found


def detect(data: bytes, media_type: str) -> list[str]:
    """Reasons to hold the file, plain words, sorted. Empty means nothing active was found."""
    if media_type == "application/pdf":
        return sorted(_pdf(data))
    if media_type.startswith("application/vnd.openxmlformats-officedocument."):
        return sorted(_office(data))
    return []
