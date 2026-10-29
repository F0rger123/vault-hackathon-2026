"""F02.8: Office files go through the normal upload, processing and search path."""

from tests.conftest import auth, wait_job
from tests.unit.test_office import docx_bytes, pptx_bytes, xlsx_bytes

API = "/api/v1"


def test_office_files_import_process_and_search(client, tokens):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "office"}, headers=a).json()["id"]
    files = [
        ("files", ("parts.docx", docx_bytes())),
        ("files", ("parts.xlsx", xlsx_bytes())),
        ("files", ("deck.pptx", pptx_bytes())),
    ]
    files.append(("files", ("macro.docm", docx_bytes())))
    body = client.post(f"{API}/collections/{cid}/documents", headers=a, files=files).json()
    assert {d["filename"]: d["page_count"] for d in body["accepted"]} == {
        "parts.docx": 1,
        "parts.xlsx": 1,
        "deck.pptx": 2,
    }
    assert [r["filename"] for r in body["rejected"]] == ["macro.docm"]

    job = client.post(
        f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 2}, headers=a
    ).json()
    assert wait_job(client, tokens["analyst"], job["id"])["status"] == "completed"
    hits = client.get(f"{API}/search", params={"q": "ZV-1001", "collection_id": cid}, headers=a).json()
    assert {h["filename"] for h in hits["results"]} == {"parts.docx", "parts.xlsx", "deck.pptx"}
