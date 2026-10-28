"""Rule-based extractor. NOT an AI model.

It exists as a measurable baseline for evaluation and as an offline fallback for tests. The UI and
API always label its output as heuristic so it is never mistaken for model inference.
"""

import re

from backend.providers.base import Provider, ProviderInfo
from backend.providers.schema import Component, EvidenceQuote, Extraction

PART_RE = re.compile(r"\b([A-Z]{2,4}-\d{3,5}(?:-[A-Z0-9]{1,4})?)\b")
PSI_RE = re.compile(r"(?<![\d.,])(\d+(?:\.\d+)?)\s*psi\b", re.IGNORECASE)
DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
PROJECT_RE = re.compile(r"\bProject[:\s]+([A-Z][A-Za-z0-9-]+)")
QTY_RE = re.compile(r"\b(?:qty|quantity)[:\s]+(\d{1,6})\b", re.IGNORECASE)
CSV_COLUMNS = {"material": "material", "qty": "quantity", "quantity": "quantity"}
STAMP_RE = re.compile(r"\b(APPROVED|REJECTED|RELEASED|VOID|CONFIDENTIAL|QA ACCEPTED)\b[^\n]{0,40}")

TYPE_KEYWORDS = [
    ("inspection_report", ("inspection report", "inspector", "inspection result")),
    ("engineering_drawing", ("drawing no", "drawing number", "sheet 1 of", "title block")),
    ("contract", ("agreement", "contract no", "the supplier shall", "hereinafter")),
    ("parts_list", ("parts list", "bill of materials", "bom")),
    ("revision_history", ("revision history", "change log", "rev ")),
    ("project_memo", ("memorandum", "memo", "to:", "from:")),
]


class HeuristicProvider(Provider):
    name = "heuristic"
    locality = "local"

    def info(self) -> ProviderInfo:
        return ProviderInfo(
            name=self.name,
            model="regex-rules-v1",
            locality="local",
            is_ai_model=False,
            tasks=("classification", "extraction"),
            privacy="Runs in-process. No data leaves this machine.",
            available=True,
            detail="Deterministic baseline, not an AI model.",
        )

    def extract(
        self, pages: list[str], filename: str, policy_rules: list[dict], examples: list[dict] | None = None
    ) -> Extraction:
        text = "\n".join(pages)
        low = text.lower()
        evidence: list[EvidenceQuote] = []

        doc_type = "other"
        for t, keys in TYPE_KEYWORDS:
            if any(k in low for k in keys):
                doc_type = t
                break

        project = None
        if m := PROJECT_RE.search(text):
            project = m.group(1)
            evidence.append(EvidenceQuote(field="project", quote=m.group(0), page=_page_of(pages, m.group(0))))
        doc_date = None
        if m := DATE_RE.search(text):
            doc_date = m.group(1)
            evidence.append(EvidenceQuote(field="doc_date", quote=m.group(0), page=_page_of(pages, m.group(0))))

        components: dict[str, Component] = {}
        for page_no, page in enumerate(pages, start=1):
            header: dict[int, str] = {}  # CSV column index -> component field, from a header row
            for line in page.splitlines():
                cells = [c.strip() for c in line.split(",")] if "," in line else []
                if cells and not PART_RE.search(line):
                    found = {i: CSV_COLUMNS[c.casefold()] for i, c in enumerate(cells) if c.casefold() in CSV_COLUMNS}
                    if found:
                        header = found
                    continue
                parts = PART_RE.findall(line)
                if not parts:
                    continue
                psi = PSI_RE.search(line)
                rating = float(psi.group(1)) if psi else None
                for p in parts[:1]:
                    comp = components.setdefault(p, Component(part_number=p))
                    if rating is not None and comp.pressure_rating_psi is None:
                        comp.pressure_rating_psi = rating
                        evidence.append(EvidenceQuote(field=f"components.{p}", quote=line.strip()[:400], page=page_no))
                    _fill_other_fields(comp, line, cells, header)

        stamps = sorted({m.group(0).strip() for m in STAMP_RE.finditer(text)})[:20]
        first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), None)
        return Extraction(
            doc_type=doc_type,
            title=first_line[:200] if first_line else None,
            project=project,
            doc_date=doc_date,
            summary=None,
            components=list(components.values())[:100],
            stamps=stamps,
            evidence=evidence[:60],
        )


def _fill_other_fields(comp: Component, line: str, cells: list[str], header: dict[int, str]) -> None:
    """Material and quantity: from labelled CSV columns, or from "qty N" / "quantity N" in a text line."""
    if header and len(cells) > max(header):
        for i, field_name in header.items():
            value = cells[i]
            if field_name == "quantity" and value.isdigit() and comp.quantity is None:
                comp.quantity = int(value)
            elif field_name == "material" and value and comp.material is None:
                comp.material = value[:80]
    elif comp.quantity is None and (m := QTY_RE.search(line)):
        comp.quantity = int(m.group(1))


def _page_of(pages: list[str], quote: str) -> int:
    for i, p in enumerate(pages, start=1):
        if quote in p:
            return i
    return 1
