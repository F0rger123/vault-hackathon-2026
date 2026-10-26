"""Security test cases S1-S10 from docs/THREAT_MODEL.md. Each test asserts the attack is rejected."""

import hashlib
import json
import stat

import httpx
import pytest

from backend.core.config import Settings
from backend.providers.base import ProviderError
from backend.providers.llm import OllamaProvider, _parse
from backend.providers.schema import EvidenceQuote, Extraction, verify_evidence
from backend.storage.db import connect
from tests.conftest import auth, wait_job

API = "/api/v1"


def _collection(client, token, name="sec"):
    return client.post(f"{API}/collections", json={"name": name}, headers=auth(token)).json()["id"]


def _denials(client, admin_token):
    return [e for e in client.get(f"{API}/audit", params={"outcome": "denied"}, headers=auth(admin_token)).json()]


# S1 unauthorized document access
def test_s1_unauthenticated_and_underprivileged_requests_are_rejected(client, tokens):
    assert client.get(f"{API}/documents").status_code == 401
    assert client.get(f"{API}/documents", headers=auth("vlt_forged")).status_code == 401
    assert client.get(f"{API}/documents", headers={"Authorization": "Basic abc"}).status_code == 401
    cid = _collection(client, tokens["analyst"])
    r = client.post(
        f"{API}/collections/{cid}/documents", headers=auth(tokens["viewer"]), files=[("files", ("a.txt", b"hello"))]
    )
    assert r.status_code == 403
    assert client.get(f"{API}/audit", headers=auth(tokens["analyst"])).status_code == 403
    denied = _denials(client, tokens["admin"])
    assert any(d["actor"] == "anonymous" for d in denied)
    assert any(d["actor"] == "viewer" and "documents:upload" in d["detail"]["reason"] for d in denied)


# S2 unapproved file modification
def test_s2_only_approvers_can_execute_and_originals_stay_read_only(client, tokens, settings):
    cid = _collection(client, tokens["analyst"])
    client.post(
        f"{API}/collections/{cid}/documents",
        headers=auth(tokens["analyst"]),
        files=[("files", ("a.txt", b"Project: Alpha\nPV-1000 rated 300 psi"))],
    )
    prop = client.post(f"{API}/proposals", json={"collection_id": cid}, headers=auth(tokens["analyst"])).json()
    assert (
        client.post(f"{API}/proposals/{prop['id']}/approve", json={}, headers=auth(tokens["analyst"])).status_code
        == 403
    )
    assert client.get(f"{API}/proposals/{prop['id']}", headers=auth(tokens["admin"])).json()["status"] == "pending"
    assert not settings.exports_dir.exists() or not any(settings.exports_dir.iterdir())
    original = next(p for p in settings.originals_dir.rglob("*") if p.is_file())
    assert not original.stat().st_mode & stat.S_IWRITE


