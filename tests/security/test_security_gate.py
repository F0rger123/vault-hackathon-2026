"""F09.13: the security gate holds files with active content, and a live checklist shows VAULT's protections."""

import io
import zipfile

from pypdf import PdfWriter
from reportlab.pdfgen import canvas

from backend.security.active_content import detect
from tests.conftest import auth, wait_job
from tests.unit.test_office import docx_bytes

API = "/api/v1"


def clean_pdf(text="Inspection report PV-1001 rated 300 psi") -> bytes:
    b = io.BytesIO()
    c = canvas.Canvas(b)
    c.drawString(40, 800, text)
    c.save()
    return b.getvalue()


def pdf_with_javascript() -> bytes:
    w = PdfWriter(clone_from=io.BytesIO(clean_pdf()))
    w.add_js("app.alert('hi');")
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def pdf_with_attachment() -> bytes:
    w = PdfWriter(clone_from=io.BytesIO(clean_pdf()))
    w.add_attachment("payload.exe", b"MZ fake")
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def docx_with_external_link() -> bytes:
    src = zipfile.ZipFile(io.BytesIO(docx_bytes()))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for i in src.infolist():
            z.writestr(i, src.read(i))
        z.writestr(
            "word/_rels/document.xml.rels",
            '<Relationships><Relationship Id="r1" Type="hyperlink" Target="http://evil.example/x" TargetMode="External"/></Relationships>',
        )
    return out.getvalue()


def test_detects_active_content_and_ignores_clean_files():
    assert detect(clean_pdf(), "application/pdf") == []
    assert "runs JavaScript" in detect(pdf_with_javascript(), "application/pdf")
    assert "carries embedded files" in detect(pdf_with_attachment(), "application/pdf")
    docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert detect(docx_bytes(), docx) == []
    assert detect(docx_with_external_link(), docx) == ["links to outside files or web addresses"]
    assert detect(b"plain text", "text/plain") == []


def test_held_files_are_not_read_or_downloaded_until_an_admin_releases_them(client, tokens):
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    cid = client.post(f"{API}/collections", json={"name": "gate"}, headers=a).json()["id"]
    up = client.post(
        f"{API}/collections/{cid}/documents",
        headers=a,
        files=[("files", ("clean.pdf", clean_pdf())), ("files", ("macro.pdf", pdf_with_javascript()))],
    ).json()
    ids = {d["filename"]: d["document_id"] for d in up["accepted"]}
    held = client.get(f"{API}/security/quarantine", headers=a).json()
    assert [h["filename"] for h in held] == ["macro.pdf"] and "runs JavaScript" in held[0]["reason"]

    r = client.get(f"{API}/documents/{ids['macro.pdf']}/original", headers=admin)
    assert r.status_code == 423
    assert client.get(f"{API}/documents/{ids['clean.pdf']}/original", headers=a).status_code == 200

    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 2}, headers=a
    ).json()
    job = wait_job(client, tokens["analyst"], job["id"])
    assert job["total"] == 1, "held files are left out of new runs"
    assert client.get(f"{API}/documents/{ids['macro.pdf']}", headers=a).json()["extraction"] is None

    assert client.post(f"{API}/documents/{ids['macro.pdf']}/release", headers=a).status_code == 403
    assert client.post(f"{API}/documents/{ids['macro.pdf']}/release", headers=admin).status_code == 200
    assert client.post(f"{API}/documents/{ids['macro.pdf']}/release", headers=admin).status_code == 409
    assert client.get(f"{API}/documents/{ids['macro.pdf']}/original", headers=admin).status_code == 200
    log = client.get(f"{API}/audit", headers=admin).json()
    assert {("document.download", "denied"), ("document.release", "allowed")} <= {
        (e["action"], e["outcome"]) for e in log
    }


def test_posture_checklist_reflects_real_settings(client, tokens, settings, monkeypatch):
    v = auth(tokens["viewer"])
    p = client.get(f"{API}/security/posture", headers=v).json()
    checks = {c["id"]: c for c in p["checks"]}
    assert p["passed"] == sum(c["ok"] for c in p["checks"]) and p["total"] == len(p["checks"])
    assert checks["remote_off"]["ok"] and checks["quarantine"]["ok"] and not checks["strong_unlock"]["ok"]
    assert not checks["admin_password"]["ok"], "the test admin has no password yet"
    monkeypatch.setattr(settings, "response_cache", True)
    assert not {c["id"]: c for c in client.get(f"{API}/security/posture", headers=v).json()["checks"]}["cache_off"][
        "ok"
    ]
    assert client.get(f"{API}/security/posture").status_code == 401
