"""F12.16: the Quick and Complete demo datasets download through the API as safe, intact ZIPs."""

import io
import re
import zipfile

import pytest

from backend.workers import demo_dataset
from tests.conftest import auth

API = "/api/v1"
ACTIVE_PDF = re.compile(rb"/(?:JavaScript|JS|OpenAction|Launch)[\s/<>\[\]()]")


def _open(res) -> zipfile.ZipFile:
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(res.content))
    assert z.testzip() is None
    return z


def _check_safe(z: zipfile.ZipFile, top: str) -> None:
    for info in z.infolist():
        name = info.filename
        assert name.startswith(f"{top}/") and not name.startswith("/") and "\\" not in name
        assert ".." not in name.split("/") and ":" not in name
        data = z.read(info)
        assert not data.startswith(b"MZ"), name
        if data.startswith(b"%PDF-"):
            assert not ACTIVE_PDF.search(data), name
        if data.startswith(b"PK"):
            assert name.endswith((".docx", ".xlsx", ".pptx")), name
            inner = zipfile.ZipFile(io.BytesIO(data))
            assert not any(n.lower().endswith("vbaproject.bin") for n in inner.namelist()), name


def test_quick_dataset_downloads(client, tokens):
    res = client.get(f"{API}/demo/dataset/quick.zip", headers=auth(tokens["viewer"]))
    assert 'filename="vault-demo-dataset-quick.zip"' in res.headers["content-disposition"]
    z = _open(res)
    top = "vault-demo-dataset-quick"
    names = set(z.namelist())
    files = [n for n in names if n.startswith(f"{top}/files/")]
    assert len(files) == 150
    for extra in ("README.md", "EXAMPLE_PROMPTS.md", "FICTIONAL_DATA_NOTICE.txt", "expected/manifest.json"):
        assert f"{top}/{extra}" in names
    assert "FICTIONAL" in z.read(f"{top}/README.md").decode()
    assert "BV-7891" in z.read(f"{top}/expected/expected_findings.json").decode()
    assert "conflicting pressure ratings" in z.read(f"{top}/EXAMPLE_PROMPTS.md").decode()
    assert any(b"BV-7891" in z.read(n) for n in files if n.endswith(".csv"))
    _check_safe(z, top)

    # A second request reuses the cached ZIP (same content hash).
    again = client.get(f"{API}/demo/dataset/quick.zip", headers=auth(tokens["viewer"]))
    assert again.headers["etag"] == res.headers["etag"] and again.content == res.content

    log = client.get(f"{API}/audit", headers=auth(tokens["admin"])).json()
    assert any(e["action"] == "demo_dataset.download" and e["target"] == "demo-dataset:quick" for e in log)


def test_complete_dataset_excludes_dangerous_files(client, tokens, monkeypatch):
    monkeypatch.setattr(demo_dataset, "TESTSET", {"count": 6, "seed": 7, "size": "full"})
    res = client.get(f"{API}/demo/dataset/complete.zip", headers=auth(tokens["analyst"]))
    z = _open(res)
    top = "vault-demo-dataset-complete"
    names = set(z.namelist())
    assert len([n for n in names if n.startswith(f"{top}/files/")]) == 150
    testset = [n for n in names if n.startswith(f"{top}/testset/")]
    assert len(testset) > 40
    assert any(n.startswith(f"{top}/testset/edge-cases/") for n in testset)
    assert not any("/edge_cases/" in n for n in names)
    for gone in ("program_named_video.mov", "openaction_javascript.pdf", "has_macro_project.docx", "archive.zip"):
        assert not any(n.endswith(gone) for n in names), gone
    readme = z.read(f"{top}/README.md").decode()
    assert "program_named_video.mov" in readme and "What was left out" in readme
    assert f"{top}/expected/testset-manifest.json" in names
    _check_safe(z, top)


def test_download_needs_sign_in(client, tokens):
    assert client.get(f"{API}/demo/dataset/quick.zip").status_code == 401
    assert client.get(f"{API}/demo/dataset/complete.zip", headers=auth("vlt_not_a_token")).status_code == 401
    assert client.get(f"{API}/demo/dataset/other.zip", headers=auth(tokens["viewer"])).status_code == 422


def test_unavailable_dataset_does_not_leak_paths(client, tokens, monkeypatch, tmp_path):
    monkeypatch.setattr(demo_dataset, "GENERATOR", tmp_path / "secret-place" / "missing.py")
    res = client.get(f"{API}/demo/dataset/complete.zip", headers=auth(tokens["viewer"]))
    assert res.status_code == 503
    assert "secret-place" not in res.text and str(tmp_path) not in res.text


@pytest.mark.parametrize("bad", ["../x", "/abs", "a//b", "C:/x", "a\\b", "a/./b"])
def test_entry_names_must_be_relative(bad):
    with pytest.raises(ValueError):
        demo_dataset.arcname(bad)
