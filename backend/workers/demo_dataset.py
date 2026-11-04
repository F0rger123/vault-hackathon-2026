"""Downloadable demo datasets (F12.16): the fictional files from the demo, as ZIPs served by VAULT itself.

Two sets:

- quick: the frozen demo archive (data/synthetic/v1/files, the BV-7891 1,500 vs 600 psi conflict) with its ground
  truth under expected/, a README, example prompts and a fictional-data notice.
- complete: quick plus the realistic test set from scripts/make_test_files.py --size demo (about 130 files). It is
  generated on the first request into the runtime data folder and reused. The huge preset (about 2,300 files,
  275 MB, several minutes to make) is too slow to build while someone waits for a download.

The test set deliberately holds hostile files for testing VAULT's gate. A download for people is not the place for
them, so every candidate is checked by content (not by name) and anything that is a program, a PDF with active
content, an Office file with a macro part or an outside link, or an archive (a nested ZIP, a possible ZIP bomb) is
left out. The README lists what was left out and why. Harmless edge cases (empty, corrupt, misnamed, prompt-injection
text) stay under testset/edge-cases/.

Built ZIPs are cached under <data_dir>/demo-datasets/ named by a hash of their contents, so a repeat download is a
plain file send. Nothing here touches the network.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import threading
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath, PureWindowsPath

from backend.security.files import contained, safe_join

ROOT = Path(__file__).resolve().parents[2]
SYNTHETIC = ROOT / "data" / "synthetic" / "v1"
GENERATOR = ROOT / "scripts" / "make_test_files.py"
KINDS = ("quick", "complete")
# Bump when the README text or layout changes, so cached ZIPs are rebuilt.
LAYOUT_VERSION = "1"
# The generator preset for the complete set. Tests shrink it to keep the suite fast.
TESTSET = {"count": 64, "seed": 7, "size": "demo"}
ZIP_TIME = (2026, 1, 1, 0, 0, 0)
MAX_MEMBER_BYTES = 60 * 1024 * 1024
# Reasons a test-set file is left out of a download (also listed in the README).
EXCLUDE_REASONS = {
    "program": "starts with Windows program bytes (MZ)",
    "active_pdf": "PDF with JavaScript, an open action, a launch action or an embedded file",
    "macro": "Office file with a macro part (vbaProject.bin)",
    "external_link": "Office file with a link to an outside address",
    "archive": "an archive inside the archive (a ZIP that is not a Word, Excel or PowerPoint file, or a ZIP bomb)",
    "too_large": "larger than 60 MB",
}
# A name followed by a PDF delimiter, so random bytes inside compressed image streams almost never match.
_PDF_ACTIVE = re.compile(rb"/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFiles?|RichMedia)[\s/<>\[\]()]")
_OFFICE = {".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}

_locks = {kind: threading.Lock() for kind in (*KINDS, "testset")}


class DatasetUnavailable(RuntimeError):
    """The dataset cannot be built in this installation. The message is safe to show."""


@dataclass
class Built:
    path: Path
    kind: str
    sha256: str
    files: int
    size: int
    excluded: list[dict] = field(default_factory=list)

    @property
    def filename(self) -> str:
        return f"vault-demo-dataset-{self.kind}.zip"


def arcname(*parts: str) -> str:
    """A ZIP entry name: relative, forward slashes, no '..', no drive or root. Raises ValueError otherwise."""
    name = "/".join(parts)
    p = PurePosixPath(name)
    if (
        not name
        or "\\" in name
        or "\0" in name
        or p.is_absolute()
        or PureWindowsPath(name).drive
        or any(part in ("", ".", "..") for part in name.split("/"))
    ):
        raise ValueError("invalid entry name")
    return name


def unsafe_reason(name: str, data: bytes) -> str | None:
    """Why a file must not go into a download for people, judged by its bytes; None when it is harmless."""
    if len(data) > MAX_MEMBER_BYTES:
        return "too_large"
    if data.startswith(b"MZ"):
        return "program"
    if data.startswith(b"%PDF-") and _PDF_ACTIVE.search(data):
        return "active_pdf"
    if data.startswith(b"PK\x03\x04") or data.startswith(b"PK\x05\x06"):
        return _zip_reason(name, data)
    return None


def _zip_reason(name: str, data: bytes) -> str | None:
    prefix = _OFFICE.get(Path(name).suffix.lower())
    if prefix is None:
        return "archive"
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = z.infolist()
            total = sum(i.file_size for i in infos)
            if total > MAX_MEMBER_BYTES or any(i.compress_size and i.file_size / i.compress_size > 200 for i in infos):
                return "archive"
            names = [i.filename for i in infos]
            if any(n.lower().endswith("vbaproject.bin") for n in names):
                return "macro"
            if any(n.lower().endswith((".zip", ".jar", ".exe", ".dll")) for n in names):
                return "archive"
            if not any(n.startswith(prefix) for n in names):
                return "archive"  # a ZIP renamed to look like an Office file
            for n in names:
                if n.endswith(".rels") and b'TargetMode="External"' in z.read(n):
                    return "external_link"
    except zipfile.BadZipFile:
        return None  # a corrupt file, harmless; VAULT rejects it
    return None


# ---------- contents ----------

Entry = tuple[str, Callable[[], bytes]]


def _file(path: Path, root: Path) -> Callable[[], bytes]:
    safe = contained(path, [root])
    return safe.read_bytes


def _text(s: str) -> Callable[[], bytes]:
    data = s.encode("utf-8")
    return lambda: data


def _quick_entries(top: str) -> list[Entry]:
    files_dir = safe_join(SYNTHETIC, "files")
    if not files_dir.is_dir():
        raise DatasetUnavailable("the demo archive is not included in this installation")
    entries: list[Entry] = []
    for p in sorted(files_dir.iterdir()):
        if p.is_file():
            entries.append((arcname(top, "files", p.name), _file(safe_join(files_dir, p.name), SYNTHETIC)))
    manifest_path = safe_join(SYNTHETIC, "manifest.json")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    entries.append((arcname(top, "expected", "manifest.json"), _file(manifest_path, SYNTHETIC)))
    findings = {
        "about": "Planted problems VAULT should find in files/. FICTIONAL demonstration data.",
        "seed": manifest.get("seed"),
        "anomalies": manifest.get("anomalies", []),
    }
    entries.append((arcname(top, "expected", "expected_findings.json"), _text(json.dumps(findings, indent=2) + "\n")))
    return entries


def _testset_dir(cache: Path) -> Path:
    """Generate the test set once into the cache (atomically) and return its folder."""
    if not GENERATOR.is_file():
        raise DatasetUnavailable("the test-set generator is not included in this installation")
    try:
        from scripts import make_test_files  # imported here: Pillow and reportlab are only needed for this set
    except ImportError as exc:
        raise DatasetUnavailable("the test-set generator is not included in this installation") from exc
    key = hashlib.sha256(GENERATOR.read_bytes() + json.dumps(TESTSET, sort_keys=True).encode()).hexdigest()[:16]
    target = safe_join(cache, f"testset-{key}")
    with _locks["testset"]:
        if (target / "manifest.json").is_file():
            return target
        work = Path(tempfile.mkdtemp(prefix="testset-", dir=cache))
        try:
            make_test_files.generate(
                work, count=TESTSET["count"], seed=TESTSET["seed"], use_ffmpeg=False, large=False, size=TESTSET["size"]
            )
            if target.exists():
                shutil.rmtree(target)
            os.replace(work, target)
        finally:
            if work.exists():
                shutil.rmtree(work, ignore_errors=True)
    return target


def _testset_entries(top: str, cache: Path) -> tuple[list[Entry], list[dict], dict]:
    root = _testset_dir(cache)
    manifest = json.loads(safe_join(root, "manifest.json").read_text("utf-8"))
    entries: list[Entry] = []
    excluded: list[dict] = []
    kept: list[dict] = []
    for f in manifest["files"]:
        rel = f["file"]
        parts = rel.replace("\\", "/").split("/")
        path = safe_join(root, *parts)
        data = path.read_bytes()
        reason = unsafe_reason(parts[-1], data)
        if reason is None and "active_content" in (f.get("planted") or []):
            reason = "active_pdf" if parts[-1].lower().endswith(".pdf") else "external_link"
        if reason:
            excluded.append({"file": rel, "reason": EXCLUDE_REASONS[reason]})
            continue
        # The generator's folder is edge_cases/; the download uses edge-cases/ so it reads as a label.
        parts = ["edge-cases" if i == 0 and p == "edge_cases" else p for i, p in enumerate(parts)]
        kept.append({**f, "file": "/".join(parts)})
        entries.append((arcname(top, "testset", *parts), lambda d=data: d))
    out_manifest = {**manifest, "files": kept, "files_total": len(kept), "excluded_from_download": excluded}
    out_manifest["bytes_total"] = sum(x["size_bytes"] for x in kept)
    entries.append(
        (arcname(top, "expected", "testset-manifest.json"), _text(json.dumps(out_manifest, indent=2) + "\n"))
    )
    return entries, excluded, out_manifest


# ---------- the text files ----------

NOTICE = """FICTIONAL DEMONSTRATION DATA
============================

