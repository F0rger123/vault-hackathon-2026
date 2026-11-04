"""F11.9: the in-app preview serves only kinds a browser shows by itself, never a held file, and is audited."""

import io

from PIL import Image

import backend.security.auth as auth_mod
from tests.conftest import auth
from tests.security.test_security_gate import clean_pdf, pdf_with_javascript

API = "/api/v1"


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (120, 90, 60)).save(buf, "JPEG")
    return buf.getvalue()


def _upload(client, a) -> dict[str, int]:
    cid = client.post(f"{API}/collections", json={"name": "preview"}, headers=a).json()["id"]
    files = {
        "site.jpg": _jpeg(),
        "report.pdf": clean_pdf(),
        "macro.pdf": pdf_with_javascript(),
        "notes.txt": b"<html><script>alert(1)</script></html> PV-1001 rated 300 psi",
    }
    up = client.post(f"{API}/collections/{cid}/documents", headers=a, files=[("files", kv) for kv in files.items()])
    assert up.status_code == 200, up.text
    return {d["filename"]: d["document_id"] for d in up.json()["accepted"]}


def test_preview_serves_photos_and_pdfs_inline_and_is_audited(client, tokens):
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    ids = _upload(client, a)

    r = client.get(f"{API}/documents/{ids['site.jpg']}/original?inline=1", headers=auth(tokens["viewer"]))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["content-disposition"].startswith("inline;")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]
    assert r.content == _jpeg()

    r = client.get(f"{API}/documents/{ids['report.pdf']}/original?inline=1", headers=a)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"

    # Downloads stay attachments, and say so in the audit log separately from previews.
    r = client.get(f"{API}/documents/{ids['report.pdf']}/original", headers=a)
    assert r.headers["content-disposition"].startswith("attachment;")
    log = {(e["action"], e["outcome"], e["target"]) for e in client.get(f"{API}/audit", headers=admin).json()}
    assert ("document.view", "allowed", f"document:{ids['site.jpg']}") in log
    assert ("document.download", "allowed", f"document:{ids['report.pdf']}") in log


def test_text_files_have_no_inline_preview(client, tokens):
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    ids = _upload(client, a)
    # A text file holding markup is never served for the browser to render; its extracted pages are shown instead.
    r = client.get(f"{API}/documents/{ids['notes.txt']}/original?inline=1", headers=a)
    assert r.status_code == 415
    assert "alert" not in r.text
    log = client.get(f"{API}/audit", headers=admin).json()
    assert any(e["action"] == "document.view" and e["outcome"] == "denied" for e in log)


def test_held_files_never_preview(client, tokens):
    a, admin = auth(tokens["analyst"]), auth(tokens["admin"])
    ids = _upload(client, a)
    r = client.get(f"{API}/documents/{ids['macro.pdf']}/original?inline=1", headers=admin)
    assert r.status_code == 423
    assert r.headers["content-type"].startswith("application/json")
    log = client.get(f"{API}/audit", headers=admin).json()
    assert any(
        e["action"] == "document.view" and e["outcome"] == "denied" and e["target"] == f"document:{ids['macro.pdf']}"
        for e in log
    )


def test_preview_needs_the_read_permission(client, tokens, monkeypatch):
    ids = _upload(client, auth(tokens["analyst"]))
    url = f"{API}/documents/{ids['site.jpg']}/original?inline=1"
    assert client.get(url).status_code == 401
    monkeypatch.setitem(auth_mod.ROLE_PERMISSIONS, "viewer", auth_mod.ROLE_PERMISSIONS["viewer"] - {"documents:read"})
    r = client.get(url, headers=auth(tokens["viewer"]))
    assert r.status_code == 403
    assert r.headers["content-type"].startswith("application/json")
