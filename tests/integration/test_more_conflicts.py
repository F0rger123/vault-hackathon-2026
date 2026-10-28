"""F06.5: quantity and material conflicts within a project, found with verified evidence."""

import json
from pathlib import Path

from backend.providers.heuristic import HeuristicProvider
from tests.conftest import auth, wait_job

API = "/api/v1"
V2 = Path(__file__).resolve().parents[2] / "data" / "synthetic" / "v2"


def test_rule_based_reader_extracts_quantity_and_material():
    csv_page = "part_number,description,material,rated_psi,qty\nFL-8494,Weld-neck flange,A105 carbon steel,2500 psi,5"
    text_page = "   HX-8226  Plate heat exchanger  316L stainless  rated 150 psi  quantity 4"
    got = {c.part_number: c for c in HeuristicProvider().extract([csv_page, text_page], "x.csv", []).components}
    # The psi pattern deliberately ignores a number right after a comma (so "1,500 psi" never reads as 500),
    # which also means CSV ratings are not read by the rule-based reader. That limitation predates F06.5.
    assert (got["FL-8494"].material, got["FL-8494"].quantity) == ("A105 carbon steel", 5)
    assert got["HX-8226"].quantity == 4 and got["HX-8226"].material is None


def test_planted_quantity_and_material_conflicts_are_found_for_one_project(client, tokens):
    a = auth(tokens["analyst"])
    manifest = json.loads((V2 / "manifest.json").read_text(encoding="utf-8"))
    cid = client.post(f"{API}/collections", json={"name": "alpha-v2"}, headers=a).json()["id"]
    files = [("files", (p.name, p.read_bytes())) for p in sorted((V2 / "files").glob("ALP-*"))]
    assert client.post(f"{API}/collections/{cid}/documents", files=files, headers=a).status_code == 200
    job = client.post(f"{API}/jobs", json={"collection_id": cid, "provider": "heuristic", "workers": 4}, headers=a)
    assert wait_job(client, tokens["analyst"], job.json()["id"])["status"] == "completed"

    found = client.get(f"{API}/collections/{cid}/findings", headers=a).json()
    for kind in ("quantity_conflict", "material_conflict"):
        planted = {x["part_number"] for x in manifest["anomalies"] if x["kind"] == kind and x["project"] == "Alpha"}
        hits = [f for f in found if f["kind"] == kind]
        assert {f["key"] for f in hits} == planted
        for f in hits:
            assert f["status"] == "verified" and len({e["value"] for e in f["evidence"]}) == 2
            assert all(e["quote"] and f["key"] in e["quote"] for e in f["evidence"])
    material = next(f for f in found if f["kind"] == "material_conflict")
    assert {e["value"] for e in material["evidence"]} == {"316L stainless", "A105 carbon steel"}
