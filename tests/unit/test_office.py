"""F02.8: Word, Excel and PowerPoint text, and the archive checks that keep untrusted Office files safe."""

import io
import zipfile

import pytest

from backend.ingest.office import office_pages
from backend.ingest.service import extract_pages
from backend.providers.heuristic import HeuristicProvider
from backend.security.files import DOCX, PPTX, XLSX, FileRejected, validate_upload

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
A = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
)


def office(parts: dict[str, str | bytes], compression=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        for name, body in parts.items():
            z.writestr(name, body)
    return buf.getvalue()


def para(text: str) -> str:
    return f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"


def cell(text: str) -> str:
    return f"<w:tc>{para(text)}</w:tc>"


def docx_bytes() -> bytes:
    rows = [
        ["part_number", "description", "material", "rated_psi", "qty"],
        ["ZV-1001", "Ball valve", "316L", "150 psi", "6"],
    ]
    table = "<w:tbl>" + "".join("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>" for r in rows) + "</w:tbl>"
    body = para("PARTS LIST - Project: Zephyr - issued 2026-03-02") + table
    return office({"word/document.xml": f"<w:document {W}><w:body>{body}</w:body></w:document>"})


def xlsx_bytes() -> bytes:
    shared = (
        f"<sst {S}><si><t>part_number</t></si><si><t>material</t></si><si><t>qty</t></si><si><t>ZV-1001</t></si></sst>"
    )
    sheet = (
        f"<worksheet {S}><sheetData>"
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
        # B2 is empty, so the quantity must still land under "qty".
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2"><v>6</v></c></row>'
        '<row r="3"><c r="A3" t="inlineStr"><is><t>ZV-2002</t></is></c><c r="B3" t="inlineStr"><is><t>Brass</t></is></c></row>'
        "</sheetData></worksheet>"
    )
    workbook = f'<workbook {S}><sheets><sheet name="Parts" sheetId="1"/></sheets></workbook>'
    return office({"xl/workbook.xml": workbook, "xl/sharedStrings.xml": shared, "xl/worksheets/sheet1.xml": sheet})


def pptx_bytes() -> bytes:
    def slide(*lines):
        paras = "".join(f"<a:p><a:r><a:t>{t}</a:t></a:r></a:p>" for t in lines)
        return f"<p:sld {A}><p:cSld><p:spTree><p:sp><p:txBody>{paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"

    return office(
        {
            "ppt/slides/slide2.xml": slide("Results", "ZV-1001 rated 300 psi"),
            "ppt/slides/slide1.xml": slide("Project: Zephyr"),
        }
    )


def test_word_paragraphs_and_tables_become_searchable_rows():
    pages = office_pages(docx_bytes(), DOCX, 4000)
    assert pages[0].splitlines()[0] == "PARTS LIST - Project: Zephyr - issued 2026-03-02"
    assert "ZV-1001, Ball valve, 316L, 150 psi, 6" in pages[0]
    # The existing CSV column rules read the table: part, material and quantity.
    extraction = HeuristicProvider().extract(pages, "parts.docx", [])
    part = next(c for c in extraction.components if c.part_number == "ZV-1001")
    assert part.material == "316L" and part.quantity == 6


def test_excel_keeps_columns_aligned_and_names_the_sheet():
    pages = office_pages(xlsx_bytes(), XLSX, 4000)
    assert pages == ["Sheet: Parts\npart_number,material,qty\nZV-1001,,6\nZV-2002,Brass"]


def test_long_sheets_split_with_the_header_repeated():
    header = '<row r="1"><c r="A1" t="inlineStr"><is><t>part_number</t></is></c></row>'
    rows = "".join(
        f'<row r="{i}"><c r="A{i}" t="inlineStr"><is><t>ZV-{i:04d}</t></is></c></row>' for i in range(2, 1200)
    )
    data = office({"xl/worksheets/sheet1.xml": f"<worksheet {S}><sheetData>{header}{rows}</sheetData></worksheet>"})
    pages = office_pages(data, XLSX, 4000)
    assert len(pages) > 1 and all(p.split("\n")[1] == "part_number" for p in pages)
    assert all(len(p) <= 4100 for p in pages)


def test_powerpoint_gives_one_page_per_slide_in_order():
    assert office_pages(pptx_bytes(), PPTX, 4000) == [
        "Slide 1\nProject: Zephyr",
        "Slide 2\nResults\nZV-1001 rated 300 psi",
    ]


@pytest.mark.parametrize(
    "name,maker,kind", [("a.docx", docx_bytes, DOCX), ("b.xlsx", xlsx_bytes, XLSX), ("c.pptx", pptx_bytes, PPTX)]
)
def test_upload_validation_maps_extension_to_office_type(name, maker, kind):
    data = maker()
    assert validate_upload(name, data[:4096], len(data), 10**7) == (name, kind)
    assert extract_pages(data, kind, 500)


@pytest.mark.parametrize("name", ["macro.docm", "macro.xlsm", "deck.pptm", "bundle.zip", "x.jar", "noext"])
def test_other_zip_files_are_rejected(name):
    data = docx_bytes()
    with pytest.raises(FileRejected):
        validate_upload(name, data[:4096], len(data), 10**7)


def test_macro_project_inside_a_renamed_file_is_rejected():
    data = office({"word/document.xml": f"<w:document {W}><w:body/></w:document>", "word/vbaProject.bin": b"\x00" * 10})
    with pytest.raises(FileRejected, match="macros"):
        office_pages(data, DOCX, 4000)


def test_zip_bomb_is_rejected_before_reading():
    bomb = office({"word/document.xml": b" " * (15 * 1024 * 1024)})
    assert len(bomb) < 100_000
    with pytest.raises(FileRejected, match="zip bomb"):
        office_pages(bomb, DOCX, 4000)


def test_oversized_parts_and_too_many_parts_are_rejected():
    big = office({"word/document.xml": b"x" * (21 * 1024 * 1024)}, compression=zipfile.ZIP_STORED)
    with pytest.raises(FileRejected, match="too large"):
        office_pages(big, DOCX, 4000)
    many = office({f"word/media/{i}.xml": "<x/>" for i in range(2001)})
    with pytest.raises(FileRejected, match="too many"):
        office_pages(many, DOCX, 4000)


def test_entity_expansion_and_external_entities_are_rejected():
    laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY l2 "&lol;&lol;">]><w:document>&l2;</w:document>'
    xxe = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document>&x;</w:document>'
    for body in (laughs, xxe):
        with pytest.raises(FileRejected, match="DTD"):
            office_pages(office({"word/document.xml": body}), DOCX, 4000)
    utf16 = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE d><w:document/>'.encode("utf-16")
    with pytest.raises(FileRejected, match="UTF-8"):
        office_pages(office({"word/document.xml": utf16}), DOCX, 4000)


def test_damaged_or_empty_files_are_rejected_with_a_safe_message():
    for data, kind in [
        (b"PK\x03\x04garbage", DOCX),
        (office({"other.xml": "<x/>"}), DOCX),
        (office({"xl/workbook.xml": "<workbook/>"}), XLSX),
        (office({"ppt/presentation.xml": "<p/>"}), PPTX),
        (office({"word/document.xml": "<w:document><unclosed>"}), DOCX),
    ]:
        with pytest.raises(FileRejected) as err:
            office_pages(data, kind, 4000)
        assert "/" not in str(err.value) and "\\" not in str(err.value)
