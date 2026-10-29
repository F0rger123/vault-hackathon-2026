"""F08.5: export a collection's extractions as a table, with provenance, CSV-injection safe."""

import csv
import io

from backend.workers.records import to_csv
from tests.conftest import auth, wait_job

API = "/api/v1"


def _processed_collection(client, tokens, dataset):
    a = auth(tokens["analyst"])
    cid = client.post(f"{API}/collections", json={"name": "demo"}, headers=a).json()["id"]
    files = sorted((dataset / "files").iterdir())
    payload = [("files", (p.name, p.read_bytes())) for p in files]
    assert client.post(f"{API}/collections/{cid}/documents", headers=a, files=payload).status_code == 200
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a)
    assert wait_job(client, tokens["analyst"], job.json()["id"])["status"] == "completed"
    return cid, len(files)


def test_records_match_extractions_with_provenance(client, tokens, dataset):
    cid, n_files = _processed_collection(client, tokens, dataset)
    v = auth(tokens["viewer"])

    body = client.get(f"{API}/collections/{cid}/records", headers=v).json()
    expected = 0
    for doc_id in {r["document_id"] for r in body["rows"]}:
        parts = client.get(f"{API}/documents/{doc_id}", headers=v).json()["extraction"]["data"]["components"]
        expected += max(len(parts), 1)
    assert len({r["document_id"] for r in body["rows"]}) == n_files
    assert body["count"] == len(body["rows"]) == expected

    with_parts = [r for r in body["rows"] if r["part_number"]]
    assert with_parts
    for r in with_parts:
        assert r["filename"] and r["sha256"] and r["provider"] == "heuristic"
        if r["evidence_verified"]:
            page = client.get(f"{API}/documents/{r['document_id']}/pages/{r['evidence_page']}", headers=v).json()
            assert " ".join(r["evidence_quote"].split()) in " ".join(page["text"].split())

    res = client.get(f"{API}/collections/{cid}/records", params={"format": "csv"}, headers=v)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert 'filename="vault-demo-records.csv"' in res.headers["content-disposition"]
    table = list(csv.DictReader(io.StringIO(res.text)))
    assert len(table) == body["count"]

    log = client.get(f"{API}/audit", headers=auth(tokens["admin"])).json()
    assert any(e["action"] == "records.export" and e["detail"]["rows"] == body["count"] for e in log)


def test_records_denied_and_missing(client, tokens):
    assert client.get(f"{API}/collections/1/records").status_code == 401
    assert client.get(f"{API}/collections/999/records", headers=auth(tokens["viewer"])).status_code == 404
    bad = client.get(f"{API}/collections/1/records", params={"format": "xlsx"}, headers=auth(tokens["viewer"]))
    assert bad.status_code == 422


def test_csv_cells_cannot_become_spreadsheet_formulas():
    rows = [{"title": '=HYPERLINK("http://evil")', "part_number": "+1", "material": "@SUM(A1)", "project": "ok"}]
    line = list(csv.DictReader(io.StringIO(to_csv(rows))))[0]
    assert line["title"].startswith("'=") and line["part_number"] == "'+1" and line["material"] == "'@SUM(A1)"
    assert line["project"] == "ok"