Every document in this archive was made up for demonstrating VAULT.

- The projects (Alpha, Borealis, Cobalt, Driftwood, Ember), companies, suppliers, people, part numbers,
  pressure ratings, dates, signatures and newspaper stories are invented.
- Any resemblance to real people, companies, products or projects is a coincidence.
- Nothing here is engineering data. Do not use any value in it for design, purchasing, safety or compliance.
- No real customer, personal or proprietary data is included.
"""

PROMPTS = """# Example prompts

Ask these in VAULT (Ask Keeper / Chat) after importing the files and running a read. Answers come with citations
to the original documents, and every quote is checked against the page it came from.

1. Which parts have conflicting pressure ratings? Show the exact values and cite the original documents.
2. Show me every reference to component BV-7891.
3. Why does BV-7891 appear with 1,500 psi in one place and 600 psi in another? Which document is newer?
4. Which inspection reports disagree with the drawings?
5. List every document for project Alpha, newest first.
6. Which documents try to give instructions to an AI? (VAULT treats them as text and does nothing they ask.)
7. What did the 2023 parts list change compared with the 2021 one?
8. Show me the longest videos first. (Complete dataset)
9. Find photos from 2024 sorted by date taken. (Complete dataset)
10. Which contracts order a different quantity than the drawings list? (Complete dataset)