# S3 malicious instructions inside documents
def test_s3_prompt_injection_is_flagged_and_never_acted_on(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = _collection(client, tokens["analyst"])
    manifest = json.loads((dataset / "manifest.json").read_text())
    name = next(x for x in manifest["anomalies"] if x["kind"] == "injection")["documents"][0]
    did = client.post(
        f"{API}/collections/{cid}/documents",
        headers=a,
        files=[("files", (name, (dataset / "files" / name).read_bytes()))],
    ).json()["accepted"][0]["document_id"]
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic"}, headers=a).json()
    wait_job(client, tokens["analyst"], job["id"])
    ex = client.get(f"{API}/documents/{did}", headers=a).json()["extraction"]
    assert ex["injection_flags"], "injection text should be flagged"
    assert client.get(f"{API}/documents", headers=a).json()[0]["id"] == did  # document still present
    assert client.get(f"{API}/proposals", headers=a).json() == []  # nothing was proposed or executed


# S4 local-only network restrictions
def test_s4_remote_inference_requires_admin_enablement_and_confirmation(client, tokens, settings):
    cid = _collection(client, tokens["analyst"])
    body = {"collection_id": cid, "provider": "meta_api"}
    r = client.post(f"{API}/jobs", json=body, headers=auth(tokens["analyst"]))
    assert r.status_code == 403
    assert (
        client.put(
            f"{API}/settings/remote-inference", json={"enabled": True}, headers=auth(tokens["analyst"])
        ).status_code
        == 403
    )
    assert (
        client.put(
            f"{API}/settings/remote-inference", json={"enabled": True}, headers=auth(tokens["admin"])
        ).status_code
        == 200
    )
    r = client.post(f"{API}/jobs", json=body, headers=auth(tokens["analyst"]))
    assert r.status_code == 409 and "confirm_remote" in r.json()["detail"]
    r = client.post(f"{API}/jobs", json={**body, "confirm_remote": True}, headers=auth(tokens["analyst"]))
    assert r.status_code == 503  # no API key configured in tests, so still nothing is sent
    with pytest.raises(ProviderError):
        OllamaProvider(Settings(ollama_url="http://inference.example.com:11434", _env_file=None))


# S5 invalid file types
def test_s5_disguised_and_binary_files_are_rejected(client, tokens):
    cid = _collection(client, tokens["analyst"])
    r = client.post(
        f"{API}/collections/{cid}/documents",
        headers=auth(tokens["analyst"]),
        files=[
            ("files", ("invoice.pdf", b"MZ\x90\x00\x03\x00\x00\x00binary")),
            ("files", ("script.pdf", b"#!/bin/sh\nrm -rf /")),
            ("files", ("tool.exe", b"plain text but wrong extension")),
        ],
    ).json()
    assert not r["accepted"] and len(r["rejected"]) == 3


# S6 oversized files
def test_s6_oversized_upload_rejected(client, tokens):
    cid = _collection(client, tokens["analyst"])
    big = b"a" * (2 * 1024 * 1024 + 10)
    r = client.post(
        f"{API}/collections/{cid}/documents", headers=auth(tokens["analyst"]), files=[("files", ("big.txt", big))]
    ).json()
    assert not r["accepted"] and "exceeds" in r["rejected"][0]["reason"]


# S7 path traversal
def test_s7_path_traversal_blocked(client, tokens, settings, tmp_path):
    cid = _collection(client, tokens["analyst"])
    r = client.post(
        f"{API}/collections/{cid}/documents",
        headers=auth(tokens["analyst"]),
        files=[("files", ("../../../../evil.txt", b"x"))],
    ).json()
    assert r["accepted"][0]["filename"] == "evil.txt"
    (tmp_path / "imports").mkdir(exist_ok=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    for path in (str(outside), str(tmp_path / "imports" / ".." / "outside")):
        assert (
            client.post(
                f"{API}/collections/{cid}/import-path", json={"path": path}, headers=auth(tokens["admin"])
            ).status_code
            == 403
        )
    assert (
        client.post(
            f"{API}/proposals", json={"collection_id": cid, "pattern": "../{project}"}, headers=auth(tokens["analyst"])
        ).status_code
        == 400
    )


# S8 malformed input
def test_s8_malformed_input_handled(client, tokens):
    a = auth(tokens["analyst"])
    cid = _collection(client, tokens["analyst"])
    r = client.post(
        f"{API}/collections/{cid}/documents",
        headers=a,
        files=[("files", ("broken.pdf", b"%PDF-1.7\n garbage \x00\x01"))],
    ).json()
    assert r["rejected"] and r["rejected"][0]["reason"] == "PDF could not be parsed"
    assert (
        client.post(
            f"{API}/collections", content=b"{not json", headers={**a, "Content-Type": "application/json"}
        ).status_code
        == 422
    )
    assert client.post(f"{API}/collections", json={"name": "bad/name"}, headers=a).status_code == 422
    for q in ['"', "NEAR(", "a OR", "*", "pages_fts:x", "'; DROP TABLE documents;--"]:
        assert client.get(f"{API}/search", params={"q": q}, headers=a).status_code == 200
    assert client.get(f"{API}/documents/999999", headers=a).status_code == 404


# S9 secret exposure
def test_s9_secrets_not_stored_or_returned(client, tokens, settings):
    with connect(settings.db_path) as conn:
        stored = [r["token_hash"] for r in conn.execute("SELECT token_hash FROM api_tokens")]
    assert tokens["admin"] not in stored
    assert hashlib.sha256(tokens["admin"].encode()).hexdigest() in stored
    secret_settings = settings.model_copy(update={"meta_api_key": "LLM_supersecret"})
    client.app.state.settings = secret_settings
    body = client.get(f"{API}/system/providers", headers=auth(tokens["viewer"])).text
    assert "LLM_supersecret" not in body
    audit_text = client.get(f"{API}/audit", headers=auth(tokens["admin"])).text
    assert tokens["admin"] not in audit_text and tokens["analyst"] not in audit_text


# S10 unsafe model output
def test_s10_unsafe_model_output_rejected_or_contained():
    with pytest.raises(ProviderError):
        _parse("Sure! Here is the JSON: {")
    with pytest.raises(ProviderError):
        _parse(json.dumps({"doc_type": "rm -rf /"}))
    ex = _parse(json.dumps({"doc_type": "contract", "run_command": "del C:\\", "doc_date": "tomorrow"}))
    assert not hasattr(ex, "run_command") and ex.doc_date is None
    fabricated = Extraction(evidence=[EvidenceQuote(field="x", quote="Approved by the CEO", page=1)])
    assert verify_evidence(fabricated, ["nothing like that here"])[0]["verified"] is False


def test_unhandled_errors_do_not_leak_details(settings):
    from fastapi.testclient import TestClient

    from backend.main import create_app

    app = create_app(settings, resume_jobs=False)

    @app.get("/boom")
    def boom():
        raise RuntimeError("C:/secret/path/customer-contract.pdf")

    r = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert r.status_code == 500 and "secret" not in r.text


def test_ollama_unreachable_is_reported_not_crashing(monkeypatch):
    def fail(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(httpx, "get", fail)
    info = OllamaProvider(Settings(_env_file=None)).info()
    assert info.available is False and "not reachable" in info.detail
