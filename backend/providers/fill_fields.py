"""Fill structured fields an AI model left empty, from the part's own line in the document (F04.11).

Llama 3 reads pressure ratings and materials well but often leaves `quantity` empty, and asking for it in the
prompt made it confuse quantities with pressures (see evaluation/results/SUMMARY.md, F06.5). So the prompt
stays as it is. After the model answers, VAULT fills only the fields the model left empty, and only from a
labelled value on the same line or table row as that part number: "qty 4", "quantity 4", or a CSV column
headed qty or material. It never overrides a value the model gave. Every filled value gets an evidence quote,
so it is checked against the page like any other fact.
"""

from __future__ import annotations

from backend.providers.heuristic import CSV_COLUMNS, PART_RE, QTY_RE
from backend.providers.schema import EvidenceQuote, Extraction


def fill_from_text(extraction: Extraction, pages: list[str]) -> tuple[Extraction, int]:
    """Return the extraction with empty quantity/material filled where the text states them, and the count."""
    wanted = {c.part_number: c for c in extraction.components if c.quantity is None or not c.material}
    if not wanted:
        return extraction, 0
    found: dict[str, dict] = {}
    for page_no, page in enumerate(pages, start=1):
        header: dict[int, str] = {}
        for line in page.splitlines():
            cells = [c.strip() for c in line.split(",")] if "," in line else []
            if cells and not PART_RE.search(line):
                cols = {i: CSV_COLUMNS[c.casefold()] for i, c in enumerate(cells) if c.casefold() in CSV_COLUMNS}
                if cols:
                    header = cols
                continue
            parts = PART_RE.findall(line)
            if not parts or parts[0].upper() not in wanted:
                continue
            got = found.setdefault(parts[0].upper(), {})
            if header and len(cells) > max(header):
                for i, field in header.items():
                    value = cells[i]
                    if field == "quantity" and value.isdigit():
                        got.setdefault("quantity", (int(value), line, page_no))
                    elif field == "material" and value:
                        got.setdefault("material", (value[:80], line, page_no))
            elif m := QTY_RE.search(line):
                got.setdefault("quantity", (int(m.group(1)), line, page_no))

    filled = 0
    components, evidence = [], list(extraction.evidence)
    for c in extraction.components:
        values = found.get(c.part_number, {})
        update = {}
        if c.quantity is None and "quantity" in values:
            update["quantity"] = values["quantity"][0]
        if not c.material and "material" in values:
            update["material"] = values["material"][0]
        for field in update:
            _, line, page_no = values[field]
            evidence.append(
                EvidenceQuote(field=f"components.{c.part_number}.{field}", quote=line.strip()[:400], page=page_no)
            )
        filled += len(update)
        components.append(c.model_copy(update=update) if update else c)
    if not filled:
        return extraction, 0
    # The schema allows 60 quotes; the model's own come first.
    return extraction.model_copy(update={"components": components, "evidence": evidence[:60]}), filled