The expected answers are in `expected/` (`expected_findings.json` for the demo archive,
`testset-manifest.json` for the complete test set).
"""


def _readme(kind: str, n_files: int, excluded: list[dict], testset: dict | None) -> str:
    title = "Quick Demo Dataset" if kind == "quick" else "Complete Demo Dataset"
    lines = [
        f"# VAULT {title}",
        "",
        "> **FICTIONAL demonstration data.** Every project, company, person, part and number here is invented.",
        "> See `FICTIONAL_DATA_NOTICE.txt`.",
        "",
        "This archive holds the documents used in the VAULT demo, so anyone can reproduce it on their own computer.",
        "It was built by VAULT itself; nothing was downloaded from the internet.",
        "",
        "## What is inside",
        "",
        "| Folder | What |",
        "|---|---|",
        f"| `files/` | {n_files} demo documents (drawings, inspection reports, contracts, parts lists, memos) for "
        "the fictional project Alpha and others. Includes the main demo conflict: ball valve **BV-7891** is "
        "rated **1,500 psi** on the drawings and parts list but **600 psi** in an inspection report. |",
        "| `expected/` | The ground truth: `manifest.json` (every file and the values planted in it) and "
        "`expected_findings.json` (the conflicts and the prompt-injection file VAULT should find). |",
    ]
    if testset is not None:
        lines.append(
            f"| `testset/` | {testset['files_total']} realistic test files by kind: PDFs, Word, Excel, PowerPoint, "
            "CSV, text, Markdown, JSON, photos, video, sound, stamped and marked-up drawings, newspapers. "
            "Planted conflicts are listed in `expected/testset-manifest.json`. |"
        )
        lines.append(
            "| `testset/edge-cases/` | Harmless files that VAULT should refuse, hold or flag: empty, cut-off or "
            "corrupt files, files with the wrong extension, a password-protected PDF, an over-long name, text "
            "that tries to instruct an AI. Each file's expected result is in `expected/testset-manifest.json`. |"
        )
    lines += [
        "| `EXAMPLE_PROMPTS.md` | Questions to ask VAULT. |",
        "",
        "## How to import into VAULT",
        "",
        "1. Unzip this archive anywhere.",
        "2. In VAULT, switch to **Demo mode**, open **Add files**, and drop the `files/` folder"
        + (" (and, for the bigger test, the `testset/` folder)" if testset is not None else "")
        + " onto the page. Or, from a terminal in the VAULT folder:",
        "",
        "   ```",
        "   vault ingest path/to/files --collection demo",
        "   vault process --collection demo --provider heuristic",
        "   ```",
        "",
        "3. When the read finishes, the Overview shows the findings. Ask the questions in `EXAMPLE_PROMPTS.md`.",
        "",
        "The demo archive alone should give 150 added documents and 10 verified rating conflicts.",
    ]
    if testset is not None:
        lines += [
            "",
            "## What was left out, and why",
            "",
            "The test-set generator also writes hostile files on purpose, so VAULT's security gate can be tested. "
            "They have no place in a download meant for people, so every file was checked by its content "
            "(not its name) and these kinds were left out: programs, PDFs with JavaScript or automatic actions, "
            "Office files with macro parts or outside links, and archives inside the archive (nested ZIPs, "
            "ZIP bombs). To test the gate with them, run `python scripts/make_test_files.py --size demo` from "
            "the VAULT source; it writes them to a folder of your choosing.",
            "",
        ]
        if excluded:
            lines += ["| File | Reason |", "|---|---|", *(f"| `{x['file']}` | {x['reason']} |" for x in excluded)]
        else:
            lines.append("No file needed to be left out.")
        lines += [
            "",
            f"The test set was made with seed {testset.get('seed')} and the `{testset.get('size')}` preset "
            "(the larger `huge` preset takes several minutes, so it is not built for a download).",
        ]
    return "\n".join(lines) + "\n"


# ---------- building ----------


def _write_zip(dest: Path, entries: list[tuple[str, bytes | Callable[[], bytes]]]) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".partial-", suffix=".zip", dir=dest.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for name, get in entries:
                info = zipfile.ZipInfo(arcname(name), date_time=ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                z.writestr(info, get() if callable(get) else get)
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def build(kind: str, data_dir: Path) -> Built:
    """Build (or reuse) the ZIP for `kind` and return where it is. Streams entries one at a time to a temp file."""
    if kind not in KINDS:
        raise ValueError("unknown dataset")
    data_dir.mkdir(parents=True, exist_ok=True)
    cache = safe_join(data_dir, "demo-datasets")
    cache.mkdir(parents=True, exist_ok=True)
    top = f"vault-demo-dataset-{kind}"
    with _locks[kind]:
        entries: list[tuple[str, bytes | Callable[[], bytes]]] = list(_quick_entries(top))
        n_files = sum(1 for name, _ in entries if name.startswith(f"{top}/files/"))
        excluded: list[dict] = []
        testset = None
        if kind == "complete":
            extra, excluded, testset = _testset_entries(top, cache)
            entries += extra
        entries += [
            (arcname(top, "README.md"), _text(_readme(kind, n_files, excluded, testset))),
            (arcname(top, "EXAMPLE_PROMPTS.md"), _text(PROMPTS)),
            (arcname(top, "FICTIONAL_DATA_NOTICE.txt"), _text(NOTICE)),
        ]
        entries.sort(key=lambda e: e[0])
        digest = hashlib.sha256(LAYOUT_VERSION.encode())
        for name, get in entries:
            data = get() if callable(get) else get
            digest.update(name.encode() + b"\0" + hashlib.sha256(data).digest())
        sha = digest.hexdigest()
        dest = safe_join(cache, f"{kind}-{sha[:20]}.zip")
        if not dest.is_file():
            for old in cache.glob(f"{kind}-*.zip"):
                old.unlink(missing_ok=True)
            _write_zip(dest, entries)
        return Built(dest, kind, sha, len(entries), dest.stat().st_size, excluded)
